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
