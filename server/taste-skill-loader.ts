/**
 * Fetch Leonxlnx/taste-skill SKILL.md files from GitHub for Professional mode.
 * Cached in-memory (+ optional disk) so each generate does not re-download.
 * https://github.com/Leonxlnx/taste-skill
 */

import fs from "fs";
import path from "path";

const REPO_RAW =
  process.env.TASTE_SKILL_RAW_BASE?.trim() ||
  "https://raw.githubusercontent.com/Leonxlnx/taste-skill/main/skills";

const CACHE_TTL_MS = Math.max(
  60_000,
  Number(process.env.TASTE_SKILL_CACHE_TTL_MS || 6 * 60 * 60 * 1000) || 6 * 60 * 60 * 1000,
);

const DISK_CACHE_DIR =
  process.env.TASTE_SKILL_CACHE_DIR?.trim() ||
  path.join("/tmp", "craft-taste-skill-cache");

export type TasteSkillId =
  | "taste-skill"
  | "soft-skill"
  | "output-skill"
  | "image-to-code-skill"
  | "minimalist-skill"
  | "brutalist-skill";

export type LoadedTasteSkill = {
  id: TasteSkillId;
  installName: string;
  url: string;
  text: string;
  bytes: number;
  fromCache: boolean;
};

type CacheEntry = { text: string; fetchedAt: number; url: string };

const memoryCache = new Map<string, CacheEntry>();

const INSTALL_NAMES: Record<TasteSkillId, string> = {
  "taste-skill": "design-taste-frontend",
  "soft-skill": "high-end-visual-design",
  "output-skill": "full-output-enforcement",
  "image-to-code-skill": "image-to-code",
  "minimalist-skill": "minimalist-ui",
  "brutalist-skill": "industrial-brutalist-ui",
};

function skillUrl(id: TasteSkillId): string {
  return `${REPO_RAW}/${id}/SKILL.md`;
}

function diskPath(id: TasteSkillId): string {
  return path.join(DISK_CACHE_DIR, `${id}.md`);
}

function stripFrontmatter(md: string): string {
  if (!md.startsWith("---")) return md.trim();
  const end = md.indexOf("\n---", 3);
  if (end < 0) return md.trim();
  return md.slice(end + 4).trim();
}

async function fetchText(url: string, timeoutMs = 20_000): Promise<string> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const resp = await fetch(url, {
      signal: ctrl.signal,
      headers: {
        "User-Agent": "CraftAI-Professional/1.0 (taste-skill learner)",
        Accept: "text/plain, text/markdown, */*",
      },
    });
    if (!resp.ok) {
      throw new Error(`HTTP ${resp.status} fetching ${url}`);
    }
    return await resp.text();
  } finally {
    clearTimeout(t);
  }
}

function readDisk(id: TasteSkillId): CacheEntry | null {
  try {
    const p = diskPath(id);
    if (!fs.existsSync(p)) return null;
    const st = fs.statSync(p);
    if (Date.now() - st.mtimeMs > CACHE_TTL_MS) return null;
    const text = fs.readFileSync(p, "utf8");
    if (!text || text.length < 200) return null;
    return { text, fetchedAt: st.mtimeMs, url: skillUrl(id) };
  } catch {
    return null;
  }
}

function writeDisk(id: TasteSkillId, text: string): void {
  try {
    fs.mkdirSync(DISK_CACHE_DIR, { recursive: true });
    fs.writeFileSync(diskPath(id), text, "utf8");
  } catch (e: any) {
    console.warn(`[TASTE-SKILL] disk cache write failed for ${id}:`, e?.message || e);
  }
}

/** Load one SKILL.md (memory → disk → GitHub). */
export async function loadTasteSkill(id: TasteSkillId): Promise<LoadedTasteSkill> {
  const url = skillUrl(id);
  const mem = memoryCache.get(id);
  if (mem && Date.now() - mem.fetchedAt < CACHE_TTL_MS) {
    return {
      id,
      installName: INSTALL_NAMES[id],
      url,
      text: mem.text,
      bytes: Buffer.byteLength(mem.text, "utf8"),
      fromCache: true,
    };
  }

  const disk = readDisk(id);
  if (disk) {
    memoryCache.set(id, disk);
    return {
      id,
      installName: INSTALL_NAMES[id],
      url,
      text: disk.text,
      bytes: Buffer.byteLength(disk.text, "utf8"),
      fromCache: true,
    };
  }

  const raw = await fetchText(url);
  const text = stripFrontmatter(raw);
  if (text.length < 200) {
    throw new Error(`taste-skill ${id} too short (${text.length} chars)`);
  }
  const entry: CacheEntry = { text, fetchedAt: Date.now(), url };
  memoryCache.set(id, entry);
  writeDisk(id, text);
  return {
    id,
    installName: INSTALL_NAMES[id],
    url,
    text,
    bytes: Buffer.byteLength(text, "utf8"),
    fromCache: false,
  };
}

export type ProfessionalSkillPack = {
  source: string;
  skills: LoadedTasteSkill[];
  combinedMarkdown: string;
  totalBytes: number;
};

/**
 * Skills for Professional learn-then-build:
 * - design-taste-frontend (core dials / anti-slop)
 * - high-end-visual-design (wow / agency tier)
 * - full-output-enforcement (complete HTML)
 * - image-to-code when mockup refs are present
 */
export async function loadProfessionalTastePack(opts?: {
  withImageToCode?: boolean;
}): Promise<ProfessionalSkillPack> {
  const ids: TasteSkillId[] = ["taste-skill", "soft-skill", "output-skill"];
  if (opts?.withImageToCode) ids.push("image-to-code-skill");

  const skills: LoadedTasteSkill[] = [];
  const errors: string[] = [];
  for (const id of ids) {
    try {
      skills.push(await loadTasteSkill(id));
    } catch (e: any) {
      errors.push(`${id}: ${e?.message || e}`);
      console.warn(`[TASTE-SKILL] failed to load ${id}:`, e?.message || e);
    }
  }
  if (!skills.length) {
    throw new Error(
      `Could not load any taste-skill files from GitHub (${errors.join("; ") || "unknown"})`,
    );
  }

  const parts = skills.map(
    (s) =>
      `### SKILL: ${s.installName} (${s.id})\nSource: ${s.url}\n\n${s.text}`,
  );
  const combinedMarkdown = parts.join("\n\n────\n\n");
  return {
    source: "https://github.com/Leonxlnx/taste-skill",
    skills,
    combinedMarkdown,
    totalBytes: Buffer.byteLength(combinedMarkdown, "utf8"),
  };
}

/** Soft cap for study context — keep the richest skills first. */
export function truncateSkillsForStudy(combined: string, maxChars = 120_000): string {
  if (combined.length <= maxChars) return combined;
  return (
    combined.slice(0, maxChars) +
    "\n\n[… taste-skill truncated for context; apply the rules already loaded …]"
  );
}
