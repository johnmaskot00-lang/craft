/** Agent-only project files — never shown in the editor UI or uploaded to public hosting. */
export const CRAFT_MD_FILENAME = "craft.md";

export function isInternalAgentFile(filename: string): boolean {
  return filename.trim().toLowerCase() === CRAFT_MD_FILENAME;
}

/** Extra pages the user can open as editor tabs (HTML only; craft.md excluded). */
export function isEditorVisibleProjectFile(filename: string): boolean {
  const lower = filename.trim().toLowerCase();
  if (lower === "index.html") return false;
  if (isInternalAgentFile(lower)) return false;
  return lower.endsWith(".html");
}

/** Extra pages that may be published to the public site bucket. */
export function isPublishableProjectFile(filename: string): boolean {
  const lower = filename.trim().toLowerCase();
  if (lower === "index.html") return false;
  if (isInternalAgentFile(lower)) return false;
  return lower.endsWith(".html");
}

/** Project-owned stylesheet paths, not arbitrary URLs or internal files. */
export function isProjectStylesheet(filename: string): boolean {
  return /^(?:[a-z0-9_][a-z0-9_.-]*\/)*[a-z0-9_][a-z0-9_.-]*\.css$/i.test(filename);
}

// Leave lookalike link tags in comments, scripts, and other raw text alone.
const stylesheetTokens = /<!--[\s\S]*?(?:-->|$)|<(script|style|textarea|title|xmp|iframe|noscript)(?=\s|>)(?:[^"'<>]|"[^"]*"|'[^']*')*>[\s\S]*?(?:<\/\1\s*>|$)|<(?=[a-z])(?:[^"'<>]|"[^"]*"|'[^']*')*>/gi;

function mapProjectStylesheetLinks(
  html: string,
  page: string,
  visit: (link: string, path: string, media: string | undefined) => string,
): string {
  return html.replace(stylesheetTokens, (link) => {
    if (!/^<link\s/i.test(link)) return link;
    const attrs = new Map(Array.from(
      link.slice(5, -1).matchAll(/([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'`=<>]+)))?/g),
      ([, name, a, b, c]) => [name.toLowerCase(), a ?? b ?? c ?? ""],
    ));
    const rel = (attrs.get("rel") || "").toLowerCase().split(/\s+/);
    const href = attrs.get("href")?.trim();
    if (!rel.includes("stylesheet") || rel.includes("alternate") || attrs.has("disabled") || !href || /^(?:[a-z][\w+.-]*:|\/\/)|\\/i.test(href)) return link;
    const origin = "https://project.invalid";
    try {
      const url = new URL(href, `${origin}/${page}`);
      const path = url.pathname.slice(1);
      return url.origin === origin && isProjectStylesheet(path) ? visit(link, path, attrs.get("media")) : link;
    } catch {
      return link;
    }
  });
}

export function linkedProjectStylesheets(html: string, page: string): Set<string> {
  const files = new Set<string>();
  mapProjectStylesheetLinks(html, page, (link, path) => { files.add(path); return link; });
  return files;
}

/** srcdoc cannot fetch relative project files, so inline linked project CSS for preview only. */
export function inlineProjectStylesheets(html: string, page: string, styles: ReadonlyMap<string, string>): string {
  if (!styles.size) return html;
  return mapProjectStylesheetLinks(html, page, (link, path, media) => {
    const css = styles.get(path);
    if (css === undefined) return link;
    const mediaAttr = media === undefined ? "" : ` media="${media.replace(/"/g, "&quot;").replace(/>/g, "&gt;")}"`;
    return `<style data-craft-css-link="${encodeURIComponent(link)}"${mediaAttr}>${css.replace(/<\/style/gi, "<\\/style")}</style>`;
  });
}

/** Restore the source links before serializing a visual edit. */
export function restoreProjectStylesheetLinks(html: string): string {
  if (!html.includes("data-craft-css-link")) return html;
  return html.replace(stylesheetTokens, (token) => {
    const marker = /^<style data-craft-css-link="([^"]+)"[^>]*>/i.exec(token);
    if (!marker) return token;
    try {
      const link = decodeURIComponent(marker[1]);
      return /^<link\s(?:[^"'<>]|"[^"]*"|'[^']*')*>$/i.test(link) ? link : token;
    } catch {
      return token;
    }
  });
}

export type PublishFileLike = {
  filename: string;
  content?: string;
  contentBuffer?: Buffer;
};

/** Map `about.html` → `/about/` for sitemaps and GEO surfaces. */
export function htmlFilenameToCleanPath(filename: string): string | null {
  const name = String(filename || "").replace(/^\/+/, "");
  if (!name.endsWith(".html") || name.includes("/")) return null;
  if (name === "index.html") return "/";
  return `/${name.slice(0, -".html".length)}/`;
}

/**
 * Duplicate flat multipage HTML files into clean URL keys so Yandex website
 * hosting can serve `/oplata` and `/oplata/` in addition to `/oplata.html`.
 */
export function expandMultipageCleanUrlFiles<T extends PublishFileLike>(files: T[]): T[] {
  const out: T[] = [...files];
  const seen = new Set(files.map((f) => f.filename.replace(/^\/+/, "")));

  for (const file of files) {
    const key = file.filename.replace(/^\/+/, "");
    const match = /^([a-z0-9][a-z0-9_-]*)\.html$/i.exec(key);
    if (!match || match[1].toLowerCase() === "index") continue;
    const slug = match[1];

    for (const alias of [`${slug}/index.html`, slug]) {
      if (seen.has(alias)) continue;
      out.push({ ...file, filename: alias });
      seen.add(alias);
    }
  }

  return out;
}
