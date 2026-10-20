import type { APIRoute } from 'astro';
import { isAdmin } from '../../../lib/server/session';
import { getRaw, githubConfigured } from '../../../lib/server/github';

export const prerender = false;

const TYPES: Record<string, string> = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif' };

/**
 * 관리자 수정 화면용 그림 미리보기. main 에 있는 그림을 GitHub 에서 바로 읽어 준다
 * (방금 올려서 아직 배포되지 않은 그림도 보이게). 게시물 폴더의 그림만 된다.
 */
export const GET: APIRoute = async ({ url, cookies }) => {
  if (!isAdmin(cookies)) return new Response('forbidden', { status: 403 });
  if (!githubConfigured()) return new Response('not configured', { status: 503 });
  const p = url.searchParams.get('p') ?? '';
  const ext = p.split('.').pop()?.toLowerCase() ?? '';
  const okDir = /^(src\/content\/(portfolio|works)\/|public\/uploads\/)/.test(p);
  if (!okDir || !TYPES[ext] || !/^[\w.\-/]+$/.test(p) || p.split('/').includes('..')) return new Response('bad path', { status: 400 });
  try {
    const buf = await getRaw(p);
    if (!buf) return new Response('not found', { status: 404 });
    return new Response(buf, {
      headers: { 'content-type': TYPES[ext], 'cache-control': 'private, max-age=300', 'x-content-type-options': 'nosniff' },
    });
  } catch {
    return new Response('error', { status: 502 });
  }
};
