import { REPO } from '../../data/site';
import { env } from './env';

/**
 * GitHub Git Data API 로 여러 파일을 커밋 하나로 올린다.
 * main 에 커밋되면 Vercel 이 자동으로 다시 배포한다.
 */
async function gh<T>(path: string, init?: RequestInit): Promise<T> {
  const token = env.githubToken();
  if (!token) throw new Error('GITHUB_TOKEN 이 설정되지 않았습니다');
  const res = await fetch(`${env.githubApi()}/repos/${REPO.owner}/${REPO.name}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      accept: 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28',
      'content-type': 'application/json',
      ...init?.headers,
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw Object.assign(new Error(`GitHub ${res.status}: ${text.slice(0, 200)}`), { status: res.status });
  }
  return res.json() as Promise<T>;
}

export const githubConfigured = () => Boolean(env.githubToken());

/** 파일 하나를 blob 으로 올리고 sha 를 돌려준다 (이미지는 하나씩 따로 올려 요청 크기 제한을 피한다) */
export async function createBlob(base64: string) {
  const { sha } = await gh<{ sha: string }>('/git/blobs', {
    method: 'POST',
    body: JSON.stringify({ content: base64, encoding: 'base64' }),
  });
  return sha;
}

export type TreeItem =
  | { path: string; sha: string } // 이미 올린 blob
  | { path: string; content: string } // 텍스트 파일
  | { path: string; delete: true };

/** 파일들을 한 커밋으로 main 에 올린다. 동시에 다른 커밋이 끼어들면 한 번 다시 시도한다 */
export async function commitFiles(items: TreeItem[], message: string): Promise<string> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const ref = await gh<{ object: { sha: string } }>(`/git/ref/heads/${REPO.branch}`);
    const parent = ref.object.sha;
    const base = await gh<{ tree: { sha: string } }>(`/git/commits/${parent}`);
    const tree = await gh<{ sha: string }>('/git/trees', {
      method: 'POST',
      body: JSON.stringify({
        base_tree: base.tree.sha,
        tree: items.map((it) =>
          'delete' in it
            ? { path: it.path, mode: '100644', type: 'blob', sha: null }
            : 'sha' in it
              ? { path: it.path, mode: '100644', type: 'blob', sha: it.sha }
              : { path: it.path, mode: '100644', type: 'blob', content: it.content },
        ),
      }),
    });
    const commit = await gh<{ sha: string }>('/git/commits', {
      method: 'POST',
      body: JSON.stringify({ message, tree: tree.sha, parents: [parent] }),
    });
    try {
      await gh(`/git/refs/heads/${REPO.branch}`, {
        method: 'PATCH',
        body: JSON.stringify({ sha: commit.sha, force: false }),
      });
      return commit.sha;
    } catch (e) {
      if ((e as { status?: number }).status === 422 && attempt === 0) continue;
      throw e;
    }
  }
  throw new Error('커밋에 실패했습니다');
}

/** 폴더 안의 파일 경로 목록 (게시물 삭제 때 이미지까지 지우려고) */
export async function listTree(prefix: string): Promise<string[]> {
  const ref = await gh<{ object: { sha: string } }>(`/git/ref/heads/${REPO.branch}`);
  const commit = await gh<{ tree: { sha: string } }>(`/git/commits/${ref.object.sha}`);
  const tree = await gh<{ tree: { path: string; type: string }[] }>(`/git/trees/${commit.tree.sha}?recursive=1`);
  return tree.tree.filter((t) => t.type === 'blob' && t.path.startsWith(prefix)).map((t) => t.path);
}
