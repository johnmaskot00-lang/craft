/**
 * Dashboard thumbnails: the first real image of a site.
 *
 * Computed once when the site HTML is saved and cached in `projects.preview_image`.
 * Scanning the HTML per list request meant regexing hundreds of MB on every
 * dashboard load, which is why this never runs inside a query anymore.
 */

/** Only look at the head of the document — heroes and logos live near the top. */
const SCAN_LIMIT = 200_000;

const PATTERNS: RegExp[] = [
  /<img[^>]+src="(https?:\/\/[^"]+?\.(?:png|jpe?g|webp|avif)[^"]*)"/i,
  /<img[^>]+src="(\/objects\/[^"]+)"/i,
  /url\(\s*["']?(https?:\/\/[^)"'\s]+?\.(?:png|jpe?g|webp|avif)[^)"'\s]*)/i,
];

export function extractPreviewImage(html: string | null | undefined): string | null {
  if (!html) return null;
  const head = html.length > SCAN_LIMIT ? html.slice(0, SCAN_LIMIT) : html;
  for (const pattern of PATTERNS) {
    const src = pattern.exec(head)?.[1]?.trim();
    // Unresolved {{GENIMG:...}} / {{IMG:...}} markers and data URIs are not usable.
    if (!src || src.startsWith("data:") || src.includes("{{")) continue;
    if (src.length > 500) continue;
    return src;
  }
  return null;
}

/** Cheap in-memory flags derived once on save — never recompute inside SQL. */
export function deriveProjectContentMeta(html: string | null | undefined): {
  codeBytes: number;
  generatingPlaceholder: boolean;
  animPending: boolean;
  animReady: boolean;
} {
  const code = html || "";
  const animPending = code.includes('data-scroll-anim-pending="1"');
  return {
    codeBytes: Buffer.byteLength(code, "utf8"),
    generatingPlaceholder: code.includes('data-craft-generating="1"'),
    animPending,
    animReady:
      !animPending &&
      (code.includes("data-craft-scrollanim") || code.includes('data-scroll-anim-fallback="1"')),
  };
}
