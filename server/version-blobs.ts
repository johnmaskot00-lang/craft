/**
 * Version snapshots (full site HTML + every multipage file) are the biggest rows
 * in Postgres — ~3.6MB each, which is why history alone grew past 1GB. The payload
 * now lives gzipped in Object Storage while Postgres keeps only metadata + key.
 *
 * Without Yandex credentials the payload stays inline in the row, so local runs
 * and self-hosted setups keep working unchanged.
 */
import { gunzipSync, gzipSync } from "zlib";
import {
  yandexMediaStorageEnabled,
  ycMediaDelete,
  ycMediaGetBuffer,
  ycMediaPut,
} from "./yc-media-bucket";

export type VersionPayload = {
  code: string;
  files: { filename: string; code: string }[] | null;
};

/** Only offload snapshots that actually cost space; tiny ones stay inline. */
const MIN_OFFLOAD_BYTES = Math.max(
  4096,
  Number(process.env.CRAFT_VERSION_BLOB_MIN_BYTES) || 32768,
);

export function versionBlobsEnabled(): boolean {
  return yandexMediaStorageEnabled();
}

export function shouldOffloadVersion(codeBytes: number): boolean {
  return versionBlobsEnabled() && codeBytes >= MIN_OFFLOAD_BYTES;
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

export async function putVersionBlob(key: string, payload: VersionPayload): Promise<void> {
  const gz = gzipSync(Buffer.from(JSON.stringify(payload), "utf8"), { level: 6 });
  await ycMediaPut(key, gz, "application/gzip", "private");
}

export async function getVersionBlob(key: string): Promise<VersionPayload | null> {
  try {
    const raw = await ycMediaGetBuffer(key);
    const json = gunzipSync(raw).toString("utf8");
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
      await ycMediaDelete(key);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn(`[versions] blob delete failed for ${key}: ${msg}`);
    }
  }
}
