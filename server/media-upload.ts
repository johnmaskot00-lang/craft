import crypto from "crypto";
import { detectImageFormat } from "./image-compress";
import {
  ensureYandexMediaBucket,
  probeYandexMediaStorage,
  yandexMediaStorageEnabled,
  yandexMediaStorageRequested,
  ycMediaPut,
  CRAFT_MEDIA_BUCKET,
} from "./yc-media-bucket";
import { ObjectStorageService, objectStorageClient } from "./replit_integrations/object_storage";

const objectStorage = new ObjectStorageService();

export function getMediaBackendLabel(): "yandex" | "local" {
  return yandexMediaStorageEnabled() ? "yandex" : "local";
}

export async function initYandexMediaStorage(): Promise<void> {
  if (!yandexMediaStorageEnabled()) {
    if (yandexMediaStorageRequested()) {
      console.warn(
        "[YC-MEDIA] Yandex media requested but YC_KEY_ID/YC_SECRET missing — uploads will fail until credentials are set",
      );
    } else {
      console.log("[ObjectStorage] media backend: local (CRAFT_OBJECT_STORAGE_BACKEND=local)");
    }
    return;
  }
  await ensureYandexMediaBucket();
  console.log(`[ObjectStorage] media backend: yandex (bucket ${CRAFT_MEDIA_BUCKET()})`);
}

export async function probeMediaStorage(): Promise<void> {
  if (yandexMediaStorageEnabled()) {
    await probeYandexMediaStorage();
    return;
  }
  objectStorage.getPrivateObjectDir();
}

async function uploadToLocalDisk(buffer: Buffer, mimeType: string, objectName: string): Promise<string> {
  const privateDir = objectStorage.getPrivateObjectDir();
  const fullPath = `${privateDir}/${objectName}`;
  const parts = fullPath.startsWith("/") ? fullPath.slice(1).split("/") : fullPath.split("/");
  const bucketName = parts[0];
  const objectKey = parts.slice(1).join("/");
  const bucket = objectStorageClient.bucket(bucketName);
  const file = bucket.file(objectKey);
  await file.save(buffer, { contentType: mimeType, resumable: false });
  return `/objects/${objectName}`;
}

/** Store a buffer as /objects/uploads/{uuid}.{ext} — Yandex in production, local only when explicitly configured. */
export async function uploadBufferToObjectStorage(buffer: Buffer, mimeType: string, ext: string): Promise<string> {
  const detected = detectImageFormat(buffer);
  if (detected) {
    mimeType = detected.mime;
    ext = detected.ext;
  }
  const objectName = `uploads/${crypto.randomUUID()}.${ext}`;

  if (yandexMediaStorageEnabled()) {
    await ycMediaPut(objectName, buffer, mimeType);
    console.log(`[YC-MEDIA] Upload routed to Yandex: /objects/${objectName}`);
    return `/objects/${objectName}`;
  }

  if (!yandexMediaStorageRequested()) {
    const url = await uploadToLocalDisk(buffer, mimeType, objectName);
    console.log(`[ObjectStorage] Upload routed to local disk: ${url}`);
    return url;
  }

  throw new Error(
    "[YC-MEDIA] Yandex Object Storage required (CRAFT_OBJECT_STORAGE_BACKEND=auto|yandex) but YC_KEY_ID/YC_SECRET are missing",
  );
}

/** PUT /objects/uploads/... — presigned client upload flow. */
export async function putObjectAtKey(key: string, buffer: Buffer, contentType?: string): Promise<void> {
  const normalized = key.replace(/^\/objects\//, "").replace(/^\/+/, "");
  if (!normalized.startsWith("uploads/")) {
    throw new Error("Forbidden object key");
  }

  if (yandexMediaStorageEnabled()) {
    await ycMediaPut(normalized, buffer, contentType);
    console.log(`[YC-MEDIA] PUT stored: /objects/${normalized}`);
    return;
  }

  if (!yandexMediaStorageRequested()) {
    await uploadToLocalDisk(buffer, contentType || "application/octet-stream", normalized);
    console.log(`[ObjectStorage] PUT stored locally: /objects/${normalized}`);
    return;
  }

  throw new Error("[YC-MEDIA] Yandex Object Storage required but YC_KEY_ID/YC_SECRET are missing");
}
