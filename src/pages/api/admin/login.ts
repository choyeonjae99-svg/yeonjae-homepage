import type { APIRoute } from 'astro';
import { adminConfigured, checkPassword, endSession, json, sameOrigin, startSession } from '../../../lib/server/session';
import { getStore } from '../../../lib/server/store';

export const prerender = false;

export const POST: APIRoute = async ({ request, cookies, clientAddress }) => {
  if (!sameOrigin(request)) return json({ error: '잘못된 요청이에요.' }, 403);
  if (!adminConfigured()) return json({ error: '관리자 비밀번호가 아직 설정되지 않았어요. (ADMIN_PASSWORD, SESSION_SECRET)' }, 503);

  // 비밀번호 대입 막기: 15분에 10번까지
  const store = getStore();
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || clientAddress || 'unknown';
  if (store && (await store.incr(`admin:login:${ip}`, 900)) > 10) {
    return json({ error: '시도가 너무 많아요. 15분 뒤에 다시 해 주세요.' }, 429);
  }

  const { password } = (await request.json().catch(() => ({}))) as { password?: string };
  if (!password || !checkPassword(password)) return json({ error: '비밀번호가 맞지 않아요.' }, 401);
  startSession(cookies);
  return json({ ok: true });
};

export const DELETE: APIRoute = async ({ request, cookies }) => {
  if (!sameOrigin(request)) return json({ error: '잘못된 요청이에요.' }, 403);
  endSession(cookies);
  return json({ ok: true });
};
