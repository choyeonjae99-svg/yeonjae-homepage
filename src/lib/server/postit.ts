import { randomUUID } from 'node:crypto';
import type { Store } from './store';

/**
 * 포스트잇: 주인이 남기는 짧은 메모. 누구나 볼 수 있고, 쓰기·고치기·떼기는 주인만.
 * 방명록과 같은 Redis 에 저장해서 다시 배포하지 않아도 바로 보인다.
 */
export const COLORS = ['cream', 'pink', 'wine', 'gray'] as const;
export type NoteColor = (typeof COLORS)[number];
export interface Note {
  id: string;
  text: string;
  color: NoteColor;
  createdAt: number;
  updatedAt?: number;
}

const H = 'pi:notes';
const Z = 'pi:index';
export const MAX_TEXT = 1000;
export const MAX_NOTES = 200;

export function validate(body: Record<string, unknown>) {
  const text = String(body.text ?? '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/\r\n?/g, '\n')
    .trim()
    .slice(0, MAX_TEXT);
  if (!text) return { error: '메모를 적어 주세요.' } as const;
  const color: NoteColor = COLORS.includes(body.color as NoteColor) ? (body.color as NoteColor) : 'cream';
  return { value: { text, color } } as const;
}

const parse = (r: string | null) => {
  if (!r) return null;
  try {
    return JSON.parse(r) as Note;
  } catch {
    return null;
  }
};

export async function list(store: Store): Promise<Note[]> {
  const ids = await store.zrevrange(Z, 0, MAX_NOTES - 1);
  const rows = await Promise.all(ids.map((id) => store.hget(H, id)));
  return rows.map(parse).filter((n): n is Note => n !== null);
}

export async function add(store: Store, v: { text: string; color: NoteColor }) {
  const n: Note = { ...v, id: randomUUID(), createdAt: Date.now() };
  await store.hset(H, n.id, JSON.stringify(n));
  await store.zadd(Z, n.createdAt, n.id);
  return n;
}

export async function update(store: Store, id: string, v: { text: string; color: NoteColor }) {
  const cur = parse(await store.hget(H, id));
  if (!cur) return null;
  const n: Note = { ...cur, ...v, updatedAt: Date.now() };
  await store.hset(H, id, JSON.stringify(n));
  return n;
}

export async function remove(store: Store, id: string) {
  await store.hdel(H, id);
  await store.zrem(Z, id);
}
