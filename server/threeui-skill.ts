/**
 * Load the ThreeUI skill (distilled from MengTo/threeui) and inject it into
 * the Craft agent system prompt for interactiveStyle === "threeui".
 *
 * Source: skills/threeui/SKILL.md (vendored; based on github.com/MengTo/threeui).
 */

import fs from "fs";
import path from "path";

export const THREEUI_SKILL_REPO = "https://github.com/MengTo/threeui";

const MAX_SKILL_CHARS = 28_000;

function skillCandidates(): string[] {
  return [
    path.join(process.cwd(), "skills", "threeui", "SKILL.md"),
    path.join(process.cwd(), ".cursor", "skills", "threeui", "SKILL.md"),
    path.join(process.cwd(), "dist", "skills", "threeui", "SKILL.md"),
  ];
}

function stripFrontmatter(md: string): string {
  if (!md.startsWith("---")) return md.trim();
  const end = md.indexOf("\n---", 3);
  if (end < 0) return md.trim();
  return md.slice(end + 4).trim();
}

/** Read vendored SKILL.md from disk (sync — must be in the deploy bundle). */
export function loadThreeUiSkillMarkdown(): { text: string; path: string | null } {
  for (const p of skillCandidates()) {
    try {
      if (!fs.existsSync(p)) continue;
      const raw = fs.readFileSync(p, "utf8");
      if (!raw || raw.trim().length < 400) continue;
      let text = stripFrontmatter(raw);
      if (text.length > MAX_SKILL_CHARS) {
        text = text.slice(0, MAX_SKILL_CHARS) + "\n\n…[skill truncated]…";
      }
      return { text, path: p };
    } catch {
      /* try next */
    }
  }
  return { text: "", path: null };
}

/**
 * Block appended to ThreeUI system prompt so the model studies the skill
 * before emitting HTML (same idea as taste-skill study materials).
 */
export function buildThreeUiSkillAddon(): string {
  const { text, path: skillPath } = loadThreeUiSkillMarkdown();
  if (!text) {
    console.warn("[ThreeUI] SKILL.md missing — agent runs without threeui skill body");
    return `\n\n═══ THREEUI SKILL MISSING ═══
Expected skills/threeui/SKILL.md (from ${THREEUI_SKILL_REPO}).
Still follow THREEUI system rules: real WebGL planes, no CSS photo hero.
═══ END ═══\n`;
  }
  console.log(`[ThreeUI] injecting skill from ${skillPath} (${text.length} chars)`);
  return `\n\n═══ THREEUI SKILL — STUDY THEN BUILD ═══
Источник паттернов: ${THREEUI_SKILL_REPO} (Community MIT). Ниже — Craft-адаптированный SKILL.md.
Сначала изучи skill (архетип, grammar, skeleton), затем собери сайт ПОД НИШУ клиента.
НЕ копируй React/npm из upstream — только ванильный THREE из /three/three.min.js.

${text}

═══ КОНЕЦ THREEUI SKILL ═══\n`;
}
