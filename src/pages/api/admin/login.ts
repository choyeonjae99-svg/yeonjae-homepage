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

  // 화면 스크립트가 아직 안 떴을 때는 브라우저가 폼을 그대로 보낸다 → 그 경우도 받아서 페이지로 돌려보낸다
  const isForm = (request.headers.get('content-type') ?? '').includes('application/x-www-form-urlencoded');
  let password = '';
  let next = '';
  if (isForm) {
    const fd = await request.formData().catch(() => null);
    password = String(fd?.get('password') ?? '');
    next = String(fd?.get('next') ?? '');
  } else {
    password = String(((await request.json().catch(() => ({}))) as { password?: unknown }).password ?? '');
  }
  const ok = Boolean(password) && checkPassword(password);
  if (ok) startSession(cookies);
  if (isForm) {
    const safeNext = /^\/(?![/\\])/.test(next) && !next.includes('\\') && !next.startsWith('/admin') ? next : '/admin';
    return redirect(ok ? safeNext : '/admin?error=1');
  }
  return ok ? json({ ok: true }) : json({ error: '비밀번호가 맞지 않아요.' }, 401);
};

const redirect = (to: string) => new Response(null, { status: 303, headers: { location: to, 'cache-control': 'no-store' } });

export const DELETE: APIRoute = async ({ request, cookies }) => {
  if (!sameOrigin(request)) return json({ error: '잘못된 요청이에요.' }, 403);
  endSession(cookies);
  return json({ ok: true });
};
