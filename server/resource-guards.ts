/**
 * Process-wide concurrency guards for local heavy work (ffmpeg / publish / uploads).
 *
 * Site HTML generation is mostly network I/O to KIE (stream + callbacks). Do NOT
 * bottleneck those at 2 — default CRAFT_MAX_GENERATES=100. Memory safety comes from:
 *   - heap-pressure rejection (rejectIfHeapPressure)
 *   - SSE payload shrinking (buildSseDataFrame / fetchCode) so we never JSON.stringify
 *     dozens of multi‑MB HTML blobs at once
 *   - generate-slot watchdog (force-release hung streams)
 *   - releasing the generate slot as soon as the LLM stream finishes — GENIMG / Kling
 *     wait on KIE callbacks and use imageSem / bgAnimSem / ffmpegSem instead
 *   - tight caps on ffmpeg / publish / uploads (the real local RAM burners)
 *
 * Tune via env:
 *   CRAFT_RAM_MB=2560|6144
 *   CRAFT_MAX_GENERATES / CRAFT_MAX_BG_ANIM / CRAFT_MAX_FFMPEG /
 *   CRAFT_MAX_PUBLISH / CRAFT_MAX_IMAGE_JOBS / CRAFT_MAX_UPLOADS
 */

function envInt(name: string, fallback: number): number {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

const ramMb = envInt("CRAFT_RAM_MB", 2560);

/**
 * Defaults: up to ~100 concurrent KIE generate waits (network-bound).
 * Keep local media jobs capped on small RAM so ffmpeg/JPEG extract cannot OOM.
 */
const defaults = ramMb >= 5000
  ? { generates: 100, bgAnim: 6, ffmpeg: 2, publish: 2, images: 12, uploads: 4, heapMb: 4096 }
  : { generates: 100, bgAnim: 4, ffmpeg: 1, publish: 1, images: 8, uploads: 2, heapMb: 1792 };

export const RESOURCE_PROFILE = {
  ramMb,
  heapMb: envInt("NODE_MAX_OLD_SPACE_SIZE", defaults.heapMb),
  maxGenerates: Math.min(100, envInt("CRAFT_MAX_GENERATES", defaults.generates)),
  maxBgAnim: envInt("CRAFT_MAX_BG_ANIM", defaults.bgAnim),
  maxFfmpeg: envInt("CRAFT_MAX_FFMPEG", defaults.ffmpeg),
  maxPublish: envInt("CRAFT_MAX_PUBLISH", defaults.publish),
  maxImageJobs: envInt("CRAFT_MAX_IMAGE_JOBS", defaults.images),
  maxUploads: envInt("CRAFT_MAX_UPLOADS", defaults.uploads),
  /**
   * Never hold the generate slot through BG ANIM. Kling/ffmpeg use their own
   * bgAnim/ffmpeg semaphores — pinning generate slots blocked other users
   * while KIE already finished the HTML.
   */
  holdGenerateThroughAnim: false,
  /** Milder frame extract on small RAM (still sharp; avoids 90× max-quality JPEGs). */
  lowRamMedia: ramMb < 5000,
};

type Release = () => void;

class Semaphore {
  private active = 0;
  private readonly queue: Array<() => void> = [];
  private readonly max: number;
  private readonly name: string;

  constructor(max: number, name: string) {
    this.max = max;
    this.name = name;
  }

  stats() {
    return { name: this.name, active: this.active, max: this.max, waiting: this.queue.length };
  }

  tryAcquire(): Release | null {
    if (this.active >= this.max) return null;
    this.active++;
    return () => this.release();
  }

  /** Wait up to timeoutMs for a slot; null on timeout. */
  async acquire(timeoutMs = 0): Promise<Release | null> {
    const immediate = this.tryAcquire();
    if (immediate) return immediate;
    if (timeoutMs <= 0) return null;

    return new Promise((resolve) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        const idx = this.queue.indexOf(grant);
        if (idx >= 0) this.queue.splice(idx, 1);
        resolve(null);
      }, timeoutMs);

      const grant = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(() => this.release());
      };
      this.queue.push(grant);
    });
  }

  private release() {
    const next = this.queue.shift();
    if (next) {
      // Transfer the slot to the next waiter (active unchanged).
      next();
    } else {
      this.active = Math.max(0, this.active - 1);
    }
  }
}

const generateSem = new Semaphore(RESOURCE_PROFILE.maxGenerates, "generate");
const bgAnimSem = new Semaphore(RESOURCE_PROFILE.maxBgAnim, "bg-anim");
const ffmpegSem = new Semaphore(RESOURCE_PROFILE.maxFfmpeg, "ffmpeg");
const publishSem = new Semaphore(RESOURCE_PROFILE.maxPublish, "publish");
const imageSem = new Semaphore(RESOURCE_PROFILE.maxImageJobs, "image-jobs");
const uploadSem = new Semaphore(RESOURCE_PROFILE.maxUploads, "uploads");

/** heapUsed / configured --max-old-space-size. */
export function heapPressureRatio(): number {
  const limit = Math.max(64, RESOURCE_PROFILE.heapMb) * 1024 * 1024;
  return process.memoryUsage().heapUsed / limit;
}

/** Soft cap for one SSE JSON frame — above this V8 JsonStringify often aborts the 1.8GB heap. */
export const SSE_JSON_MAX_BYTES = envInt("CRAFT_SSE_JSON_MAX_BYTES", 900_000);

const SSE_HEAVY_KEYS = new Set([
  "code",
  "editedCode",
  "content",
  "html",
  "generatedCode",
  "reply",
]);

function estimateStringHeavyBytes(payload: Record<string, unknown>): number {
  let n = 64;
  for (const [k, v] of Object.entries(payload)) {
    if (typeof v === "string") n += v.length + k.length + 8;
    else if (v != null) n += 48;
  }
  return n;
}

/**
 * Build an SSE `data: …\n\n` frame without OOMing on multi‑MB HTML.
 * Drops duplicate/heavy string fields and sets `fetchCode` when the client
 * should reload code from `/api/projects/:id` instead.
 */
export function buildSseDataFrame(
  payload: Record<string, unknown>,
  maxBytes = SSE_JSON_MAX_BYTES,
): string {
  const body: Record<string, unknown> = { ...payload };

  // Avoid sending the same multi‑MB HTML twice in one frame.
  if (
    typeof body.code === "string" &&
    typeof body.editedCode === "string" &&
    body.editedCode === body.code
  ) {
    delete body.editedCode;
  }

  const pressure = heapPressureRatio();
  const est = estimateStringHeavyBytes(body);
  const mustShrink = est > maxBytes || pressure >= 0.78;

  if (mustShrink) {
    for (const key of SSE_HEAVY_KEYS) {
      const v = body[key];
      if (typeof v !== "string") continue;
      if (key === "code" || key === "editedCode" || key === "content" || key === "html" || key === "generatedCode") {
        body[`${key}Bytes`] = v.length;
        delete body[key];
        body.fetchCode = true;
      } else if (v.length > 4000) {
        body[key] = `${v.slice(0, 4000)}…`;
      }
    }
  }

  // Streaming preview of huge model HTML is optional — final `done` carries code
  // (or fetchCode). Skipping avoids a second full-size stringify spike.
  if (typeof body.content === "string" && body.content.length > 120_000) {
    body.contentBytes = body.content.length;
    delete body.content;
    body.contentOmitted = true;
  }

  try {
    let json = JSON.stringify(body);
    if (json.length <= maxBytes) return `data: ${json}\n\n`;

    // Last resort: metadata only.
    const tiny: Record<string, unknown> = {
      done: body.done === true,
      fetchCode: true,
      payloadTooLarge: true,
      bytes: json.length,
    };
    if (body.chatOnly) tiny.chatOnly = true;
    if (body.animPending) tiny.animPending = true;
    if (body.newBalance !== undefined) tiny.newBalance = body.newBalance;
    if (body.creditsUsed !== undefined) tiny.creditsUsed = body.creditsUsed;
    if (body.editedFile) tiny.editedFile = body.editedFile;
    if (body.editedFiles) tiny.editedFiles = body.editedFiles;
    if (typeof body.reply === "string") tiny.reply = body.reply.slice(0, 2000);
    json = JSON.stringify(tiny);
    return `data: ${json}\n\n`;
  } catch (e: any) {
    console.warn("[SSE] JSON.stringify failed:", e?.message || e);
    return `data: ${JSON.stringify({ done: true, fetchCode: true, payloadTooLarge: true })}\n\n`;
  }
}

export function writeSseJson(
  res: { write: (chunk: string) => unknown },
  payload: Record<string, unknown>,
  maxBytes = SSE_JSON_MAX_BYTES,
): void {
  try {
    res.write(buildSseDataFrame(payload, maxBytes));
  } catch (e: any) {
    console.warn("[SSE] write failed:", e?.message || e);
  }
}

export function isHeapUnderPressure(ratio = 0.82): boolean {
  return heapPressureRatio() >= ratio;
}

function rejectIfHeapPressure(kind: string): boolean {
  if (!isHeapUnderPressure()) return false;
  console.warn(
    `[LOAD] ${kind} rejected — heap pressure ${(heapPressureRatio() * 100).toFixed(0)}% ` +
      `(${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB / ${RESOURCE_PROFILE.heapMb}MB)`,
  );
  return true;
}

/** Max wall-clock a generate slot may be held (covers hung KIE streams). */
const GENERATE_SLOT_MAX_MS = envInt("CRAFT_GENERATE_SLOT_MAX_MS", 12 * 60 * 1000);

export function tryAcquireGenerate(): Release | null {
  if (rejectIfHeapPressure("generate")) return null;
  const rel = generateSem.tryAcquire();
  if (!rel) {
    console.warn(`[LOAD] generate rejected — ${JSON.stringify(generateSem.stats())}`);
    return null;
  }
  let released = false;
  const releaseOnce = () => {
    if (released) return;
    released = true;
    clearTimeout(forceTimer);
    rel();
  };
  const forceTimer = setTimeout(() => {
    console.warn(
      `[LOAD] generate slot force-released after ${Math.round(GENERATE_SLOT_MAX_MS / 1000)}s (likely hung KIE stream)`,
    );
    releaseOnce();
  }, GENERATE_SLOT_MAX_MS);
  // Don't keep the process awake solely for the watchdog.
  forceTimer.unref?.();
  return releaseOnce;
}

export function tryAcquirePublish(): Release | null {
  if (rejectIfHeapPressure("publish")) return null;
  const rel = publishSem.tryAcquire();
  if (!rel) {
    console.warn(`[LOAD] publish rejected — ${JSON.stringify(publishSem.stats())}`);
  }
  return rel;
}

export async function acquireBgAnim(timeoutMs = 30_000): Promise<Release | null> {
  const rel = await bgAnimSem.acquire(timeoutMs);
  if (!rel) console.warn(`[LOAD] bg-anim timeout — ${JSON.stringify(bgAnimSem.stats())}`);
  return rel;
}

export async function withFfmpegSlot<T>(fn: () => Promise<T>, timeoutMs = 180_000): Promise<T> {
  const rel = await ffmpegSem.acquire(timeoutMs);
  if (!rel) throw new Error("Сервер занят обработкой видео. Подождите минуту и повторите.");
  try {
    return await fn();
  } finally {
    rel();
  }
}

export async function withImageSlot<T>(fn: () => Promise<T>, timeoutMs = 120_000): Promise<T> {
  if (rejectIfHeapPressure("image-job")) {
    throw new Error("Сервер перегружен (память). Подождите минуту и повторите.");
  }
  const rel = await imageSem.acquire(timeoutMs);
  if (!rel) throw new Error("Очередь генерации изображений переполнена. Повторите через минуту.");
  try {
    return await fn();
  } finally {
    rel();
  }
}

export async function withUploadSlot<T>(fn: () => Promise<T>, timeoutMs = 60_000): Promise<T> {
  if (isHeapUnderPressure(0.88)) {
    console.warn(`[LOAD] upload rejected — heap pressure ${(heapPressureRatio() * 100).toFixed(0)}%`);
    throw new Error("Сервер перегружен (память). Подождите минуту и повторите.");
  }
  const rel = await uploadSem.acquire(timeoutMs);
  if (!rel) throw new Error("Слишком много загрузок одновременно. Подождите и повторите.");
  try {
    return await fn();
  } finally {
    rel();
  }
}

export function getLoadStats() {
  return {
    profile: RESOURCE_PROFILE,
    generate: generateSem.stats(),
    bgAnim: bgAnimSem.stats(),
    ffmpeg: ffmpegSem.stats(),
    publish: publishSem.stats(),
    images: imageSem.stats(),
    uploads: uploadSem.stats(),
    heapPressure: Math.round(heapPressureRatio() * 1000) / 1000,
    memory: process.memoryUsage(),
  };
}

console.log(
  `[LOAD] resource profile RAM≈${RESOURCE_PROFILE.ramMb}MB heap≈${RESOURCE_PROFILE.heapMb}MB ` +
    `generates=${RESOURCE_PROFILE.maxGenerates} bgAnim=${RESOURCE_PROFILE.maxBgAnim} ` +
    `ffmpeg=${RESOURCE_PROFILE.maxFfmpeg} publish=${RESOURCE_PROFILE.maxPublish} ` +
    `images=${RESOURCE_PROFILE.maxImageJobs} uploads=${RESOURCE_PROFILE.maxUploads}`,
);

// Soft warn when heap climbs — helps correlate Amvera graphs with app activity.
let lastHeapWarnAt = 0;
setInterval(() => {
  const ratio = heapPressureRatio();
  if (ratio < 0.75) return;
  const now = Date.now();
  if (now - lastHeapWarnAt < 60_000) return;
  lastHeapWarnAt = now;
  const mem = process.memoryUsage();
  console.warn(
    `[LOAD] heap warn ${(ratio * 100).toFixed(0)}% ` +
      `heapUsed=${Math.round(mem.heapUsed / 1024 / 1024)}MB ` +
      `rss=${Math.round(mem.rss / 1024 / 1024)}MB ` +
      `load=${JSON.stringify({
        g: generateSem.stats(),
        bg: bgAnimSem.stats(),
        ff: ffmpegSem.stats(),
        p: publishSem.stats(),
        u: uploadSem.stats(),
      })}`,
  );
}, 15_000).unref?.();
