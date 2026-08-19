import crypto from "crypto";
import { ObjectStorageService, objectStorageClient } from "./replit_integrations/object_storage";
import { compressImageForPublish, compressSeoCoverImage, detectImageFormat } from "./image-compress";
import type { DeployFile } from "./yandex-deploy";

const objectStorage = new ObjectStorageService();

export async function uploadImageBuffer(buffer: Buffer, fallbackMime = "image/jpeg", fallbackExt = "jpg"): Promise<string> {
  let mimeType = fallbackMime;
  let ext = fallbackExt;
  const detected = detectImageFormat(buffer);
  if (detected) {
    mimeType = detected.mime;
    ext = detected.ext;
  }
  const objectId = crypto.randomUUID();
  const objectName = `uploads/${objectId}.${ext}`;
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

/** Download KIE / external cover, compress, store locally. Returns /objects/ path or "" on failure. */
export async function persistSeoCoverFromUrl(remoteUrl: string): Promise<string> {
  if (!remoteUrl || !/^https?:\/\//i.test(remoteUrl)) return remoteUrl.startsWith("/") ? remoteUrl : "";
  try {
    const resp = await fetch(remoteUrl, { signal: AbortSignal.timeout(30000) });
    if (!resp.ok) {
      console.warn(`[SEO] Cover download ${resp.status}: ${remoteUrl.slice(0, 80)}`);
      return remoteUrl;
    }
    let buffer = Buffer.from(await resp.arrayBuffer());
    const before = buffer.length;
    buffer = await compressSeoCoverImage(buffer);
    const rel = await uploadImageBuffer(buffer);
    console.log(`[SEO] Cover compressed ${(before / 1024).toFixed(0)}KB → ${(buffer.length / 1024).toFixed(0)}KB → ${rel}`);
    return rel;
  } catch (e: any) {
    console.warn(`[SEO] Cover persist failed, keeping CDN URL:`, e?.message || e);
    return remoteUrl;
  }
}

const LOCAL_MEDIA_RE = [
  /(?:src|href|poster|content)\s*=\s*["'](\/(?:objects|uploads)\/[^"']+)["']/gi,
  /background-image\s*:\s*url\s*\(\s*['"]?(\/(?:objects|uploads)\/[^"')]+?)['"]?\s*\)/gi,
  /url\s*\(\s*['"]?(\/(?:objects|uploads)\/[A-Za-z0-9._\/-]+?\.(?:webp|jpe?g|png|gif|avif))['"]?\s*\)/gi,
];

const EXTERNAL_IMG_RE = [
  /(?:src|content)\s*=\s*["'](https?:\/\/[^"']+\.(?:webp|jpe?g|png|gif|avif)(?:\?[^"']*)?)["']/gi,
  /background-image\s*:\s*url\s*\(\s*['"]?(https?:\/\/[^"')]+?)['"]?\s*\)/gi,
];

function collectMediaUrls(html: string, appBase: string): { local: Set<string>; external: Set<string>; absoluteToRelative: Map<string, string> } {
  const local = new Set<string>();
  const external = new Set<string>();
  const absoluteToRelative = new Map<string, string>();
  const absRe = new RegExp(
    `${appBase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\/(?:objects|uploads)\\/[A-Za-z0-9._\\/-]+?\\.(?:webp|jpe?g|png|gif|avif))`,
    "gi",
  );
  for (const rx of LOCAL_MEDIA_RE) {
    let m: RegExpExecArray | null;
    rx.lastIndex = 0;
    while ((m = rx.exec(html)) !== null) local.add(m[1].split("?")[0]);
  }
  let m: RegExpExecArray | null;
  absRe.lastIndex = 0;
  while ((m = absRe.exec(html)) !== null) {
    const absUrl = m[0];
    const relPath = m[1].split("?")[0];
    local.add(relPath);
    absoluteToRelative.set(absUrl, relPath);
  }
  for (const rx of EXTERNAL_IMG_RE) {
    rx.lastIndex = 0;
    while ((m = rx.exec(html)) !== null) {
      const u = m[1].split("?")[0];
      if (!u.startsWith(appBase)) external.add(u);
    }
  }
  return { local, external, absoluteToRelative };
}

async function loadLocalMediaBuffer(mediaUrl: string, port: number): Promise<Buffer | null> {
  if (mediaUrl.startsWith("/objects/")) {
    try {
      const gcsFile = await objectStorage.getObjectEntityFile(mediaUrl);
      const [fileContent] = await gcsFile.download();
      return fileContent as Buffer;
    } catch {
      try {
        const mediaResp = await fetch(`http://localhost:${port}${mediaUrl}`, { signal: AbortSignal.timeout(15000) });
        if (mediaResp.ok) return Buffer.from(await mediaResp.arrayBuffer());
      } catch { /* fall through */ }
    }
    return null;
  }
  try {
    const mediaResp = await fetch(`http://localhost:${port}${mediaUrl}`, { signal: AbortSignal.timeout(15000) });
    if (mediaResp.ok) return Buffer.from(await mediaResp.arrayBuffer());
  } catch { /* ignore */ }
  return null;
}

/** Bundle /objects/, /uploads/, and external cover URLs into assets/ for Yandex deploy. */
export async function bundleSeoMediaForDeploy(files: DeployFile[]): Promise<DeployFile[]> {
  const appBase = (process.env.APP_BASE_URL || "https://craft-ai.ru").replace(/\/$/, "");
  const port = Number(process.env.PORT) || 5000;

  const localUrls = new Set<string>();
  const externalUrls = new Set<string>();
  const absoluteToRelative = new Map<string, string>();
  for (const f of files) {
    if (!f.content) continue;
    const found = collectMediaUrls(f.content, appBase);
    found.local.forEach((u) => localUrls.add(u));
    found.external.forEach((u) => externalUrls.add(u));
    found.absoluteToRelative.forEach((v, k) => absoluteToRelative.set(k, v));
  }

  const mediaMap = new Map<string, string>();
  const usedNames = new Set<string>();
  let counter = 0;

  async function bundleOne(sourceUrl: string, buffer: Buffer | null): Promise<void> {
    if (!buffer) return;
    const isGif = /\.gif$/i.test(sourceUrl) || (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46);
    const isRaster = !!detectImageFormat(buffer) && !isGif;
    if (isRaster) {
      const before = buffer.length;
      buffer = await compressImageForPublish(buffer);
      if (buffer.length !== before) {
        console.log(`[SEO Publish] Compressed ${sourceUrl.slice(-40)}: ${(before / 1024).toFixed(0)}KB → ${(buffer.length / 1024).toFixed(0)}KB`);
      }
    }
    let base = (sourceUrl.split("/").pop() || "").split("?")[0].replace(/[^a-zA-Z0-9._-]/g, "_");
    if (!base || base === "_") base = `cover_${counter}`;
    const detected = detectImageFormat(buffer);
    if (detected && !new RegExp(`\\.${detected.ext === "jpg" ? "jpe?g" : detected.ext}$`, "i").test(base)) {
      base = /\.[^.]+$/.test(base) ? base.replace(/\.[^.]+$/, `.${detected.ext}`) : `${base}.${detected.ext}`;
    }
    let fileName = base;
    while (usedNames.has(fileName)) { fileName = `${counter}_${base}`; counter++; }
    usedNames.add(fileName);
    counter++;
    const localPath = `/assets/${fileName}`;
    files.push({ filename: localPath.slice(1), contentBuffer: buffer });
    mediaMap.set(sourceUrl, localPath);
  }

  for (const mediaUrl of localUrls) {
    try {
      const buffer = await loadLocalMediaBuffer(mediaUrl, port);
      await bundleOne(mediaUrl, buffer);
    } catch (e: any) {
      console.warn(`[SEO Publish] Could not bundle ${mediaUrl}:`, e?.message || e);
    }
  }

  for (const extUrl of externalUrls) {
    if (mediaMap.has(extUrl)) continue;
    try {
      const resp = await fetch(extUrl, { signal: AbortSignal.timeout(25000) });
      if (!resp.ok) continue;
      let buffer = Buffer.from(await resp.arrayBuffer());
      buffer = await compressSeoCoverImage(buffer);
      await bundleOne(extUrl, buffer);
    } catch (e: any) {
      console.warn(`[SEO Publish] Could not fetch external image ${extUrl.slice(0, 60)}:`, e?.message || e);
    }
  }

  if (mediaMap.size === 0) {
    for (const f of files) {
      if (f.content) f.content = normalizeSeoMediaUrls(f.content);
    }
    return files;
  }

  for (const f of files) {
    if (!f.content) continue;
    for (const [absUrl, relPath] of absoluteToRelative) {
      const localPath = mediaMap.get(relPath);
      if (localPath) f.content = f.content.split(absUrl).join(localPath);
    }
    for (const [src, localPath] of mediaMap) {
      f.content = f.content.split(src).join(localPath);
    }
  }

  for (const f of files) {
    if (f.content) f.content = normalizeSeoMediaUrls(f.content);
  }

  console.log(`[SEO Publish] Bundled ${mediaMap.size} image(s) from ${localUrls.size} local + ${externalUrls.size} external refs`);
  return files;
}

/** Ensure media paths are root-absolute so nested pages (/slug/article/) resolve correctly. */
export function normalizeSeoMediaUrls(html: string): string {
  if (!html) return html;
  let out = html;
  out = out.replace(
    /url\s*\(\s*(['"]?)(?!\/|https?:)(assets\/[^'")]+)\1\s*\)/gi,
    (_m, q: string, path: string) => `url(${q}/${path}${q})`,
  );
  out = out.replace(
    /((?:src|href|content|poster)\s*=\s*["'])(?!\/|https?:)(assets\/[^"']+)/gi,
    "$1/$2",
  );
  out = out.replace(/url\s*\(\s*['"]\/\/assets\//g, "url('/assets/");
  out = out.replace(/((?:src|href|content|poster)\s*=\s*["'])\/\/assets\//gi, "$1/assets/");
  return out;
}
