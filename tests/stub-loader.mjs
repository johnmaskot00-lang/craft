// ESM resolve hook used only by tests/*.itest.ts (node --import ./tests/register-stubs.mjs):
//  - server/yc-media-bucket.ts → in-memory object store (tests/media-stub.ts)
//  - "ioredis" → minimal fake (tests/redis-stub.ts) for files under tests/ that
//    import it via the "fake-ioredis" specifier below, never for real code paths
//    unless the importing test opts in with ?fake-redis in its own URL.
export async function resolve(specifier, context, next) {
  const parent = String(context.parentURL || "");
  if (/(^|[\\/])yc-media-bucket(\.ts)?$/.test(specifier) && !parent.includes("media-stub")) {
    return next(new URL("./media-stub.ts", import.meta.url).href, context);
  }
  // Hooks run off-thread and cannot see process.env set inside a test, so the
  // opt-in is carried in the module graph: server modules imported with
  // "?fake-redis" resolve ioredis to the stub, and so do their own imports.
  if (specifier === "ioredis" && parent.includes("fake-redis") && !parent.includes("redis-stub")) {
    return next(new URL("./redis-stub.ts", import.meta.url).href, context);
  }
  const res = await next(specifier, context);
  if (parent.includes("fake-redis") && res.url.startsWith("file:") && !res.url.includes("node_modules") && !res.url.includes("fake-redis")) {
    return { ...res, url: `${res.url}${res.url.includes("?") ? "&" : "?"}fake-redis` };
  }
  return res;
}
