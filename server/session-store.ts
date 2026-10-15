/**
 * express-session store: Redis first, Postgres as legacy read + outage fallback.
 *
 * With `rolling: true` every request touched the session row, so the session table
 * was the busiest writer in Postgres (and a steady source of WAL). Sessions now live
 * in Redis with a TTL; Postgres is only
 *   - read on a Redis miss, so sessions created before the switch keep working
 *     (they are copied into Redis on first use), and
 *   - written when Redis is unreachable, so an outage degrades to the old path
 *     instead of logging everyone out.
 *
 * Every Redis call is time-boxed: a hung Redis must not hang every request.
 *
 * Writes made during an outage land in Postgres and are deleted from Redis as soon
 * as it answers again (see `set` / `destroy`), so a stale Redis copy cannot shadow
 * them afterwards. Sessions that exist only in Redis are unavailable while Redis is
 * down — those users have to log in again; nothing else breaks.
 */
import session from "express-session";
import type Redis from "ioredis";

const PREFIX = "craft:sess:";
const REDIS_TIMEOUT_MS = Math.max(200, Number(process.env.CRAFT_SESSION_REDIS_TIMEOUT_MS) || 1500);
const DEFAULT_TTL_SEC = 30 * 24 * 60 * 60;

type Cb<T = unknown> = (err?: any, value?: T) => void;

function withTimeout<T>(work: Promise<T>): Promise<T> {
  // Unhandled rejection guard: the caller may have given up (fast path) already.
  work.catch(() => undefined);
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`redis session op timed out after ${REDIS_TIMEOUT_MS}ms`)), REDIS_TIMEOUT_MS);
    work.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); },
    );
  });
}

function ttlSeconds(sess: session.SessionData | undefined): number {
  const expires = sess?.cookie?.expires;
  if (expires) {
    const sec = Math.ceil((new Date(expires).getTime() - Date.now()) / 1000);
    if (Number.isFinite(sec)) return Math.max(1, sec);
  }
  return DEFAULT_TTL_SEC;
}

/** Callback-style store methods promisified (connect-pg-simple has no promise API). */
function call<T>(fn: (cb: Cb<T>) => void): Promise<T | undefined> {
  return new Promise((resolve, reject) => fn((err, v) => (err ? reject(err) : resolve(v))));
}

export class RedisFirstSessionStore extends session.Store {
  private warned = 0;

  constructor(private readonly redis: Redis, private readonly fallback: session.Store) {
    super();
  }

  /**
   * Fail fast while the client is not connected: ioredis would otherwise queue the
   * command and every request would wait out the timeout during an outage (or with
   * a wrong REDIS_URL host).
   */
  private run<T>(op: (r: Redis) => Promise<T>): Promise<T> {
    const status = (this.redis as any).status;
    if (status !== undefined && status !== "ready") return Promise.reject(new Error(`redis not ready (${status})`));
    return withTimeout(op(this.redis));
  }

  private warn(op: string, e: any) {
    // Rate-limit: an outage would otherwise log once per request.
    const now = Date.now();
    if (now - this.warned < 60_000) return;
    this.warned = now;
    console.warn(`[session] redis ${op} failed, using Postgres fallback:`, e?.message || e);
  }

  get(sid: string, cb: Cb<session.SessionData | null>): void {
    (async () => {
      try {
        const raw = await this.run((r) => r.get(PREFIX + sid));
        if (raw) return JSON.parse(raw) as session.SessionData;
      } catch (e) {
        this.warn("get", e);
        return (await call<session.SessionData | null>((c) => this.fallback.get(sid, c))) ?? null;
      }
      // Redis miss: a session from before the switch (or written during an outage).
      const legacy = (await call<session.SessionData | null>((c) => this.fallback.get(sid, c))) ?? null;
      if (legacy) {
        await this.run((r) => r.set(PREFIX + sid, JSON.stringify(legacy), "EX", ttlSeconds(legacy))).catch((e) =>
          this.warn("migrate", e),
        );
      }
      return legacy;
    })().then((v) => cb(null, v), (e) => cb(e));
  }

  set(sid: string, sess: session.SessionData, cb?: Cb): void {
    this.run((r) => r.set(PREFIX + sid, JSON.stringify(sess), "EX", ttlSeconds(sess)))
      .then(() => cb?.())
      .catch((e) => {
        this.warn("set", e);
        this.fallback.set(sid, sess, (err) => cb?.(err));
        this.forgetLater(sid);
      });
  }

  touch(sid: string, sess: session.SessionData, cb?: Cb): void {
    // Never (re)create a key here: touch also fires for requests still in flight on
    // a session that logout just destroyed, and recreating it would undo the logout.
    // A key that vanished is rebuilt by get() from the Postgres copy, if there is one.
    this.run((r) => r.expire(PREFIX + sid, ttlSeconds(sess)))
      .then(() => cb?.())
      .catch((e) => {
        this.warn("touch", e);
        if (this.fallback.touch) this.fallback.touch(sid, sess, (err?: any) => cb?.(err));
        else cb?.();
      });
  }

  destroy(sid: string, cb?: Cb): void {
    // Both stores: a logout must not be undone by the legacy row on the next miss.
    Promise.allSettled([
      this.run((r) => r.del(PREFIX + sid)),
      call((c) => this.fallback.destroy(sid, c)),
    ]).then((results) => {
      if (results[0].status === "rejected") this.forgetLater(sid);
      const failed = results.filter((r) => r.status === "rejected") as PromiseRejectedResult[];
      cb?.(failed.length === results.length ? failed[0].reason : undefined);
    });
  }

  /**
   * A write that could only reach Postgres leaves an older Redis copy behind, which
   * get() would serve first once Redis is back. Delete it as soon as Redis answers.
   */
  private pendingForget = new Set<string>();
  private forgetTimer: NodeJS.Timeout | null = null;
  private forgetLater(sid: string): void {
    if (this.pendingForget.size >= 100_000) return;
    this.pendingForget.add(sid);
    if (this.forgetTimer) return;
    this.forgetTimer = setInterval(() => {
      const batch = Array.from(this.pendingForget).slice(0, 500);
      if (!batch.length) {
        clearInterval(this.forgetTimer!);
        this.forgetTimer = null;
        return;
      }
      this.run((r) => r.del(...batch.map((s) => PREFIX + s)))
        .then(() => batch.forEach((s) => this.pendingForget.delete(s)))
        .catch(() => undefined);
    }, 5000);
    this.forgetTimer.unref?.();
  }
}

/** Log whether Redis keeps data across restarts — without it a restart logs everyone out. */
export async function logRedisPersistence(redis: Redis): Promise<void> {
  try {
    const save = (await withTimeout(redis.config("GET", "save"))) as string[];
    const aof = (await withTimeout(redis.config("GET", "appendonly"))) as string[];
    const policy = (await withTimeout(redis.config("GET", "maxmemory-policy"))) as string[];
    console.log(`[session] redis persistence: save="${save?.[1] ?? "?"}" appendonly=${aof?.[1] ?? "?"} maxmemory-policy=${policy?.[1] ?? "?"}`);
  } catch (e: any) {
    console.log("[session] redis persistence: unknown (CONFIG not allowed):", e?.message || e);
  }
}
