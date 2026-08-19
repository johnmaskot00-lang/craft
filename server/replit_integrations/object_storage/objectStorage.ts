import type { Request, Response } from "express";
import { randomUUID } from "crypto";
import fs from "fs";
import path from "path";
import {
  ObjectAclPolicy,
  ObjectPermission,
  canAccessObject,
  getObjectAclPolicy,
  setObjectAclPolicy,
} from "./objectAcl";

const ROOT = "/data/storage";
const LEGACY_PRIVATE_DIR = `${ROOT}/private`;
const FALLBACK_PRIVATE_DIR = "/data/craft-ai-storage/private";
const CONFIGURED_PRIVATE_DIR = () => process.env.PRIVATE_OBJECT_DIR || LEGACY_PRIVATE_DIR;
const PUB = () => (process.env.PUBLIC_OBJECT_SEARCH_PATHS || `${ROOT}/public`).split(",").map((s) => s.trim()).filter(Boolean);
const META = ".meta.json";
let cachedWritablePrivateDir: string | null = null;

// There is NO garbage-collector for /objects/uploads. Interactive hero frames,
// mp4 scrub videos, motion base/reveal photos, and GENIMG assets stay on disk
// for the lifetime of the deployment. Boot "cleanup" only touches DB tables
// (project_versions / sessions) and HTML pending placeholders — never these files.

function abs(p: string) {
  return path.posix.normalize(p.startsWith("/") ? p : `/${p}`);
}
function parse(p: string) {
  const parts = abs(p).split("/").filter(Boolean);
  if (parts.length < 2) throw new Error("Invalid object path");
  return { bucketName: parts[0], objectName: parts.slice(1).join("/") };
}
function fp(bucket: string, objectName: string) {
  return abs([bucket, ...objectName.split("/").filter(Boolean)].join("/"));
}
function ctype(p: string) {
  const e = path.posix.extname(p).toLowerCase();
  const m: Record<string, string> = {
    ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp",
    ".gif": "image/gif", ".svg": "image/svg+xml", ".mp4": "video/mp4", ".webm": "video/webm",
    ".mp3": "audio/mpeg", ".wav": "audio/wav", ".glb": "model/gltf-binary", ".gltf": "model/gltf+json",
    ".pdf": "application/pdf",
  };
  return m[e] || "application/octet-stream";
}

function privateSearchDirs(): string[] {
  return [...new Set([
    cachedWritablePrivateDir,
    CONFIGURED_PRIVATE_DIR(),
    FALLBACK_PRIVATE_DIR,
    LEGACY_PRIVATE_DIR,
  ].filter((value): value is string => !!value).map(abs))];
}

function writablePrivateDir(): string {
  if (cachedWritablePrivateDir) return cachedWritablePrivateDir;
  const failures: string[] = [];
  for (const candidate of privateSearchDirs()) {
    try {
      fs.mkdirSync(candidate, { recursive: true });
      fs.accessSync(candidate, fs.constants.R_OK | fs.constants.W_OK);
      // Verify actual file creation: access(W_OK) can be misleading on mounted volumes.
      const probe = path.posix.join(candidate, `.write-probe-${process.pid}-${Date.now()}`);
      fs.writeFileSync(probe, "ok");
      fs.unlinkSync(probe);
      cachedWritablePrivateDir = candidate;
      console.log(`[ObjectStorage] writable private dir: ${candidate}`);
      return candidate;
    } catch (err: any) {
      failures.push(`${candidate}: ${err?.code || err?.message || "unwritable"}`);
    }
  }
  throw new Error(`No writable persistent object-storage directory (${failures.join("; ")})`);
}

export class LocalFile {
  constructor(public absolutePath: string, public name: string) {}
  async exists(): Promise<[boolean]> {
    try { await fs.promises.access(this.absolutePath); return [true]; } catch { return [false]; }
  }
  async save(buf: Buffer, opts?: { contentType?: string; resumable?: boolean }) {
    await fs.promises.mkdir(path.posix.dirname(this.absolutePath), { recursive: true });
    await fs.promises.writeFile(this.absolutePath, buf);
    let meta: any = {};
    try { meta = JSON.parse(await fs.promises.readFile(this.absolutePath + META, "utf8")); } catch {}
    meta.contentType = opts?.contentType || meta.contentType || ctype(this.absolutePath);
    await fs.promises.writeFile(this.absolutePath + META, JSON.stringify(meta), "utf8");
  }
  createReadStream() { return fs.createReadStream(this.absolutePath); }
  /** GCS-compatible download used by publish bundling and image helpers. */
  async download(): Promise<[Buffer]> {
    const buf = await fs.promises.readFile(this.absolutePath);
    return [buf];
  }
  async getMetadata(): Promise<[any]> {
    const st = await fs.promises.stat(this.absolutePath);
    let meta: any = {};
    try { meta = JSON.parse(await fs.promises.readFile(this.absolutePath + META, "utf8")); } catch {}
    return [{ size: st.size, contentType: meta.contentType || ctype(this.absolutePath), metadata: meta.metadata || {} }];
  }
  async setMetadata(payload: { metadata?: Record<string, string> }) {
    let meta: any = {};
    try { meta = JSON.parse(await fs.promises.readFile(this.absolutePath + META, "utf8")); } catch {}
    meta.metadata = { ...(meta.metadata || {}), ...(payload.metadata || {}) };
    await fs.promises.mkdir(path.posix.dirname(this.absolutePath), { recursive: true });
    await fs.promises.writeFile(this.absolutePath + META, JSON.stringify(meta), "utf8");
  }
}

export const objectStorageClient = {
  bucket(bucketName: string) {
    return { file: (objectName: string) => new LocalFile(fp(bucketName, objectName), objectName) };
  },
};

export class ObjectNotFoundError extends Error {
  constructor() {
    super("Object not found");
    this.name = "ObjectNotFoundError";
    Object.setPrototypeOf(this, ObjectNotFoundError.prototype);
  }
}

export class ObjectStorageService {
  getPublicObjectSearchPaths() { return PUB().map(abs); }
  getPrivateObjectDir() { return writablePrivateDir(); }
  getPrivateObjectSearchDirs() { return privateSearchDirs(); }
  async searchPublicObject(filePath: string) {
    for (const searchPath of this.getPublicObjectSearchPaths()) {
      const full = path.posix.join(searchPath, filePath.replace(/^\/+/, ""));
      const { bucketName, objectName } = parse(full);
      const file = objectStorageClient.bucket(bucketName).file(objectName);
      if ((await file.exists())[0]) return file as any;
    }
    return null;
  }
  async downloadObject(file: any, res: Response, cacheTtlSec = 3600, req?: Request) {
    try {
      const [metadata] = await file.getMetadata();
      const acl = await getObjectAclPolicy(file);
      const isPublic = acl?.visibility === "public";
      const contentType = metadata.contentType || "application/octet-stream";
      const size = Number(metadata.size || 0);
      const headers: Record<string, string> = {
        "Content-Type": contentType,
        "Accept-Ranges": "bytes",
        "Cache-Control": `${isPublic ? "public" : "private"}, max-age=${cacheTtlSec}`,
        "X-Content-Type-Options": "nosniff",
        // Allow published sites (other origins) to fetch → Blob for MP4 scrub.
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Expose-Headers": "Content-Length, Content-Range, Accept-Ranges",
      };
      // Existing SVG blobs must not execute as active content on the app origin
      if (String(contentType).includes("svg")) {
        headers["Content-Disposition"] = "attachment";
        headers["Content-Security-Policy"] = "default-src 'none'; sandbox";
      }

      // Byte-range support is required for scroll-scrub MP4: browsers seek before
      // the whole file is buffered. Without 206 responses, hero video looks static.
      const range = req?.headers?.range;
      if (range && size > 0) {
        const m = /^bytes=(\d*)-(\d*)$/i.exec(String(range).trim());
        if (m) {
          let start = m[1] !== "" ? parseInt(m[1], 10) : 0;
          let end = m[2] !== "" ? parseInt(m[2], 10) : size - 1;
          if (!Number.isFinite(start) || start < 0) start = 0;
          if (!Number.isFinite(end) || end >= size) end = size - 1;
          if (start > end || start >= size) {
            res.status(416);
            res.set({ ...headers, "Content-Range": `bytes */${size}` });
            res.end();
            return;
          }
          const chunk = end - start + 1;
          res.status(206);
          res.set({
            ...headers,
            "Content-Range": `bytes ${start}-${end}/${size}`,
            "Content-Length": String(chunk),
          });
          const stream = fs.createReadStream(file.absolutePath, { start, end });
          stream.on("error", (err: any) => {
            if (err.code === "EPIPE" || err.code === "ECONNRESET") return;
            console.error("Stream error:", err);
            if (!res.headersSent) res.status(500).json({ error: "Error streaming file" });
          });
          req?.on("close", () => stream.destroy());
          stream.pipe(res);
          return;
        }
      }

      res.set({ ...headers, "Content-Length": String(size) });
      const stream = file.createReadStream();
      stream.on("error", (err: any) => {
        if (err.code === "EPIPE" || err.code === "ECONNRESET") return;
        console.error("Stream error:", err);
        if (!res.headersSent) res.status(500).json({ error: "Error streaming file" });
      });
      req?.on("close", () => stream.destroy());
      stream.pipe(res);
    } catch (e) {
      console.error("Error downloading file:", e);
      if (!res.headersSent) res.status(500).json({ error: "Error downloading file" });
    }
  }
  async getObjectEntityUploadURL() { return `/objects/uploads/${randomUUID()}`; }
  async getObjectEntityFile(objectPath: string) {
    if (!objectPath.startsWith("/objects/")) throw new ObjectNotFoundError();
    const id = objectPath.replace(/^\/objects\//, "");
    if (!id) throw new ObjectNotFoundError();
    for (const privateDir of this.getPrivateObjectSearchDirs()) {
      const full = path.posix.join(privateDir, id);
      const { bucketName, objectName } = parse(full);
      const file = objectStorageClient.bucket(bucketName).file(objectName);
      if ((await file.exists())[0]) return file as any;
    }
    throw new ObjectNotFoundError();
  }
  normalizeObjectEntityPath(rawPath: string) {
    if (!rawPath) return rawPath;
    if (rawPath.startsWith("http://") || rawPath.startsWith("https://")) {
      const pathname = new URL(rawPath).pathname;
      return pathname.startsWith("/objects/") ? pathname : rawPath;
    }
    if (rawPath.startsWith("/objects/")) return rawPath;
    const n = abs(rawPath);
    for (const dir of this.getPrivateObjectSearchDirs()) {
      if (n.startsWith(`${dir}/`)) return `/objects/${n.slice(dir.length + 1)}`;
    }
    return rawPath;
  }
  async trySetObjectEntityAclPolicy(rawPath: string, aclPolicy: ObjectAclPolicy) {
    const normalized = this.normalizeObjectEntityPath(rawPath);
    if (!normalized.startsWith("/")) return normalized;
    const file = await this.getObjectEntityFile(normalized);
    await setObjectAclPolicy(file, aclPolicy);
    return normalized;
  }
  async canAccessObjectEntity(opts: { userId?: string; objectFile: any; requestedPermission?: ObjectPermission }) {
    return canAccessObject({
      userId: opts.userId,
      objectFile: opts.objectFile,
      requestedPermission: opts.requestedPermission ?? ObjectPermission.READ,
    });
  }
}
