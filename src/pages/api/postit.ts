import type { APIRoute } from 'astro';
import { getStore } from '../../lib/server/store';
import { isAdmin, json, sameOrigin } from '../../lib/server/session';
import { add, list, remove, update, validate } from '../../lib/server/postit';

export const prerender = false;

const isId = (s: unknown): s is string => typeof s === 'string' && /^[0-9a-f-]{36}$/.test(s);
const offline = () => json({ error: '포스트잇을 준비하고 있어요.' }, 503);

/** 누구나: 메모 목록 */
export const GET: APIRoute = async ({ cookies }) => {
  const store = getStore();
  if (!store) return offline();
  return json({ notes: await list(store), owner: isAdmin(cookies) });
};

/** 주인만: 새 메모 */
export const POST: APIRoute = async ({ request, cookies }) => {
  if (!sameOrigin(request) || !isAdmin(cookies)) return json({ error: '권한이 없어요.' }, 403);
  const store = getStore();
  if (!store) return offline();
  const v = validate((await request.json().catch(() => ({}))) as Record<string, unknown>);
  if ('error' in v) return json({ error: v.error }, 400);
  return json({ note: await add(store, v.value) }, 201);
};

/** 주인만: 고치기 */
export const PATCH: APIRoute = async ({ request, cookies }) => {
  if (!sameOrigin(request) || !isAdmin(cookies)) return json({ error: '권한이 없어요.' }, 403);
  const store = getStore();
  if (!store) return offline();
  const b = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  if (!isId(b.id)) return json({ error: '잘못된 요청이에요.' }, 400);
  const v = validate(b);
  if ('error' in v) return json({ error: v.error }, 400);
  const note = await update(store, b.id, v.value);
  return note ? json({ note }) : json({ error: '메모를 찾을 수 없어요.' }, 404);
};

/** 주인만: 떼기 */
export const DELETE: APIRoute = async ({ request, url, cookies }) => {
  if (!sameOrigin(request) || !isAdmin(cookies)) return json({ error: '권한이 없어요.' }, 403);
  const store = getStore();
  if (!store) return offline();
  const id = url.searchParams.get('id');
  if (!isId(id)) return json({ error: '잘못된 요청이에요.' }, 400);
  await remove(store, id);
  return json({ ok: true });
};
