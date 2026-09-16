/**
 * In-memory cache for publish media downloads.
 * Re-publishing the same site (common while iterating) used to re-fetch tens of MB
 * from Yandex on every click — burning RAM/CPU and Amvera CPU graphs.
 */
type Entry = { buf: Buffer; at: number };

const cache = new Map<string, Entry>();
let totalBytes = 0;

const MAX_BYTES = Math.max(
  16 * 1024 * 1024,
  Number(process.env.PUBLISH_MEDIA_CACHE_BYTES) || 96 * 1024 * 1024,
);
const MAX_ENTRIES = Math.max(32, Number(process.env.PUBLISH_MEDIA_CACHE_ENTRIES) || 256);

function evictOldest(): void {
  let oldestKey: string | null = null;
  let oldestAt = Infinity;
  for (const [k, v] of cache) {
    if (v.at < oldestAt) {
      oldestAt = v.at;
      oldestKey = k;
    }
  }
  if (!oldestKey) return;
  const gone = cache.get(oldestKey);
  cache.delete(oldestKey);
  if (gone) totalBytes = Math.max(0, totalBytes - gone.buf.length);
}

export function getPublishMediaCached(url: string): Buffer | null {
  const hit = cache.get(url);
  if (!hit) return null;
  hit.at = Date.now();
  return hit.buf;
}

export function setPublishMediaCached(url: string, buf: Buffer): void {
  if (!url || !buf?.length) return;
  // Don't cache huge heroes forever — they alone can fill the budget.
  if (buf.length > 12 * 1024 * 1024) return;

  const prev = cache.get(url);
  if (prev) {
    totalBytes = Math.max(0, totalBytes - prev.buf.length);
    cache.delete(url);
  }

  while (
    (totalBytes + buf.length > MAX_BYTES || cache.size >= MAX_ENTRIES) &&
    cache.size > 0
  ) {
    evictOldest();
  }

  if (totalBytes + buf.length > MAX_BYTES) return;

  cache.set(url, { buf, at: Date.now() });
  totalBytes += buf.length;
}

export function publishMediaCacheStats() {
  return { entries: cache.size, bytes: totalBytes, maxBytes: MAX_BYTES };
}
