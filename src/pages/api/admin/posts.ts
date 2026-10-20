import type { APIRoute } from 'astro';
import { isAdmin, json, sameOrigin } from '../../../lib/server/session';
import { commitFiles, getText, githubConfigured, listTree, type TreeItem } from '../../../lib/server/github';
import {
  IMAGE_EXT,
  KINDS,
  RICH_RE,
  buildMarkdown,
  isKind,
  isSlug,
  readFrontmatter,
  repoPathOf,
  rewriteMarkdown,
  slugify,
  splitMarkdown,
  uploadDir,
  uploadUrl,
  type ImageExt,
} from '../../../lib/server/content';
import { sanitizeBody } from '../../../lib/server/sanitize';

export const prerender = false;

const str = (v: unknown, max: number) => String(v ?? '').trim().slice(0, max);
const list = (v: unknown) =>
  (Array.isArray(v) ? v : String(v ?? '').split(','))
    .map((t) => String(t).trim())
    .filter(Boolean)
    .slice(0, 12);
const isExt = (e: unknown): e is ImageExt => IMAGE_EXT.includes(e as ImageExt);
const isSha = (s: unknown): s is string => typeof s === 'string' && /^[0-9a-f]{40}$/.test(s);
const BODY_IMAGE_RE = /^b\d{2,3}\.(jpg|jpeg|png|webp|gif)$/;
const base = (p: string) => p.slice(p.lastIndexOf('/') + 1);
/** 관리자 화면에서 아직 배포 안 된 그림도 미리 볼 수 있게 GitHub 에서 바로 읽어 오는 주소 */
const preview = (repoPath: string) => `/api/admin/file?p=${encodeURIComponent(repoPath)}`;
const previewPrefix = (kind: string, slug: string) => `/api/admin/file?p=${uploadDir(kind, slug)}/`;

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
  const bodyImages = (Array.isArray(b.bodyImages) ? b.bodyImages : []) as { name?: unknown; sha?: unknown }[];
  if (bodyImages.length > 60 || bodyImages.some((i) => !isSha(i.sha) || typeof i.name !== 'string' || !BODY_IMAGE_RE.test(i.name))) {
    return json({ error: '본문 그림 정보가 잘못됐어요.' }, 400);
  }
  const bodyHtml =
    typeof b.bodyHtml === 'string' && b.bodyHtml.trim()
      ? sanitizeBody(b.bodyHtml.slice(0, 300_000), uploadUrl(b.kind, slug), new Set(bodyImages.map((i) => i.name as string)))
      : '';

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
      bodyHtml: bodyHtml || undefined,
      thumbExt: thumb ? (thumb.ext as ImageExt) : undefined,
      imageExts: images.map((i) => i.ext as ImageExt),
    });

    const items: TreeItem[] = [{ path: `${dir}/${slug}.md`, content: md }];
    if (thumb) items.push({ path: `${dir}/${slug}/thumb.${thumb.ext}`, sha: thumb.sha as string });
    images.forEach((img, i) =>
      items.push({ path: `${dir}/${slug}/${String(i + 1).padStart(2, '0')}.${img.ext}`, sha: img.sha as string }),
    );
    bodyImages.forEach((img) => items.push({ path: `${uploadDir(b.kind as string, slug)}/${img.name}`, sha: img.sha as string }));
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
    paths.push(...(await listTree(`${uploadDir(b.kind, slug)}/`))); // 본문 그림도 함께
    const sha = await commitFiles(paths.map((path) => ({ path, delete: true as const })), `Remove ${b.kind}: ${slug}`);
    return json({ ok: true, commit: sha });
  } catch (e) {
    return json({ error: `지우지 못했어요. ${(e as Error).message}` }, 502);
  }
};

/** 수정 화면에 채울 내용: main 의 최신 파일을 읽는다 (배포를 기다리지 않아도 된다) */
export const GET: APIRoute = async ({ url, cookies }) => {
  if (!isAdmin(cookies)) return json({ error: '권한이 없어요.' }, 403);
  if (!githubConfigured()) return json({ error: 'GITHUB_TOKEN 이 설정되지 않았어요.' }, 503);
  const kind = url.searchParams.get('kind');
  const slug = url.searchParams.get('slug') ?? '';
  if (!isKind(kind) || !isSlug(slug)) return json({ error: '잘못된 요청이에요.' }, 400);
  const dir = KINDS[kind].dir;
  try {
    const raw = await getText(`${dir}/${slug}.md`);
    const parts = raw && splitMarkdown(raw);
    if (!parts) return json({ error: '글을 찾을 수 없어요. 방금 올렸다면 잠시 뒤 다시 열어 주세요.' }, 404);
    const d = readFrontmatter(parts.fm);
    const rich = parts.body.match(RICH_RE);
    const uploads = (await listTree(`${uploadDir(kind, slug)}/`)).map(base);
    const text = (v: unknown) => (v == null ? '' : String(v));
    const arr = (v: unknown) => (Array.isArray(v) ? v.map(String) : []);
    const img = (rel: unknown) => {
      const p = repoPathOf(dir, rel);
      return p ? { path: String(rel), url: preview(p) } : null;
    };
    return json({
      kind,
      slug,
      title: text(d.title),
      subtitle: text(d.subtitle),
      date: d.date instanceof Date ? d.date.toISOString().slice(0, 10) : text(d.date).slice(0, 10),
      period: text(d.period),
      summary: text(d.summary),
      tags: arr(d.tags),
      role: text(d.role),
      tools: arr(d.tools),
      thumbnailAlt: text(d.thumbnailAlt),
      thumbnail: img(d.thumbnail),
      images: (Array.isArray(d.images) ? d.images : []).map(img).filter(Boolean),
      mode: rich || !parts.body.trim() ? 'rich' : 'markdown',
      // 편집기 안에서는 본문 그림을 GitHub 에서 바로 읽어 보여 주고, 저장할 때 원래 주소로 되돌린다
      body: rich ? rich[1].split(uploadUrl(kind, slug)).join(previewPrefix(kind, slug)) : parts.body,
      previewPrefix: previewPrefix(kind, slug),
      uploadPrefix: uploadUrl(kind, slug),
      uploads,
    });
  } catch (e) {
    return json({ error: `불러오지 못했어요. ${(e as Error).message}` }, 502);
  }
};

type ImgIn = { keep?: unknown; sha?: unknown; ext?: unknown };

/** 글 수정: 주소 이름(slug)·종류는 그대로, 내용·그림을 바꿔 한 커밋으로 */
export const PUT: APIRoute = async ({ request, cookies }) => {
  if (!sameOrigin(request) || !isAdmin(cookies)) return json({ error: '권한이 없어요.' }, 403);
  if (!githubConfigured()) return json({ error: 'GITHUB_TOKEN 이 설정되지 않았어요.' }, 503);
  const b = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const slug = String(b.slug ?? '');
  if (!isKind(b.kind) || !isSlug(slug)) return json({ error: '잘못된 요청이에요.' }, 400);
  const kind = b.kind;
  const title = str(b.title, 120);
  if (!title) return json({ error: '제목을 적어 주세요.' }, 400);
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(b.date)) ? String(b.date) : null;
  if (!date) return json({ error: '날짜를 확인해 주세요.' }, 400);

  const images = (Array.isArray(b.images) ? b.images : []) as ImgIn[];
  const okImg = (i: ImgIn) => (i.keep !== undefined ? typeof i.keep === 'string' : isSha(i.sha) && isExt(i.ext));
  if (images.length > 30 || !images.every(okImg)) return json({ error: '이미지 정보가 잘못됐어요.' }, 400);
  const thumb = b.thumbnail as ImgIn | null | undefined; // undefined: 그대로, null: 빼기
  if (thumb && !okImg(thumb)) return json({ error: '썸네일 정보가 잘못됐어요.' }, 400);
  const bodyImages = (Array.isArray(b.bodyImages) ? b.bodyImages : []) as { name?: unknown; sha?: unknown }[];
  if (bodyImages.length > 60 || bodyImages.some((i) => !isSha(i.sha) || typeof i.name !== 'string' || !BODY_IMAGE_RE.test(i.name))) {
    return json({ error: '본문 그림 정보가 잘못됐어요.' }, 400);
  }

  const dir = KINDS[kind].dir;
  const isPortfolio = KINDS[kind].collection === 'portfolio';
  const mdPath = `${dir}/${slug}.md`;
  try {
    const raw = await getText(mdPath);
    const parts = raw && splitMarkdown(raw);
    if (!parts) return json({ error: '글을 찾을 수 없어요.' }, 404);
    const d = readFrontmatter(parts.fm);
    const folder = `${dir}/${slug}/`;
    const folderFiles = new Set(await listTree(folder));
    const uploadsDir = `${uploadDir(kind, slug)}/`;
    const uploads = new Set((await listTree(uploadsDir)).map(base));
    const items: TreeItem[] = [];
    const removed = new Set<string>(); // 더 이상 안 쓰는 그림 (이 글 폴더 안의 것만 지운다)
    const freeName = (stem: (n: number) => string) => {
      for (let n = 1; ; n++) {
        const p = `${folder}${stem(n)}`;
        if (!folderFiles.has(p)) return (folderFiles.add(p), p);
      }
    };

    // 글 아래 그림 모음: 남길 것(순서 포함) + 새로 올린 것
    const oldImages = (Array.isArray(d.images) ? d.images : []).map(String);
    const nextImages: string[] = [];
    let nextNo = 1 + Math.max(0, ...[...folderFiles].map((p) => Number(base(p).match(/^(\d+)\./)?.[1] ?? 0)));
    for (const i of images) {
      if (i.keep !== undefined) {
        if (!oldImages.includes(i.keep as string)) return json({ error: '이미지 목록이 바뀌었어요. 새로고침 후 다시 해 주세요.' }, 409);
        nextImages.push(i.keep as string);
      } else {
        const p = freeName(() => `${String(nextNo++).padStart(2, '0')}.${i.ext}`);
        items.push({ path: p, sha: i.sha as string });
        nextImages.push(`./${p.slice(dir.length + 1)}`);
      }
    }
    oldImages.filter((o) => !nextImages.includes(o)).forEach((o) => removed.add(o));

    // 썸네일: 그대로 / 바꾸기 / 빼기
    let thumbnail = typeof d.thumbnail === 'string' ? d.thumbnail : undefined;
    if (thumb === null) {
      if (thumbnail) removed.add(thumbnail);
      thumbnail = undefined;
    } else if (thumb && thumb.keep === undefined) {
      if (thumbnail) removed.add(thumbnail);
      const p = freeName((n) => `thumb${n > 1 ? `-${n}` : ''}.${thumb.ext}`);
      items.push({ path: p, sha: thumb.sha as string });
      thumbnail = `./${p.slice(dir.length + 1)}`;
    }

    // 본문
    let body: string;
    const newBody = new Set(bodyImages.map((i) => i.name as string));
    if (b.mode === 'markdown') {
      body = String(b.body ?? '').slice(0, 50_000);
    } else {
      for (const n of newBody) if (uploads.has(n)) return json({ error: '본문 그림 이름이 겹쳐요. 새로고침 후 다시 해 주세요.' }, 409);
      const html = typeof b.bodyHtml === 'string' ? b.bodyHtml.slice(0, 300_000) : '';
      const clean = html.trim() ? sanitizeBody(html, uploadUrl(kind, slug), new Set([...uploads, ...newBody])) : '';
      body = clean ? `<div class="rich">${clean}</div>` : '';
      const used = new Set([...clean.matchAll(/src="([^"]+)"/g)].map((m) => base(m[1])));
      bodyImages.filter((i) => used.has(i.name as string)).forEach((i) => items.push({ path: `${uploadsDir}${i.name}`, sha: i.sha as string }));
      [...uploads].filter((n) => !used.has(n)).forEach((n) => items.push({ path: `${uploadsDir}${n}`, delete: true }));
    }

    // 썸네일·그림 모음 어디에도 안 남은 파일만, 이 글 폴더 안에 있을 때 지운다
    const stillUsed = new Set([...nextImages, thumbnail].filter(Boolean).map((r) => repoPathOf(dir, r)));
    for (const r of removed) {
      const p = repoPathOf(dir, r);
      if (p && p.startsWith(folder) && !stillUsed.has(p) && folderFiles.has(p)) items.push({ path: p, delete: true });
    }

    const opt = (v: unknown, max: number) => str(v, max) || undefined;
    const changes: Record<string, unknown> = {
      title,
      date,
      summary: str(b.summary, 200),
      tags: list(b.tags),
      thumbnail,
      thumbnailAlt: thumbnail ? str(b.thumbnailAlt, 200) || title : undefined,
      images: nextImages.length ? nextImages : undefined,
    };
    if (isPortfolio) {
      Object.assign(changes, {
        subtitle: opt(b.subtitle, 120),
        period: str(b.period, 40) || date.slice(0, 7).replace('-', '.'),
        role: opt(b.role, 80),
        tools: list(b.tools).length ? list(b.tools) : undefined,
      });
      if (nextImages.length && !d.imagesCaption) changes.imagesCaption = '이미지';
    }
    items.unshift({ path: mdPath, content: rewriteMarkdown(parts.fm, changes, body) });
    const sha = await commitFiles(items, `Edit ${kind}: ${title}`);
    const site = isPortfolio ? '/portfolio' : '/works';
    return json({ ok: true, commit: sha, url: `${site}/${slug}` });
  } catch (e) {
    return json({ error: `저장하지 못했어요. ${(e as Error).message}` }, 502);
  }
};
