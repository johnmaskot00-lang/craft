/**
 * Version snapshots (full site HTML + every multipage file) are the biggest rows
 * in Postgres — ~3.6MB each, which is why history alone grew past 1GB. The payload
 * now lives gzipped in Object Storage while Postgres keeps only metadata + key.
 *
 * Without Yandex credentials the payload stays inline in the row, so local runs
 * and self-hosted setups keep working unchanged.
 *
 * Everything here is defensive on purpose: compression runs off the event loop,
 * oversized snapshots stay inline, and every network call is bounded. A stuck
 * upload used to freeze the whole single-instance API.
 */
import { gunzip, gzip } from "zlib";
import { promisify } from "util";
import {
  yandexMediaStorageEnabled,
  ycMediaDelete,
  ycMediaGetBuffer,
  ycMediaPut,
} from "./yc-media-bucket";

const gzipAsync = promisify(gzip);
const gunzipAsync = promisify(gunzip);

export type VersionPayload = {
  code: string;
  files: { filename: string; code: string }[] | null;
};

/** Only offload snapshots that actually cost space; tiny ones stay inline. */
const MIN_OFFLOAD_BYTES = Math.max(
  4096,
  Number(process.env.CRAFT_VERSION_BLOB_MIN_BYTES) || 32768,
);

/**
 * Compressing a huge snapshot needs several copies of it in the 1.8GB heap
 * (JSON string + buffer + gzip output). Those go to Postgres as before.
 */
const MAX_OFFLOAD_BYTES = Math.max(
  MIN_OFFLOAD_BYTES,
  Number(process.env.CRAFT_VERSION_BLOB_MAX_BYTES) || 24 * 1024 * 1024,
);

const BLOB_TIMEOUT_MS = Math.max(5000, Number(process.env.CRAFT_VERSION_BLOB_TIMEOUT_MS) || 45000);

export function versionBlobsEnabled(): boolean {
  if (process.env.CRAFT_VERSION_BLOBS === "0") return false;
  return yandexMediaStorageEnabled();
}

export function shouldOffloadVersion(codeBytes: number): boolean {
  if (!versionBlobsEnabled()) return false;
  return codeBytes >= MIN_OFFLOAD_BYTES && codeBytes <= MAX_OFFLOAD_BYTES;
}

export function versionBlobKey(projectId: number, versionId: number): string {
  return `drafts/p${projectId}/versions/${versionId}.json.gz`;
}

export function payloadBytes(payload: VersionPayload): number {
  let total = Buffer.byteLength(payload.code || "", "utf8");
  for (const f of payload.files || []) total += Buffer.byteLength(f.code || "", "utf8");
  return total;
}

/** Generating placeholders must never be offered as a restore point. */
export function isHealthySnapshot(code: string): boolean {
  return !(code || "").includes('data-craft-generating="1"');
}

/** A stalled S3 call must not hold a request open forever. */
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

export async function putVersionBlob(key: string, payload: VersionPayload): Promise<void> {
  const gz = await gzipAsync(Buffer.from(JSON.stringify(payload), "utf8"), { level: 6 });
  await withTimeout(ycMediaPut(key, gz, "application/gzip", "private"), `blob upload ${key}`);
}

export async function getVersionBlob(key: string): Promise<VersionPayload | null> {
  try {
    const raw = await withTimeout(ycMediaGetBuffer(key), `blob read ${key}`);
    const json = (await gunzipAsync(raw)).toString("utf8");
    const parsed = JSON.parse(json) as VersionPayload;
    return {
      code: typeof parsed.code === "string" ? parsed.code : "",
      files: Array.isArray(parsed.files) ? parsed.files : null,
    };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(`[versions] blob read failed for ${key}: ${msg}`);
    return null;
  }
}

/** Best-effort cleanup — a leftover object costs pennies, a failed delete must not break the request. */
export async function deleteVersionBlobs(keys: Array<string | null | undefined>): Promise<void> {
  const unique = Array.from(new Set(keys.filter((k): k is string => !!k)));
  for (const key of unique) {
    try {
      await withTimeout(ycMediaDelete(key), `blob delete ${key}`);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn(`[versions] blob delete failed for ${key}: ${msg}`);
    }
  }
}
