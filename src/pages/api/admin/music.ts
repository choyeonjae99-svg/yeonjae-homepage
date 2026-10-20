import type { APIRoute } from 'astro';
import { isAdmin, json, sameOrigin } from '../../../lib/server/session';
import { commitFiles, githubConfigured } from '../../../lib/server/github';

export const prerender = false;

/** 박자 설정 저장 → src/data/music.json 커밋 */
export const POST: APIRoute = async ({ request, cookies }) => {
  if (!sameOrigin(request) || !isAdmin(cookies)) return json({ error: '권한이 없어요.' }, 403);
  if (!githubConfigured()) return json({ error: 'GITHUB_TOKEN 이 설정되지 않았어요.' }, 503);
  const b = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const bpm = Number(b.bpm);
  const offset = Number(b.offset);
  const beatsPerBar = Number(b.beatsPerBar ?? 4);
  if (!(bpm >= 40 && bpm <= 240)) return json({ error: 'BPM 은 40–240 사이여야 해요.' }, 400);
  if (!(offset >= 0 && offset < 60)) return json({ error: '첫 박 위치가 잘못됐어요.' }, 400);
  if (![2, 3, 4, 6].includes(beatsPerBar)) return json({ error: '한 마디 박 수는 2, 3, 4, 6 중 하나예요.' }, 400);
  const content = JSON.stringify({ bpm: Math.round(bpm * 100) / 100, offset: Math.round(offset * 1000) / 1000, beatsPerBar }, null, 2) + '\n';
  try {
    const sha = await commitFiles([{ path: 'src/data/music.json', content }], `Update music beat: ${bpm} BPM`);
    return json({ ok: true, commit: sha });
  } catch (e) {
    return json({ error: `저장하지 못했어요. ${(e as Error).message}` }, 502);
  }
};
