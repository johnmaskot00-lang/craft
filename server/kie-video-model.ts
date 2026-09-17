/**
 * Kling 3.0 Omni video generation for every interactive mode.
 *
 * Two models share one input shape:
 *   - reference-to-video — when we have a product photo or a generated still,
 *     so the clip keeps the real subject instead of inventing one;
 *   - text-to-video — when there is no usable image at all.
 *
 * Hero clips are scroll-scrubbed, so the camera move must be ONE continuous shot.
 * Multi-shot planning would cut the clip into scenes and break scrubbing, hence
 * both shot-planning flags stay off.
 */

export const KIE_OMNI_REFERENCE_MODEL = "kling-3.0-omni/reference-to-video";
export const KIE_OMNI_TEXT_MODEL = "kling-3.0-omni/text-to-video";

/** Omni prompt limit. */
const PROMPT_MAX = 3072;

/**
 * 4K clips are several times heavier than 1080p — they cost more to render and the
 * browser has to load the whole file to scrub it. Keep it switchable without a deploy.
 */
export function kieVideoResolution(): "720p" | "1080p" | "4k" {
  const raw = (process.env.CRAFT_KIE_VIDEO_RESOLUTION || "4k").trim().toLowerCase();
  return raw === "720p" || raw === "1080p" ? raw : "4k";
}

/** Omni accepts only JPG/JPEG/PNG references; anything else must not be sent. */
export function isOmniReferenceImage(url: string | null | undefined): boolean {
  if (!url) return false;
  if (!/^https?:\/\//i.test(url)) return false;
  return /\.(jpe?g|png)(\?|#|$)/i.test(url);
}

export type OmniVideoRequest = {
  model: string;
  input: Record<string, unknown>;
};

export function buildOmniVideoRequest(opts: {
  prompt: string;
  /** Product photo / generated still. Unsupported formats are dropped automatically. */
  imageUrls?: Array<string | null | undefined>;
  durationSec: number;
  aspectRatio?: "16:9" | "9:16" | "1:1";
}): OmniVideoRequest {
  const references = (opts.imageUrls || []).filter(isOmniReferenceImage).slice(0, 7) as string[];
  const duration = Math.max(3, Math.min(15, Math.round(opts.durationSec) || 5));

  const input: Record<string, unknown> = {
    prompt: opts.prompt.trim().slice(0, PROMPT_MAX),
    duration,
    resolution: kieVideoResolution(),
    aspect_ratio: opts.aspectRatio || "16:9",
    audio: false,
    // One uninterrupted camera move — required for scroll scrubbing.
    customize_multi_shots: false,
    prefer_multi_shots: false,
  };

  if (references.length) {
    input.image_urls = references;
    return { model: KIE_OMNI_REFERENCE_MODEL, input };
  }
  return { model: KIE_OMNI_TEXT_MODEL, input };
}
