/**
 * Shared Yandex Object Storage bucket for Craft AI project media
 * (uploads, generated images, scroll-animation frames, hero mp4).
 *
 * Published site buckets (craft-ai-p{id}, custom domains) stay separate;
 * this bucket holds editor/runtime assets referenced as /objects/uploads/...
 */
import {
  CreateBucketCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import { S3Client } from "@aws-sdk/client-s3";
import { Readable } from "stream";

export const CRAFT_MEDIA_BUCKET = () => process.env.CRAFT_MEDIA_BUCKET || "craft-ai-media";

let envClient: S3Client | null = null;
let mediaBucketReady = false;

function contentTypeForKey(key: string): string {
  const ext = (key.split(".").pop() || "").toLowerCase();
  const map: Record<string, string> = {
    html: "text/html; charset=utf-8",
    css: "text/css; charset=utf-8",
    js: "application/javascript; charset=utf-8",
    json: "application/json; charset=utf-8",
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    webp: "image/webp",
    gif: "image/gif",
    svg: "image/svg+xml",
    mp4: "video/mp4",
    webm: "video/webm",
    mov: "video/quicktime",
    ogg: "video/ogg",
    glb: "model/gltf-binary",
    gltf: "model/gltf+json",
    mp3: "audio/mpeg",
    wav: "audio/wav",
  };
  return map[ext] || "application/octet-stream";
}

export function hasYcMediaCredentials(): boolean {
  return Boolean(process.env.YC_KEY_ID && process.env.YC_SECRET);
}

export function yandexMediaStorageRequested(): boolean {
  const mode = (process.env.CRAFT_OBJECT_STORAGE_BACKEND || "auto").toLowerCase();
  if (mode === "local") return false;
  return true;
}

/** True when uploads must go to Yandex (auto/yandex mode + env credentials). */
export function yandexMediaStorageEnabled(): boolean {
  if (!yandexMediaStorageRequested()) return false;
  return hasYcMediaCredentials();
}

function getMediaS3Client(): S3Client {
  if (envClient) return envClient;
  const keyId = process.env.YC_KEY_ID || "";
  const secret = process.env.YC_SECRET || "";
  if (!keyId || !secret) {
    throw new Error("[YC-MEDIA] YC_KEY_ID and YC_SECRET must be set for Yandex media storage");
  }
  envClient = new S3Client({
    region: "ru-central1",
    endpoint: "https://storage.yandexcloud.net",
    credentials: { accessKeyId: keyId, secretAccessKey: secret },
  });
  return envClient;
}

export async function ensureYandexMediaBucket(): Promise<void> {
  if (mediaBucketReady) return;
  const client = getMediaS3Client();
  const bucket = CRAFT_MEDIA_BUCKET();
  try {
    await client.send(new CreateBucketCommand({ Bucket: bucket }));
    console.log(`[YC-MEDIA] Created media bucket ${bucket}`);
  } catch (err: any) {
    const name = err?.name || err?.Code || "";
    if (name === "BucketAlreadyOwnedByYou" || name === "BucketAlreadyExists") {
      console.log(`[YC-MEDIA] Using existing media bucket ${bucket}`);
    } else {
      throw err;
    }
  }
  mediaBucketReady = true;
}

/** Health / startup probe — ensures bucket exists and credentials work. */
export async function probeYandexMediaStorage(): Promise<void> {
  await ensureYandexMediaBucket();
  const client = getMediaS3Client();
  await client.send(new HeadObjectCommand({ Bucket: CRAFT_MEDIA_BUCKET(), Key: ".probe" })).catch((err: any) => {
    const name = err?.name || err?.Code || "";
    if (name === "NotFound" || name === "NoSuchKey" || err?.$metadata?.httpStatusCode === 404) return;
    throw err;
  });
}

export async function ycMediaHead(key: string): Promise<{ size: number; contentType: string } | null> {
  await ensureYandexMediaBucket();
  const client = getMediaS3Client();
  try {
    const out = await client.send(
      new HeadObjectCommand({ Bucket: CRAFT_MEDIA_BUCKET(), Key: key.replace(/^\/+/, "") }),
    );
    return {
      size: Number(out.ContentLength || 0),
      contentType: out.ContentType || contentTypeForKey(key),
    };
  } catch (err: any) {
    const name = err?.name || err?.Code || "";
    if (name === "NotFound" || name === "NoSuchKey" || err?.$metadata?.httpStatusCode === 404) return null;
    throw err;
  }
}

export async function ycMediaPut(key: string, body: Buffer, contentType?: string): Promise<void> {
  await ensureYandexMediaBucket();
  const client = getMediaS3Client();
  const normalized = key.replace(/^\/+/, "");
  await client.send(
    new PutObjectCommand({
      Bucket: CRAFT_MEDIA_BUCKET(),
      Key: normalized,
      Body: body,
      ContentType: contentType || contentTypeForKey(normalized),
      ACL: "public-read",
    }),
  );
  console.log(`[YC-MEDIA] Stored ${normalized} (${body.length} bytes)`);
}

export async function ycMediaGetBuffer(key: string): Promise<Buffer> {
  await ensureYandexMediaBucket();
  const client = getMediaS3Client();
  const out = await client.send(
    new GetObjectCommand({ Bucket: CRAFT_MEDIA_BUCKET(), Key: key.replace(/^\/+/, "") }),
  );
  const stream = out.Body as Readable;
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks);
}

export async function ycMediaGetStream(
  key: string,
  range?: { start: number; end: number },
): Promise<{ stream: Readable; contentType: string; size: number; contentRange?: string }> {
  await ensureYandexMediaBucket();
  const client = getMediaS3Client();
  const normalized = key.replace(/^\/+/, "");
  const head = await ycMediaHead(normalized);
  if (!head) throw new Error("Object not found");
  const params: { Bucket: string; Key: string; Range?: string } = {
    Bucket: CRAFT_MEDIA_BUCKET(),
    Key: normalized,
  };
  if (range) params.Range = `bytes=${range.start}-${range.end}`;
  const out = await client.send(new GetObjectCommand(params));
  const stream = out.Body as Readable;
  const contentType = out.ContentType || head.contentType;
  const contentRange = out.ContentRange;
  const size = range ? range.end - range.start + 1 : head.size;
  return { stream, contentType, size, contentRange };
}
