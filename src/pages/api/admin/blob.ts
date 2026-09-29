import type { APIRoute } from 'astro';
import { isAdmin, json, sameOrigin } from '../../../lib/server/session';
import { createBlob, githubConfigured } from '../../../lib/server/github';
import { sniffImage } from '../../../lib/server/content';

export const prerender = false;
const MAX_BYTES = 3 * 1024 * 1024; // 브라우저에서 줄여서 보내므로 보통 1MB 안팎

/** 이미지 한 장을 GitHub 에 올리고 sha 를 돌려준다 (커밋은 publish 에서 한 번에) */
export const POST: APIRoute = async ({ request, cookies }) => {
  if (!sameOrigin(request) || !isAdmin(cookies)) return json({ error: '권한이 없어요.' }, 403);
  if (!githubConfigured()) return json({ error: 'GITHUB_TOKEN 이 설정되지 않았어요.' }, 503);
  const { data } = (await request.json().catch(() => ({}))) as { data?: string };
  if (typeof data !== 'string') return json({ error: '이미지가 없어요.' }, 400);
  const buf = Buffer.from(data, 'base64');
  if (buf.length > MAX_BYTES) return json({ error: '이미지가 너무 커요. (3MB 이하)' }, 413);
  const ext = sniffImage(buf);
  if (!ext) return json({ error: 'JPG, PNG, WebP, GIF 이미지만 올릴 수 있어요.' }, 415);
  try {
    return json({ sha: await createBlob(data), ext });
  } catch (e) {
    return json({ error: `이미지를 올리지 못했어요. ${(e as Error).message}` }, 502);
  }
};
