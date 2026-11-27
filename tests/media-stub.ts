// In-memory replacement for server/yc-media-bucket.ts in integration tests.
import { Readable } from "node:stream";
export const objects = new Map<string, Buffer>();
export const control = {
  failPuts: false,
  beforePut: null as null | ((key: string) => Promise<void>),
};

export const CRAFT_MEDIA_BUCKET = () => "test";
export const hasYcMediaCredentials = () => true;
export const yandexMediaStorageRequested = () => true;
export const yandexMediaStorageEnabled = () => true;
export async function ensureYandexMediaBucket(): Promise<void> {}
export async function probeYandexMediaStorage(): Promise<void> {}
const contentTypes = new Map<string, string>();
export async function ycMediaHead(k: string) {
  const b = objects.get(k);
  return b ? { size: b.length, contentType: contentTypes.get(k) || "application/octet-stream" } : null;
}
export async function ycMediaPut(k: string, b: Buffer, contentType = "application/octet-stream"): Promise<void> {
  if (control.beforePut) await control.beforePut(k);
  if (control.failPuts) throw new Error("simulated S3 outage");
  objects.set(k, b);
  contentTypes.set(k, contentType);
}
export async function ycMediaDelete(k: string): Promise<void> {
  objects.delete(k);
  contentTypes.delete(k);
}
export async function ycMediaGetBuffer(k: string): Promise<Buffer> {
  const b = objects.get(k);
  if (!b) throw new Error(`NoSuchKey ${k}`);
  return b;
}
export async function ycMediaGetStream(k: string, range?: { start: number; end: number }) {
  const original = await ycMediaGetBuffer(k);
  const bytes = range ? original.subarray(range.start, range.end + 1) : original;
  return { stream: Readable.from([bytes]), size: bytes.length,
    contentType: contentTypes.get(k) || "application/octet-stream",
    ...(range ? { contentRange: `bytes ${range.start}-${range.end}/${original.length}` } : {}),
  };
}
