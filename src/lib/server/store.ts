import { Redis } from '@upstash/redis';
import { env } from './env';

/**
 * 방명록 저장소. Upstash Redis 가 연결되어 있으면 그것을 쓰고,
 * 로컬 개발(npm run dev)에서 연결이 없으면 메모리에 임시로 저장한다.
 */
export interface Store {
  hset(key: string, field: string, value: string): Promise<unknown>;
  hget(key: string, field: string): Promise<string | null>;
  hdel(key: string, field: string): Promise<unknown>;
  zadd(key: string, score: number, member: string): Promise<unknown>;
  zrem(key: string, member: string): Promise<unknown>;
  zrevrange(key: string, start: number, stop: number): Promise<string[]>;
  incr(key: string, ttlSec: number): Promise<number>;
}

class RedisStore implements Store {
  constructor(private r: Redis) {}
  hset(k: string, f: string, v: string) {
    return this.r.hset(k, { [f]: v });
  }
  async hget(k: string, f: string) {
    const v = await this.r.hget<unknown>(k, f);
    if (v == null) return null;
    return typeof v === 'string' ? v : JSON.stringify(v);
  }
  hdel(k: string, f: string) {
    return this.r.hdel(k, f);
  }
  zadd(k: string, score: number, member: string) {
    return this.r.zadd(k, { score, member });
  }
  zrem(k: string, m: string) {
    return this.r.zrem(k, m);
  }
  zrevrange(k: string, a: number, b: number) {
    return this.r.zrange<string[]>(k, a, b, { rev: true });
  }
  async incr(k: string, ttl: number) {
    const n = await this.r.incr(k);
    if (n === 1) await this.r.expire(k, ttl);
    return n;
  }
}

class MemoryStore implements Store {
  private h = new Map<string, Map<string, string>>();
  private z = new Map<string, Map<string, number>>();
  private c = new Map<string, { n: number; until: number }>();
  async hset(k: string, f: string, v: string) {
    (this.h.get(k) ?? this.h.set(k, new Map()).get(k)!).set(f, v);
  }
  async hget(k: string, f: string) {
    return this.h.get(k)?.get(f) ?? null;
  }
  async hdel(k: string, f: string) {
    this.h.get(k)?.delete(f);
  }
  async zadd(k: string, s: number, m: string) {
    (this.z.get(k) ?? this.z.set(k, new Map()).get(k)!).set(m, s);
  }
  async zrem(k: string, m: string) {
    this.z.get(k)?.delete(m);
  }
  async zrevrange(k: string, a: number, b: number) {
    const all = [...(this.z.get(k) ?? new Map()).entries()].sort((x, y) => y[1] - x[1]).map(([m]) => m);
    return all.slice(a, b < 0 ? undefined : b + 1);
  }
  async incr(k: string, ttl: number) {
    const now = Date.now();
    const cur = this.c.get(k);
    const next = !cur || cur.until < now ? { n: 1, until: now + ttl * 1000 } : { n: cur.n + 1, until: cur.until };
    this.c.set(k, next);
    return next.n;
  }
}

let memory: MemoryStore | undefined;

/** 저장소가 없으면 null (운영에서 Redis 미연결) */
export function getStore(): Store | null {
  const url = env.redisUrl();
  const token = env.redisToken();
  if (url && token) return new RedisStore(new Redis({ url, token }));
  if (import.meta.env.DEV) return (memory ??= new MemoryStore());
  return null;
}
