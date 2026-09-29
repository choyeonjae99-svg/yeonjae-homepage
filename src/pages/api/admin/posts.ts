import type { APIRoute } from 'astro';
import { isAdmin, json, sameOrigin } from '../../../lib/server/session';
import { commitFiles, githubConfigured, listTree, type TreeItem } from '../../../lib/server/github';
import { IMAGE_EXT, KINDS, buildMarkdown, isKind, isSlug, slugify, type ImageExt } from '../../../lib/server/content';

export const prerender = false;

const str = (v: unknown, max: number) => String(v ?? '').trim().slice(0, max);
const list = (v: unknown) =>
  (Array.isArray(v) ? v : String(v ?? '').split(','))
    .map((t) => String(t).trim())
    .filter(Boolean)
    .slice(0, 12);
const isExt = (e: unknown): e is ImageExt => IMAGE_EXT.includes(e as ImageExt);
const isSha = (s: unknown): s is string => typeof s === 'string' && /^[0-9a-f]{40}$/.test(s);

/** 새 게시물 올리기: 마크다운 + (미리 올린) 이미지 blob 들을 한 커밋으로 */
export const POST: APIRoute = async ({ request, cookies }) => {
  if (!sameOrigin(request) || !isAdmin(cookies)) return json({ error: '권한이 없어요.' }, 403);
  if (!githubConfigured()) return json({ error: 'GITHUB_TOKEN 이 설정되지 않았어요.' }, 503);
  const b = (await request.json().catch(() => ({}))) as Record<string, unknown>;

  if (!isKind(b.kind)) return json({ error: '종류를 골라 주세요.' }, 400);
  const title = str(b.title, 120);
  if (!title) return json({ error: '제목을 적어 주세요.' }, 400);
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(b.date)) ? String(b.date) : new Date().toISOString().slice(0, 10);
  const slug = slugify(b.slug, date);
  if (!isSlug(slug)) return json({ error: '주소 이름은 영문 소문자·숫자·하이픈만 쓸 수 있어요.' }, 400);

  const thumb = b.thumbnail as { sha?: unknown; ext?: unknown } | undefined;
  const images = (Array.isArray(b.images) ? b.images : []) as { sha?: unknown; ext?: unknown }[];
  if (thumb && (!isSha(thumb.sha) || !isExt(thumb.ext))) return json({ error: '썸네일 정보가 잘못됐어요.' }, 400);
  if (images.some((i) => !isSha(i.sha) || !isExt(i.ext)) || images.length > 30) return json({ error: '이미지 정보가 잘못됐어요.' }, 400);

  const dir = KINDS[b.kind].dir;
  try {
    const existing = await listTree(`${dir}/${slug}`);
    if (existing.some((p) => p === `${dir}/${slug}.md`)) {
      return json({ error: `이미 같은 주소(${slug})의 글이 있어요. 주소 이름을 바꿔 주세요.` }, 409);
    }

    const md = buildMarkdown({
      kind: b.kind,
      slug,
      title,
      subtitle: str(b.subtitle, 120) || undefined,
      date,
      period: str(b.period, 40) || undefined,
      summary: str(b.summary, 200),
      tags: list(b.tags),
      role: str(b.role, 80) || undefined,
      tools: list(b.tools),
      thumbnailAlt: str(b.thumbnailAlt, 200) || undefined,
      body: str(b.body, 50_000),
      thumbExt: thumb ? (thumb.ext as ImageExt) : undefined,
      imageExts: images.map((i) => i.ext as ImageExt),
    });

    const items: TreeItem[] = [{ path: `${dir}/${slug}.md`, content: md }];
    if (thumb) items.push({ path: `${dir}/${slug}/thumb.${thumb.ext}`, sha: thumb.sha as string });
    images.forEach((img, i) =>
      items.push({ path: `${dir}/${slug}/${String(i + 1).padStart(2, '0')}.${img.ext}`, sha: img.sha as string }),
    );
    const sha = await commitFiles(items, `Add ${b.kind}: ${title}`);
    const base = KINDS[b.kind].collection === 'portfolio' ? '/portfolio' : '/works';
    return json({ ok: true, commit: sha, url: `${base}/${slug}` }, 201);
  } catch (e) {
    return json({ error: `올리지 못했어요. ${(e as Error).message}` }, 502);
  }
};

/** 게시물 지우기: 마크다운과 같은 이름 폴더의 이미지까지 */
export const DELETE: APIRoute = async ({ request, cookies }) => {
  if (!sameOrigin(request) || !isAdmin(cookies)) return json({ error: '권한이 없어요.' }, 403);
  if (!githubConfigured()) return json({ error: 'GITHUB_TOKEN 이 설정되지 않았어요.' }, 503);
  const b = (await request.json().catch(() => ({}))) as { kind?: unknown; slug?: unknown };
  const slug = String(b.slug ?? '');
  if (!isKind(b.kind) || !isSlug(slug)) return json({ error: '잘못된 요청이에요.' }, 400);
  const dir = KINDS[b.kind].dir;
  try {
    const paths = (await listTree(`${dir}/${slug}`)).filter((p) => p === `${dir}/${slug}.md` || p.startsWith(`${dir}/${slug}/`));
    if (!paths.some((p) => p.endsWith('.md'))) return json({ error: '글을 찾을 수 없어요.' }, 404);
    const sha = await commitFiles(paths.map((path) => ({ path, delete: true as const })), `Remove ${b.kind}: ${slug}`);
    return json({ ok: true, commit: sha });
  } catch (e) {
    return json({ error: `지우지 못했어요. ${(e as Error).message}` }, 502);
  }
};
