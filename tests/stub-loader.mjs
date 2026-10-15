// ESM resolve hook: redirect server/yc-media-bucket.ts to the in-memory stub.
// Used only by tests/*.itest.ts (node --import ./tests/register-stubs.mjs).
export async function resolve(specifier, context, next) {
  if (/(^|[\\/])yc-media-bucket(\.ts)?$/.test(specifier) && !String(context.parentURL || "").includes("media-stub")) {
    return next(new URL("./media-stub.ts", import.meta.url).href, context);
  }
  return next(specifier, context);
}
