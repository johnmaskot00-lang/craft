/**
 * Optional Redis client for multi-instance Craft (KIE waiters, rate limits, pub/sub).
 * When REDIS_URL is unset, all helpers no-op / return null — single-instance Amvera OK.
 */
import Redis from "ioredis";

let client: Redis | null | undefined;

export function redisEnabled(): boolean {
  return Boolean(process.env.REDIS_URL?.trim());
}

export function getRedis(): Redis | null {
  if (client !== undefined) return client;
  const url = process.env.REDIS_URL?.trim();
  if (!url) {
    client = null;
    return null;
  }
  try {
    client = new Redis(url, {
      maxRetriesPerRequest: 2,
      enableReadyCheck: true,
      lazyConnect: false,
    });
    client.on("error", (err) => {
      console.warn("[redis] error:", err?.message || err);
    });
    console.log("[redis] connected");
    return client;
  } catch (e: any) {
    console.warn("[redis] init failed:", e?.message || e);
    client = null;
    return null;
  }
}

export async function redisGet(key: string): Promise<string | null> {
  const r = getRedis();
  if (!r) return null;
  try {
    return await r.get(key);
  } catch {
    return null;
  }
}

export async function redisSet(key: string, value: string, ttlSec: number): Promise<void> {
  const r = getRedis();
  if (!r) return;
  try {
    await r.set(key, value, "EX", Math.max(1, ttlSec));
  } catch {
    /* ignore */
  }
}

export async function redisDel(key: string): Promise<void> {
  const r = getRedis();
  if (!r) return;
  try {
    await r.del(key);
  } catch {
    /* ignore */
  }
}

/** Fixed-window rate limit via INCR. Returns { ok, remaining, retryAfterSec }. */
export async function redisRateLimit(
  bucket: string,
  key: string,
  max: number,
  windowMs: number,
): Promise<{ ok: boolean; remaining: number; retryAfterSec: number } | null> {
  const r = getRedis();
  if (!r) return null;
  const rk = `craft:rl:${bucket}:${key}`;
  const windowSec = Math.max(1, Math.ceil(windowMs / 1000));
  try {
    const n = await r.incr(rk);
    if (n === 1) await r.expire(rk, windowSec);
    const ttl = await r.ttl(rk);
    const remaining = Math.max(0, max - n);
    return {
      ok: n <= max,
      remaining,
      retryAfterSec: ttl > 0 ? ttl : windowSec,
    };
  } catch {
    return null;
  }
}

/** Distributed per-project generation lease for multi-instance API. */
export async function redisAcquireLease(key: string, token: string, ttlMs: number): Promise<boolean> {
  const r = getRedis();
  if (!r) return false;
  try { return (await r.set(`craft:lease:${key}`, token, "PX", Math.max(5000, ttlMs), "NX")) === "OK"; } catch { return false; }
}

export async function redisReleaseLease(key: string, token: string): Promise<void> {
  const r = getRedis();
  if (!r) return;
  try {
    await r.eval("if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end", 1, `craft:lease:${key}`, token);
  } catch { /* best effort */ }
}