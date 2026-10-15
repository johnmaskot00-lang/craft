// Run: node --import tsx tests/session-store.itest.ts
import assert from "node:assert/strict";
import session from "express-session";

class FakeRedis {
  data = new Map<string, { v: string; exp: number }>();
  mode: "ok" | "down" | "hang" = "ok";
  private gate<T>(fn: () => T): Promise<T> {
    if (this.mode === "down") return Promise.reject(new Error("ECONNREFUSED"));
    if (this.mode === "hang") return new Promise(() => {});
    return Promise.resolve(fn());
  }
  get(k: string) { return this.gate(() => this.data.get(k)?.v ?? null); }
  set(k: string, v: string, _ex: string, ttl: number) { return this.gate(() => { this.data.set(k, { v, exp: ttl }); return "OK"; }); }
  expire(k: string, ttl: number) { return this.gate(() => { const e = this.data.get(k); if (!e) return 0; e.exp = ttl; return 1; }); }
  del(k: string) { return this.gate(() => (this.data.delete(k) ? 1 : 0)); }
}

const p = <T>(fn: (cb: (e?: any, v?: T) => void) => void) =>
  new Promise<T | undefined>((res, rej) => fn((e, v) => (e ? rej(e) : res(v))));

async function main() {
  process.env.CRAFT_SESSION_REDIS_TIMEOUT_MS = "200";
  const { RedisFirstSessionStore } = await import("../server/session-store.ts");
  const redis = new FakeRedis();
  const pg = new session.MemoryStore();
  const store = new RedisFirstSessionStore(redis as any, pg);
  const future = new Date(Date.now() + 3600_000);
  const sess = (u: number) => ({ cookie: { expires: future, originalMaxAge: 3600_000 }, passport: { user: u } }) as any;

  await p((c) => store.set("a", sess(1), c));
  assert.ok(redis.data.has("craft:sess:a"));
  assert.ok(redis.data.get("craft:sess:a")!.exp > 3500 && redis.data.get("craft:sess:a")!.exp <= 3600, "TTL from cookie");
  assert.equal(((await p((c) => store.get("a", c))) as any).passport.user, 1);
  assert.equal(await p((c) => pg.get("a", c)), undefined, "not written to postgres");
  console.log("  ✓ set/get in redis, postgres untouched");

  // legacy session only in Postgres → served and copied into Redis
  await p((c) => pg.set("old", sess(7), c));
  assert.equal(((await p((c) => store.get("old", c))) as any).passport.user, 7);
  assert.ok(redis.data.has("craft:sess:old"));
  console.log("  ✓ legacy postgres session migrates on first read");

  // touch never resurrects a destroyed session (logout + in-flight request)
  await p((c) => store.destroy("a", c));
  await p((c) => store.touch("a", sess(1), c));
  assert.equal(redis.data.has("craft:sess:a"), false);
  assert.equal(await p((c) => store.get("a", c)), null);
  console.log("  ✓ touch after logout does not resurrect the session");

  // a write that only reached Postgres (Redis down) is not shadowed by the old Redis copy
  await p((c) => store.set("s", sess(1), c));
  redis.mode = "down";
  await p((c) => store.set("s", sess(2), c));
  redis.mode = "ok";
  await new Promise((r) => setTimeout(r, 5500));
  assert.equal(((await p((c) => store.get("s", c))) as any).passport.user, 2);
  console.log("  ✓ outage write wins over stale redis copy once redis is back");

  // Redis down → fallback writes/reads Postgres, no error to the request
  redis.mode = "down";
  await p((c) => store.set("b", sess(2), c));
  assert.equal(((await p((c) => store.get("b", c))) as any).passport.user, 2);
  console.log("  ✓ redis down: falls back to postgres");

  // Redis hanging → bounded by timeout, still served
  redis.mode = "hang";
  const t0 = Date.now();
  assert.equal(((await p((c) => store.get("b", c))) as any).passport.user, 2);
  assert.ok(Date.now() - t0 < 1000, "did not hang");
  console.log("  ✓ redis hang: time-boxed, served from postgres");

  // destroy clears both stores even if one is down
  redis.mode = "ok";
  await p((c) => store.destroy("old", c));
  assert.equal(redis.data.has("craft:sess:old"), false);
  assert.equal(await p((c) => pg.get("old", c)), undefined);
  assert.equal(await p((c) => store.get("old", c)), null, "logout sticks");
  console.log("  ✓ destroy clears redis + postgres");
  console.log("\nsession store: all checks passed");
  process.exit(0);
}
main().catch((e) => { console.error("FAILED:", e); process.exit(1); });
