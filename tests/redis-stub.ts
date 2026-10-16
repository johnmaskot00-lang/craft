// Minimal ioredis stand-in for tests: just enough of get/set/del/eval to run the
// two lease scripts in server/redis.ts. Selected via tests/stub-loader.mjs.
export const store = new Map<string, string>();

export default class FakeRedis {
  status = "ready";
  constructor(_url?: string, _opts?: unknown) {}
  on() { return this; }
  async get(k: string) { return store.get(k) ?? null; }
  async set(k: string, v: string, ...args: string[]) {
    if (args.includes("NX") && store.has(k)) return null;
    store.set(k, v);
    return "OK";
  }
  async del(...keys: string[]) { let n = 0; for (const k of keys) if (store.delete(k)) n++; return n; }
  /** Interprets only the lease scripts used by redis.ts (hold + compare-and-delete). */
  async eval(script: string, _numKeys: number, key: string, token: string) {
    const cur = store.get(key);
    if (script.includes("redis.call('set'")) {
      if (cur === undefined || cur === token) { store.set(key, token); return 1; }
      return 0;
    }
    if (script.includes("redis.call('del'")) {
      if (cur === token) { store.delete(key); return 1; }
      return 0;
    }
    throw new Error("FakeRedis: unsupported script");
  }
}
