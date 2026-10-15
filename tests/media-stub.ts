// In-memory replacement for server/yc-media-bucket.ts in integration tests.
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
export async function ycMediaHead(k: string) {
  const b = objects.get(k);
  return b ? { size: b.length, contentType: "application/octet-stream" } : null;
}
export async function ycMediaPut(k: string, b: Buffer): Promise<void> {
  if (control.beforePut) await control.beforePut(k);
  if (control.failPuts) throw new Error("simulated S3 outage");
  objects.set(k, b);
}
export async function ycMediaDelete(k: string): Promise<void> {
  objects.delete(k);
}
export async function ycMediaGetBuffer(k: string): Promise<Buffer> {
  const b = objects.get(k);
  if (!b) throw new Error(`NoSuchKey ${k}`);
  return b;
}
export async function ycMediaGetStream(): Promise<never> {
  throw new Error("not used in tests");
}
