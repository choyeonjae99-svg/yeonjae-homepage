import type { APIRoute } from 'astro';
import { isAdmin, json, sameOrigin } from '../../../lib/server/session';
import { commitFiles, getText, githubConfigured, listTree, type TreeItem } from '../../../lib/server/github';
import { IMAGE_EXT, readFrontmatter, rewriteMarkdown, splitMarkdown, type ImageExt } from '../../../lib/server/content';

export const prerender = false;

/**
 * 소개 페이지 고치기: 프로필(profile.md) · 이력(cv.json) · 논문(papers.json) 을 한 번에.
 * GET 은 main 의 최신 파일을 읽고, PUT 은 검사한 뒤 한 커밋으로 올린다 → 1–2분 뒤 재배포.
 * 사이트 빌드가 깨지지 않도록 콘텐츠 규칙(src/content.config.ts)과 같은 기준으로 검사한다.
 */
const DIR = 'src/content/about';
const P = { profile: `${DIR}/profile.md`, cv: `${DIR}/cv.json`, papers: `${DIR}/papers.json` };
const CV_KEYS = ['education', 'projects', 'awards'] as const;
const TYPES = ['thesis', 'journal', 'conference'] as const;

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));
const str = (v: unknown, max: number) =>
  String(v ?? '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .trim()
    .slice(0, max);
const list = (v: unknown, maxItems: number, maxLen: number) =>
  (Array.isArray(v) ? v : String(v ?? '').split(','))
    .map((t) => str(t, maxLen))
    .filter(Boolean)
    .slice(0, maxItems);
const isUrl = (s: string) => {
  try {
    const u = new URL(s);
    return u.protocol === 'https:' || u.protocol === 'http:';
  } catch {
    return false;
  }
};
class Bad extends Error {}

export const GET: APIRoute = async ({ cookies }) => {
  if (!isAdmin(cookies)) return json({ error: '권한이 없어요.' }, 403);
  if (!githubConfigured()) return json({ error: 'GITHUB_TOKEN 이 설정되지 않았어요.' }, 503);
  try {
    const [rawProfile, rawCv, rawPapers] = await Promise.all([getText(P.profile), getText(P.cv), getText(P.papers)]);
    const parts = rawProfile && splitMarkdown(rawProfile);
    if (!parts || !rawCv || !rawPapers) return json({ error: '소개 파일을 찾지 못했어요.' }, 404);
    const d = readFrontmatter(parts.fm);
    const photo = typeof d.photo === 'string' ? `${DIR}/${d.photo.replace(/^\.\//, '')}` : null;
    return json({
      profile: {
        name: String(d.name ?? ''),
        nameEn: String(d.nameEn ?? ''),
        headline: String(d.headline ?? ''),
        email: String(d.email ?? ''),
        interests: Array.isArray(d.interests) ? d.interests.map(String) : [],
        photoAlt: String(d.photoAlt ?? ''),
        photoUrl: photo ? `/api/admin/file?p=${encodeURIComponent(photo)}` : null,
        body: parts.body.trim(),
      },
      cv: JSON.parse(rawCv),
      papers: JSON.parse(rawPapers),
    });
  } catch (e) {
    return json({ error: `불러오지 못했어요. ${msg(e)}` }, 502);
  }
};

function checkRows(v: unknown, label: string, withPeriod: boolean) {
  if (!Array.isArray(v)) return [];
  if (v.length > 50) throw new Bad(`${label}은 50개까지예요.`);
  return v
    .map((r: Record<string, unknown>) => {
      const row: Record<string, string> = {};
      if (withPeriod) row.period = str(r?.period, 40);
      row.title = str(r?.title, 200);
      row.note = str(r?.note, 600);
      return row;
    })
    .filter((r) => r.title || r.note || r.period)
    .map((r, i) => {
      if (!r.title) throw new Bad(`${label} ${i + 1}번째 줄의 내용(제목)을 적어 주세요.`);
      return r;
    });
}

function checkPapers(v: unknown) {
  if (!Array.isArray(v)) throw new Bad('논문 정보가 잘못됐어요.');
  if (v.length > 50) throw new Bad('논문은 50개까지예요.');
  const used = new Set<string>();
  return v.map((raw: Record<string, unknown>, i) => {
    const n = `논문 ${i + 1}번째`;
    const type = TYPES.includes(raw?.type as never) ? (raw.type as string) : 'journal';
    const title = str(raw?.title, 300);
    if (!title) throw new Bad(`${n}: 제목을 적어 주세요.`);
    const authors = list(raw?.authors, 20, 40);
    if (!authors.length) throw new Bad(`${n}: 저자를 한 명 이상 적어 주세요.`);
    const venue = str(raw?.venue, 200);
    if (!venue) throw new Bad(`${n}: 학회지·학교 이름을 적어 주세요.`);
    const year = Number(raw?.year);
    if (!Number.isInteger(year) || year < 1900 || year > 2100) throw new Bad(`${n}: 연도를 숫자로 적어 주세요 (예: 2026).`);
    const monthRaw = raw?.month === '' || raw?.month == null ? undefined : Number(raw.month);
    if (monthRaw !== undefined && (!Number.isInteger(monthRaw) || monthRaw < 1 || monthRaw > 12)) throw new Bad(`${n}: 월은 1–12 사이 숫자예요.`);
    const links = (Array.isArray(raw?.links) ? raw.links : []).slice(0, 10).map((l: Record<string, unknown>) => ({ label: str(l?.label, 40), href: str(l?.href, 500) }));
    links.forEach((l: { label: string; href: string }) => {
      if (!l.label || !isUrl(l.href)) throw new Bad(`${n}: 링크는 "이름 | https://주소" 형식이어야 해요.`);
    });
    let id = typeof raw?.id === 'string' && /^[\w-]{1,60}$/.test(raw.id) ? raw.id : '';
    if (!id || used.has(id)) id = `${type}-${year}-${Math.random().toString(36).slice(2, 6)}`;
    used.add(id);
    const p: Record<string, unknown> = { id, type, title };
    const opt = (k: string, max: number) => {
      const s = str(raw?.[k], max);
      if (s) p[k] = s;
    };
    opt('subtitle', 300);
    opt('titleEn', 300);
    p.authors = authors;
    p.venue = venue;
    opt('volume', 100);
    p.year = year;
    if (monthRaw !== undefined) p.month = monthRaw;
    p.summary = str(raw?.summary, 2000);
    p.keywords = list(raw?.keywords, 15, 40);
    opt('note', 300);
    p.links = links;
    return p;
  });
}

export const PUT: APIRoute = async ({ request, cookies }) => {
  if (!sameOrigin(request) || !isAdmin(cookies)) return json({ error: '권한이 없어요.' }, 403);
  if (!githubConfigured()) return json({ error: 'GITHUB_TOKEN 이 설정되지 않았어요.' }, 503);
  const b = (await request.json().catch(() => ({}))) as Record<string, any>;
  try {
    // 프로필
    const pr = b.profile ?? {};
    const name = str(pr.name, 40);
    const nameEn = str(pr.nameEn, 60);
    const headline = str(pr.headline, 160);
    const email = str(pr.email, 120);
    if (!name || !nameEn || !headline) throw new Bad('이름·영문 이름·한 줄 소개를 적어 주세요.');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Bad('이메일 주소를 확인해 주세요.');
    const photo = pr.photo as { sha?: unknown; ext?: unknown } | undefined;
    if (photo && (typeof photo.sha !== 'string' || !/^[0-9a-f]{40}$/.test(photo.sha) || !IMAGE_EXT.includes(photo.ext as ImageExt) || photo.ext === 'gif')) {
      throw new Bad('사진 정보가 잘못됐어요.');
    }
    // 이력 · 논문
    const cvIn = b.cv ?? {};
    const cvOut: Record<string, unknown> = {};
    const LABEL = { education: '학력', projects: '참여 연구 과제', awards: '수상' };
    for (const k of CV_KEYS) cvOut[k] = checkRows(cvIn[k], LABEL[k], true);
    cvOut.skills = checkRows(cvIn.skills, '역량', false);
    const papers = checkPapers(b.papers);

    const rawProfile = await getText(P.profile);
    const parts = rawProfile && splitMarkdown(rawProfile);
    const rawCv = await getText(P.cv);
    if (!parts || !rawCv) return json({ error: '소개 파일을 찾지 못했어요.' }, 404);
    const d = readFrontmatter(parts.fm);

    const items: TreeItem[] = [];
    const changes: Record<string, unknown> = {
      name,
      nameEn,
      headline,
      photoAlt: str(pr.photoAlt, 200) || `${name} 프로필 사진`,
      email,
      interests: list(pr.interests, 12, 30),
    };
    if (photo) {
      const next = `profile.${photo.ext}`;
      const prev = typeof d.photo === 'string' ? d.photo.replace(/^\.\//, '') : '';
      items.push({ path: `${DIR}/${next}`, sha: photo.sha as string });
      if (prev && prev !== next && /^[\w.-]+$/.test(prev) && (await listTree(`${DIR}/${prev}`)).includes(`${DIR}/${prev}`)) {
        items.push({ path: `${DIR}/${prev}`, delete: true });
      }
      changes.photo = `./${next}`;
    }
    const body = str(pr.body, 6000);
    const md = rewriteMarkdown(parts.fm, changes, body || '[여기에 소개글]');
    // 이력: 화면에 없는 다른 항목이 있으면 그대로 둔다
    const cv = { ...JSON.parse(rawCv), ...cvOut };
    items.unshift(
      { path: P.profile, content: md },
      { path: P.cv, content: `${JSON.stringify(cv, null, 2)}\n` },
      { path: P.papers, content: `${JSON.stringify(papers, null, 2)}\n` },
    );
    const sha = await commitFiles(items, 'Edit about page');
    return json({ ok: true, commit: sha });
  } catch (e) {
    if (e instanceof Bad) return json({ error: e.message }, 400);
    console.error('[api/admin/about]', e);
    return json({ error: `저장하지 못했어요. ${msg(e)}` }, 502);
  }
};
