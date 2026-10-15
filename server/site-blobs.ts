/**
 * Site code (projects.generated_code + project_files.code) lives gzipped in Object
 * Storage; Postgres keeps only a pointer. Same idea as version-blobs.ts, extended to
 * the live copy so the database grows by kilobytes per site instead of megabytes,
 * and a database restore can no longer lose a site's HTML.
 *
 * Every write gets a fresh, never-reused key. So an upload never overwrites an
 * object a row still points at (a crash between "upload" and "UPDATE row" leaves
 * the old row pointing at the old, intact object), and a key queued for deletion
 * can never become live again. Superseded objects go through object_delete_outbox;
 * a crash mid-write can only leak an orphan object, never lose a live one.
 *
 * Without Yandex credentials (local dev) or for oversized payloads, code stays
 * inline in the row exactly as before, so every caller keeps working.
 */
import crypto from "crypto";
import { gunzip, gzip } from "zlib";
import { promisify } from "util";
import {
  yandexMediaStorageEnabled,
  ycMediaGetBuffer,
  ycMediaPut,
} from "./yc-media-bucket";

const gzipAsync = promisify(gzip);
const gunzipAsync = promisify(gunzip);

/** Below this the pointer row is not much smaller than the code itself. */
const MIN_OFFLOAD_BYTES = Math.max(256, Number(process.env.CRAFT_SITE_BLOB_MIN_BYTES) || 2048);
/** Huge payloads need several in-heap copies to gzip; keep them inline like versions do. */
const MAX_OFFLOAD_BYTES = Math.max(
  MIN_OFFLOAD_BYTES,
  Number(process.env.CRAFT_SITE_BLOB_MAX_BYTES) || 24 * 1024 * 1024,
);
const BLOB_TIMEOUT_MS = Math.max(5000, Number(process.env.CRAFT_SITE_BLOB_TIMEOUT_MS) || 45000);
/** Hot sites are read on every edit / preview; cache decompressed code briefly. */
const CACHE_MAX_BYTES = Math.max(0, Number(process.env.CRAFT_SITE_BLOB_CACHE_MB ?? 64)) * 1024 * 1024;

export function siteBlobsEnabled(): boolean {
  if (process.env.CRAFT_SITE_BLOBS === "0") return false;
  return yandexMediaStorageEnabled();
}

export function shouldOffloadSiteCode(code: string): boolean {
  if (!siteBlobsEnabled()) return false;
  const bytes = Buffer.byteLength(code || "", "utf8");
  return bytes >= MIN_OFFLOAD_BYTES && bytes <= MAX_OFFLOAD_BYTES;
}

export const SITE_BLOB_PREFIX = "sites/";

/** Time-ordered + random: unique per write, and sorts by age when listing a project. */
function writeId(): string {
  return `${Date.now().toString(36)}-${crypto.randomBytes(6).toString("hex")}`;
}

export function siteCodeKey(projectId: number): string {
  return `${SITE_BLOB_PREFIX}p${projectId}/main/${writeId()}.html.gz`;
}

export function siteFileKey(projectId: number, filename: string): string {
  // Hash the name: filenames can contain characters S3 keys handle poorly.
  const nameHash = crypto.createHash("sha256").update(filename, "utf8").digest("hex").slice(0, 16);
  return `${SITE_BLOB_PREFIX}p${projectId}/files/${nameHash}/${writeId()}.gz`;
}

function withTimeout<T>(work: Promise<T>, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`${label} timed out after ${BLOB_TIMEOUT_MS}ms`)),
      BLOB_TIMEOUT_MS,
    );
    work.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (err) => { clearTimeout(timer); reject(err); },
    );
  });
}

// ── tiny LRU over decompressed code (Map keeps insertion order) ──────────────
const cache = new Map<string, string>();
let cacheBytes = 0;

function cacheGet(key: string): string | undefined {
  const hit = cache.get(key);
  if (hit === undefined) return undefined;
  cache.delete(key);
  cache.set(key, hit);
  return hit;
}

function cachePut(key: string, code: string): void {
  if (!CACHE_MAX_BYTES) return;
  const size = code.length * 2;
  if (size > CACHE_MAX_BYTES / 4) return;
  const prev = cache.get(key);
  if (prev !== undefined) {
    cacheBytes -= prev.length * 2;
    cache.delete(key);
  }
  cache.set(key, code);
  cacheBytes += size;
  while (cacheBytes > CACHE_MAX_BYTES && cache.size) {
    const oldest = cache.keys().next().value as string;
    cacheBytes -= (cache.get(oldest) || "").length * 2;
    cache.delete(oldest);
  }
}

export async function putSiteBlob(key: string, code: string): Promise<void> {
  const gz = await gzipAsync(Buffer.from(code, "utf8"), { level: 6 });
  await withTimeout(ycMediaPut(key, gz, "application/gzip", "private"), `site blob upload ${key}`);
  cachePut(key, code);
}

/**
 * Throws when the object cannot be read. Callers must NOT treat that as "empty
 * site": an empty string written back would destroy the real code.
 */
export async function getSiteBlob(key: string): Promise<string> {
  const hit = cacheGet(key);
  if (hit !== undefined) return hit;
  const raw = await withTimeout(ycMediaGetBuffer(key), `site blob read ${key}`);
  const code = (await gunzipAsync(raw)).toString("utf8");
  cachePut(key, code);
  return code;
}

/** For tests. */
export function __resetSiteBlobCache(): void {
  cache.clear();
  cacheBytes = 0;
}
