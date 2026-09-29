import { createHmac, timingSafeEqual } from 'node:crypto';
import type { AstroCookies } from 'astro';
import { env } from './env';

/**
 * 관리자 로그인 세션: 서명된 쿠키 (만료시각.서명).
 * 실제 권한 검사는 항상 서버에서 이 쿠키로 한다.
 * yj_admin=1 은 화면에 관리 버튼을 보여줄지 정하는 표시용 쿠키일 뿐 권한이 아니다.
 */
const COOKIE = 'yj_session';
const FLAG = 'yj_admin';
const MAX_AGE = 60 * 60 * 24 * 14; // 14일

const sign = (payload: string, secret: string) => createHmac('sha256', secret).update(payload).digest('base64url');

const safeEqual = (a: string, b: string) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

export const adminConfigured = () => Boolean(env.adminPassword() && (env.sessionSecret()?.length ?? 0) >= 16);

/** 비밀번호 확인 (길이 차이로 새지 않게 해시 비교) */
export function checkPassword(input: string) {
  const pw = env.adminPassword();
  const secret = env.sessionSecret();
  if (!pw || !secret) return false;
  return safeEqual(sign(input, secret), sign(pw, secret));
}

export function startSession(cookies: AstroCookies) {
  const secret = env.sessionSecret()!;
  const exp = String(Math.floor(Date.now() / 1000) + MAX_AGE);
  const opts = { path: '/', maxAge: MAX_AGE, sameSite: 'strict' as const, secure: import.meta.env.PROD };
  cookies.set(COOKIE, `${exp}.${sign(exp, secret)}`, { ...opts, httpOnly: true });
  cookies.set(FLAG, '1', { ...opts, httpOnly: false });
}

export function endSession(cookies: AstroCookies) {
  cookies.delete(COOKIE, { path: '/' });
  cookies.delete(FLAG, { path: '/' });
}

export function isAdmin(cookies: AstroCookies) {
  const secret = env.sessionSecret();
  const raw = cookies.get(COOKIE)?.value;
  if (!secret || !raw) return false;
  const [exp, sig] = raw.split('.');
  if (!exp || !sig || !safeEqual(sig, sign(exp, secret))) return false;
  return Number(exp) * 1000 > Date.now();
}

/** 다른 사이트에서 보낸 요청(CSRF) 막기: 쓰기 요청은 같은 출처에서만 */
export function sameOrigin(request: Request) {
  const origin = request.headers.get('origin');
  if (!origin) return false;
  return origin === new URL(request.url).origin;
}

export const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
