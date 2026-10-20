import type { APIRoute } from 'astro';
import { isAdmin, json, sameOrigin } from '../../../lib/server/session';
import { env } from '../../../lib/server/env';

export const prerender = false;

/**
 * 저작권이 끝난 명화로 썸네일 고르기.
 * - 시카고 미술관(Art Institute of Chicago): 퍼블릭 도메인 작품만, 키 필요 없음
 * - 클리블랜드 미술관(Cleveland Museum of Art): CC0 작품만, 키 필요 없음
 * GET  ?q=검색어       → 두 곳을 같이 검색
 * POST {source, id}   → 그 작품 이미지를 받아 그대로 돌려준다 (브라우저가 3:2 로 잘라 썸네일로 쓴다).
 *                       이미지 주소는 서버가 작품 정보로 다시 찾는다 (아무 주소나 대신 받아 주지 않게).
 */
export type Art = {
  source: 'aic' | 'cma';
  id: string;
  title: string;
  artist: string;
  date: string;
  museum: string;
  thumb: string;
  link: string;
};

const UA = { 'AIC-User-Agent': 'yeonjae-homepage (skyyeonjae@naver.com)', accept: 'application/json' };
const MAX_BYTES = 4 * 1024 * 1024; // Vercel 응답 크기 제한 안쪽
const getJson = async (url: string) => {
  const res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`${new URL(url).host} ${res.status}`);
  return res.json() as Promise<any>;
};
const text = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

async function searchAic(q: string): Promise<Art[]> {
  const u = new URL(`${env.aicApi()}/api/v1/artworks/search`);
  u.searchParams.set('q', q);
  u.searchParams.set('query[term][is_public_domain]', 'true');
  u.searchParams.set('fields', 'id,title,artist_title,date_display,image_id,is_public_domain');
  u.searchParams.set('limit', '24');
  const d = await getJson(u.toString());
  return (d.data ?? [])
    .filter((a: any) => a.image_id && a.is_public_domain)
    .map((a: any) => ({
      source: 'aic',
      id: String(a.id),
      title: text(a.title) || '제목 없음',
      artist: text(a.artist_title),
      date: text(a.date_display),
      museum: '시카고 미술관',
      thumb: `${env.aicIiif()}/${a.image_id}/full/400,/0/default.jpg`,
      link: `https://www.artic.edu/artworks/${a.id}`,
    }));
}

async function searchCma(q: string): Promise<Art[]> {
  const u = new URL(`${env.cmaApi()}/api/artworks/`);
  u.searchParams.set('q', q);
  u.searchParams.set('cc0', '1');
  u.searchParams.set('has_image', '1');
  u.searchParams.set('limit', '24');
  const d = await getJson(u.toString());
  return (d.data ?? [])
    .filter((a: any) => a.images?.web?.url && a.share_license_status === 'CC0')
    .map((a: any) => ({
      source: 'cma',
      id: String(a.id),
      title: text(a.title) || '제목 없음',
      artist: text(a.creators?.[0]?.description).replace(/\s*\(.*\)$/, ''),
      date: text(a.creation_date),
      museum: '클리블랜드 미술관',
      thumb: a.images.web.url,
      link: text(a.url) || `https://www.clevelandart.org/art/${a.id}`,
    }));
}

export const GET: APIRoute = async ({ url, cookies }) => {
  if (!isAdmin(cookies)) return json({ error: '권한이 없어요.' }, 403);
  const q = (url.searchParams.get('q') ?? '').trim().slice(0, 80);
  if (!q) return json({ error: '검색어를 적어 주세요.' }, 400);
  const [aic, cma] = await Promise.allSettled([searchAic(q), searchCma(q)]);
  const a = aic.status === 'fulfilled' ? aic.value : [];
  const c = cma.status === 'fulfilled' ? cma.value : [];
  if (aic.status === 'rejected' && cma.status === 'rejected') {
    return json({ error: '명화 사이트에 연결하지 못했어요. 잠시 뒤 다시 해 주세요.' }, 502);
  }
  // 두 곳 결과를 번갈아 섞는다
  const results: Art[] = [];
  for (let i = 0; i < Math.max(a.length, c.length); i++) {
    if (a[i]) results.push(a[i]);
    if (c[i]) results.push(c[i]);
  }
  return json({ results });
};

async function download(src: string) {
  const res = await fetch(src, { headers: { 'AIC-User-Agent': UA['AIC-User-Agent'] }, signal: AbortSignal.timeout(15000) });
  if (!res.ok) return null;
  const type = res.headers.get('content-type') ?? '';
  if (!/^image\/(jpeg|png|webp)/.test(type)) return null;
  const buf = await res.arrayBuffer();
  return buf.byteLength <= MAX_BYTES ? { buf, type } : null;
}

export const POST: APIRoute = async ({ request, cookies }) => {
  if (!sameOrigin(request) || !isAdmin(cookies)) return json({ error: '권한이 없어요.' }, 403);
  const b = (await request.json().catch(() => ({}))) as { source?: unknown; id?: unknown };
  const id = String(b.id ?? '');
  if (!/^\d{1,12}$/.test(id) || (b.source !== 'aic' && b.source !== 'cma')) return json({ error: '잘못된 요청이에요.' }, 400);
  try {
    let img: Awaited<ReturnType<typeof download>> = null;
    if (b.source === 'aic') {
      const d = await getJson(`${env.aicApi()}/api/v1/artworks/${id}?fields=id,image_id,is_public_domain`);
      if (!d.data?.is_public_domain || !d.data.image_id) return json({ error: '퍼블릭 도메인 작품이 아니에요.' }, 400);
      // 큰 크기를 먼저, 안 되면 기본 크기
      for (const w of [1686, 843]) {
        img = await download(`${env.aicIiif()}/${d.data.image_id}/full/${w},/0/default.jpg`);
        if (img) break;
      }
    } else {
      const d = await getJson(`${env.cmaApi()}/api/artworks/${id}`);
      if (d.data?.share_license_status !== 'CC0' || !d.data.images?.web?.url) return json({ error: 'CC0 작품이 아니에요.' }, 400);
      img = await download(d.data.images.web.url);
    }
    if (!img) return json({ error: '그림을 받아오지 못했어요. 다른 작품을 골라 주세요.' }, 502);
    return new Response(img.buf, { headers: { 'content-type': img.type, 'cache-control': 'no-store' } });
  } catch (e) {
    return json({ error: `그림을 받아오지 못했어요. ${e instanceof Error ? e.message : String(e)}` }, 502);
  }
};
