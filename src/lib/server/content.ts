import { randomBytes } from 'node:crypto';

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
  thumbExt?: ImageExt;
  imageExts: ImageExt[];
}

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
  }
  lines.push('---', '', p.body.trim(), '');
  return lines.join('\n');
}
