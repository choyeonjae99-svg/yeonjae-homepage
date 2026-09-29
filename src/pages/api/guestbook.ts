import type { APIRoute } from 'astro';
import { getStore } from '../../lib/server/store';
import { isAdmin, json, sameOrigin } from '../../lib/server/session';
import * as gb from '../../lib/server/guestbook';

export const prerender = false;

/** 방명록 목록: 방문자에게는 공개 글만(연락처 없이), 주인에게는 전부 */
export const GET: APIRoute = async ({ cookies }) => {
  const store = getStore();
  if (!store) return json({ error: '방명록이 아직 준비되지 않았어요.' }, 503);
  const all = await gb.list(store);
  if (isAdmin(cookies)) return json({ admin: true, entries: all });
  return json({ admin: false, entries: all.filter((e) => e.isPublic).map(gb.toPublic) });
};

/** 방명록 쓰기 */
export const POST: APIRoute = async ({ request, clientAddress }) => {
  if (!sameOrigin(request)) return json({ error: '잘못된 요청이에요.' }, 403);
  const store = getStore();
  if (!store) return json({ error: '방명록이 아직 준비되지 않았어요.' }, 503);

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return json({ error: '잘못된 요청이에요.' }, 400);
  }
  // 스팸 봇용 함정 칸: 사람은 보지 못하는 칸이 채워져 있으면 저장하지 않고 성공한 척한다
  if (typeof body.website === 'string' && body.website.trim()) return json({ ok: true });

  const v = gb.validate(body);
  if ('error' in v) return json({ error: v.error }, 400);

  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || clientAddress || 'unknown';
  if (await gb.rateLimited(store, ip)) return json({ error: '잠시 뒤에 다시 남겨 주세요. (10분에 3번까지)' }, 429);

  const e = await gb.add(store, v.value);
  return json({ ok: true, entry: e.isPublic ? gb.toPublic(e) : null }, 201);
};

/** 주인: 답장·공개 여부 바꾸기 */
export const PATCH: APIRoute = async ({ request, cookies }) => {
  if (!sameOrigin(request) || !isAdmin(cookies)) return json({ error: '권한이 없어요.' }, 403);
  const store = getStore();
  if (!store) return json({ error: '방명록이 아직 준비되지 않았어요.' }, 503);
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const id = String(body.id ?? '');
  const e = await gb.update(store, id, {
    reply: typeof body.reply === 'string' ? body.reply : undefined,
    isPublic: typeof body.isPublic === 'boolean' ? body.isPublic : undefined,
  });
  return e ? json({ ok: true, entry: e }) : json({ error: '글을 찾을 수 없어요.' }, 404);
};

/** 주인: 지우기 */
export const DELETE: APIRoute = async ({ request, cookies, url }) => {
  if (!sameOrigin(request) || !isAdmin(cookies)) return json({ error: '권한이 없어요.' }, 403);
  const store = getStore();
  if (!store) return json({ error: '방명록이 아직 준비되지 않았어요.' }, 503);
  await gb.remove(store, url.searchParams.get('id') ?? '');
  return json({ ok: true });
};
