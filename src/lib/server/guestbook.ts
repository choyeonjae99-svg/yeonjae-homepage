import { createHash, randomUUID } from 'node:crypto';
import type { Store } from './store';

/**
 * 방명록 한 건. contact(연락처)는 주인에게만 보인다.
 * isPublic=false(기본) 이면 글 자체도 주인에게만 보인다.
 */
export interface Entry {
  id: string;
  name: string;
  contact: string;
  message: string;
  isPublic: boolean;
  createdAt: number;
  reply?: string;
  repliedAt?: number;
}
export type PublicEntry = Pick<Entry, 'id' | 'name' | 'message' | 'createdAt' | 'reply' | 'repliedAt'>;

const H = 'gb:entries';
const Z = 'gb:index';
export const LIMITS = { name: 30, contact: 100, message: 1000, reply: 1000 };

const clean = (v: unknown, max: number) =>
  String(v ?? '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .trim()
    .slice(0, max);

export function validate(body: Record<string, unknown>) {
  const name = clean(body.name, LIMITS.name);
  const contact = clean(body.contact, LIMITS.contact);
  const message = clean(body.message, LIMITS.message);
  if (!name) return { error: '이름을 적어 주세요.' } as const;
  if (message.length < 2) return { error: '메시지를 적어 주세요.' } as const;
  return { value: { name, contact, message, isPublic: body.isPublic === true } } as const;
}

/** 같은 사람이 10분에 3번까지만 쓸 수 있다 (IP 는 해시로만 쓴다) */
export async function rateLimited(store: Store, ip: string) {
  const key = `gb:rl:${createHash('sha256').update(ip).digest('hex').slice(0, 16)}`;
  return (await store.incr(key, 600)) > 3;
}

export async function add(store: Store, v: Omit<Entry, 'id' | 'createdAt'>) {
  const e: Entry = { ...v, id: randomUUID(), createdAt: Date.now() };
  await store.hset(H, e.id, JSON.stringify(e));
  await store.zadd(Z, e.createdAt, e.id);
  return e;
}

export async function list(store: Store, limit = 200): Promise<Entry[]> {
  const ids = await store.zrevrange(Z, 0, limit - 1);
  const rows = await Promise.all(ids.map((id) => store.hget(H, id)));
  return rows.flatMap((r) => {
    if (!r) return [];
    try {
      return [JSON.parse(r) as Entry];
    } catch {
      return [];
    }
  });
}

export const toPublic = ({ id, name, message, createdAt, reply, repliedAt }: Entry): PublicEntry => ({
  id,
  name,
  message,
  createdAt,
  reply,
  repliedAt,
});

export async function remove(store: Store, id: string) {
  await store.hdel(H, id);
  await store.zrem(Z, id);
}

export async function update(store: Store, id: string, patch: Partial<Pick<Entry, 'reply' | 'isPublic'>>) {
  const raw = await store.hget(H, id);
  if (!raw) return null;
  const e = JSON.parse(raw) as Entry;
  if (patch.reply !== undefined) {
    e.reply = clean(patch.reply, LIMITS.reply) || undefined;
    e.repliedAt = e.reply ? Date.now() : undefined;
  }
  if (patch.isPublic !== undefined) e.isPublic = patch.isPublic;
  await store.hset(H, id, JSON.stringify(e));
  return e;
}
