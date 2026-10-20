import { randomBytes } from 'node:crypto';
import { parseDocument } from 'yaml';

/** 본문 그림이 저장되는 공개 폴더 (그대로 서빙되어 다시 압축되지 않는다) */
export const uploadDir = (kind: string, slug: string) => `public/uploads/${kind}/${slug}`;
export const uploadUrl = (kind: string, slug: string) => `/uploads/${kind}/${slug}/`;

/** 업로드 종류 → 저장 폴더 */
export const KINDS = {
  research: { dir: 'src/content/portfolio/research', collection: 'portfolio', label: '연구 포트폴리오' },
  design: { dir: 'src/content/portfolio/design', collection: 'portfolio', label: '디자인 포트폴리오' },
  writing: { dir: 'src/content/works/writing', collection: 'works', label: '글' },
  drawing: { dir: 'src/content/works/drawing', collection: 'works', label: '그림' },
} as const;
export type Kind = keyof typeof KINDS;
export const isKind = (k: unknown): k is Kind => typeof k === 'string' && k in KINDS;

export const IMAGE_EXT = ['jpg', 'jpeg', 'png', 'webp', 'gif'] as const;
export type ImageExt = (typeof IMAGE_EXT)[number];

/** 파일 앞부분으로 진짜 이미지인지 확인 */
export function sniffImage(buf: Buffer): ImageExt | null {
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (buf.subarray(0, 4).toString('ascii') === 'RIFF' && buf.subarray(8, 12).toString('ascii') === 'WEBP') return 'webp';
  if (buf.subarray(0, 4).toString('ascii') === 'GIF8') return 'gif';
  return null;
}

/** 주소로 쓸 영문 이름. 비어 있으면 날짜-임의문자 */
export function slugify(input: unknown, date: string) {
  const s = String(input ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return s || `${date.replaceAll('-', '')}-${randomBytes(2).toString('hex')}`;
}

export const isSlug = (s: string) => /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(s) && s.length <= 80;

/** YAML frontmatter 값: JSON 문자열은 그대로 올바른 YAML 이다 */
const y = (v: unknown) => JSON.stringify(v);

export interface Post {
  kind: Kind;
  slug: string;
  title: string;
  subtitle?: string;
  date: string; // YYYY-MM-DD
  period?: string;
  summary: string;
  tags: string[];
  role?: string;
  tools: string[];
  thumbnailAlt?: string;
  body: string;
  /** 편집기로 쓴 본문 (정리된 HTML). 있으면 body 대신 쓴다 */
  bodyHtml?: string;
  thumbExt?: ImageExt;
  imageExts: ImageExt[];
  /** 그림 모음 각각의 크기 (images 와 같은 순서) */
  imageSizes?: string[];
}

export const GALLERY_SIZES = ['original', 'small', 'medium', 'full'] as const;
/** 크기 목록: 하나라도 원본이 아닐 때만 저장한다 */
export const sizesOrUndefined = (sizes: string[]) => (sizes.some((x) => x !== 'original') ? sizes : undefined);

/** 마크다운 파일 내용 만들기 */
export function buildMarkdown(p: Post) {
  const isPortfolio = KINDS[p.kind].collection === 'portfolio';
  const lines = ['---', `title: ${y(p.title)}`];
  if (isPortfolio && p.subtitle) lines.push(`subtitle: ${y(p.subtitle)}`);
  lines.push(`category: ${p.kind}`, `date: ${p.date}`);
  if (isPortfolio) lines.push(`period: ${y(p.period || p.date.slice(0, 7).replace('-', '.'))}`);
  if (p.thumbExt) {
    lines.push(`thumbnail: ${y(`./${p.slug}/thumb.${p.thumbExt}`)}`);
    lines.push(`thumbnailAlt: ${y(p.thumbnailAlt || p.title)}`);
  }
  lines.push(`summary: ${y(p.summary)}`, `tags: ${y(p.tags)}`);
  if (isPortfolio && p.role) lines.push(`role: ${y(p.role)}`);
  if (isPortfolio && p.tools.length) lines.push(`tools: ${y(p.tools)}`);
  if (p.imageExts.length) {
    lines.push('images:');
    p.imageExts.forEach((ext, i) => lines.push(`  - ${y(`./${p.slug}/${String(i + 1).padStart(2, '0')}.${ext}`)}`));
    if (isPortfolio) lines.push(`imagesCaption: ${y('이미지')}`);
    const sizes = sizesOrUndefined(p.imageSizes ?? []);
    if (sizes) lines.push(`imageSizes: ${y(sizes)}`);
  }
  // 편집기 본문은 한 줄짜리 <div class="rich"> 로 넣어 마크다운이 건드리지 않게 한다
  const body = p.bodyHtml ? `<div class="rich">${p.bodyHtml}</div>` : p.body.trim();
  lines.push('---', '', body, '');
  return lines.join('\n');
}

// ── 수정: 이미 있는 글 읽고 고쳐 쓰기 ──

/** 편집기로 쓴 본문 */
export const RICH_RE = /^\s*<div class="rich">([\s\S]*)<\/div>\s*$/;

/** 마크다운 파일 → frontmatter 글자 + 본문 */
export function splitMarkdown(raw: string) {
  const m = raw.replace(/^\uFEFF/, '').match(/^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n([\s\S]*))?$/);
  if (!m) return null;
  return { fm: m[1], body: (m[2] ?? '').replace(/^\r?\n/, '') };
}

export function readFrontmatter(fm: string) {
  const doc = parseDocument(fm);
  if (doc.errors.length) throw new Error('글 머리말(frontmatter)을 읽지 못했어요.');
  return (doc.toJS() ?? {}) as Record<string, unknown>;
}

/**
 * frontmatter 의 몇몇 값만 바꾼다. 화면에 없는 값(highlights, links 등)과 순서·주석은 그대로 둔다.
 * 값이 undefined 면 그 줄을 지운다.
 */
export function rewriteMarkdown(fm: string, changes: Record<string, unknown>, body: string) {
  const doc = parseDocument(fm);
  for (const [k, v] of Object.entries(changes)) {
    if (v === undefined) doc.delete(k);
    else {
      const node = doc.createNode(v);
      // 짧은 글자 목록(태그·도구)은 한 줄로
      if (Array.isArray(v) && (k === 'tags' || k === 'tools' || k === 'imageSizes')) (node as { flow?: boolean }).flow = true;
      doc.set(k, node);
    }
  }
  return `---\n${doc.toString({ lineWidth: 0 })}---\n\n${body.trim()}\n`;
}

/** frontmatter 의 상대 경로(./slug/01.webp) → 저장소 경로. 이 글 폴더 밖이나 이상한 경로는 null */
export function repoPathOf(dir: string, rel: unknown) {
  if (typeof rel !== 'string') return null;
  const clean = rel.replace(/^\.\//, '');
  if (!/^[\w.\-/]+$/.test(clean) || clean.split('/').some((seg) => seg === '..' || seg === '')) return null;
  return `${dir}/${clean}`;
}
