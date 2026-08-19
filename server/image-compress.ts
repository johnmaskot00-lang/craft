import type sharp from "sharp";

/** High-quality web publish preset: keeps detail while capping pathological originals. */
export async function compressImageForPublish(buffer: Buffer): Promise<Buffer> {
  return compressRasterImage(buffer, {
    targetMaxBytes: 1200 * 1024,
    maxDim: 2400,
    quality: 88,
    fallbackQuality: 82,
    fallbackDim: 2000,
  });
}

/** SEO covers remain crisp on retina displays and are not recompressed at publish time. */
export async function compressSeoCoverImage(buffer: Buffer): Promise<Buffer> {
  return compressRasterImage(buffer, {
    targetMaxBytes: 900 * 1024,
    maxDim: 1920,
    quality: 88,
    fallbackQuality: 80,
    fallbackDim: 1600,
  });
}

async function compressRasterImage(
  buffer: Buffer,
  opts: {
    targetMaxBytes: number;
    maxDim: number;
    quality: number;
    fallbackQuality: number;
    fallbackDim: number;
  },
): Promise<Buffer> {
  const { targetMaxBytes, maxDim, quality, fallbackQuality, fallbackDim } = opts;
  if (buffer.length <= targetMaxBytes) return buffer;
  try {
    const sharpMod = (await import("sharp")).default as typeof sharp;
    try { sharpMod.cache(false); sharpMod.concurrency(1); } catch { /* ignore */ }
    const meta = await sharpMod(buffer).metadata();
    if (!meta.width || !meta.height) return buffer;
    const resizeOpts = (meta.width > maxDim || meta.height > maxDim)
      ? { width: maxDim, height: maxDim, fit: "inside" as const, withoutEnlargement: true }
      : undefined;
    const mk = () => {
      let p = sharpMod(buffer).rotate();
      if (resizeOpts) p = p.resize(resizeOpts);
      return p;
    };
    let out: Buffer;
    if (meta.hasAlpha) {
      out = await mk().webp({ quality, effort: 5, smartSubsample: true }).toBuffer();
      if (out.length > targetMaxBytes) {
        out = await sharpMod(buffer).rotate().resize({
          width: fallbackDim, height: fallbackDim,
          fit: "inside", withoutEnlargement: true,
        }).webp({ quality: fallbackQuality, effort: 5, smartSubsample: true }).toBuffer();
      }
    } else {
      out = await mk().jpeg({ quality, mozjpeg: true, chromaSubsampling: "4:4:4" }).toBuffer();
      if (out.length > targetMaxBytes) {
        out = await sharpMod(buffer).rotate().resize({
          width: fallbackDim, height: fallbackDim,
          fit: "inside", withoutEnlargement: true,
        }).jpeg({ quality: fallbackQuality, mozjpeg: true, chromaSubsampling: "4:4:4" }).toBuffer();
      }
    }
    return out.length < buffer.length ? out : buffer;
  } catch (e: any) {
    console.warn(`[ImageCompress] Skipped (using original):`, e?.message || e);
    return buffer;
  }
}

/** Detect mime + extension from magic bytes (after compression format may differ). */
export function detectImageFormat(buffer: Buffer): { mime: string; ext: string } | null {
  if (buffer.length < 12) return null;
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47) {
    return { mime: "image/png", ext: "png" };
  }
  if (buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF) {
    return { mime: "image/jpeg", ext: "jpg" };
  }
  if (buffer.slice(0, 4).toString("ascii") === "RIFF" && buffer.slice(8, 12).toString("ascii") === "WEBP") {
    return { mime: "image/webp", ext: "webp" };
  }
  if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46) {
    return { mime: "image/gif", ext: "gif" };
  }
  return null;
}
