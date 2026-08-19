/**
 * Craft bridge + study/build prompts for Leonxlnx/taste-skill.
 * Upstream skills target React/Next/Tailwind; Craft ships vanilla HTML + {{GENIMG}}.
 * https://github.com/Leonxlnx/taste-skill
 */

export const TASTE_SKILL_REPO = "https://github.com/Leonxlnx/taste-skill";

/**
 * Fallback when GitHub fetch fails — short Craft-adapted distill
 * (design-taste-frontend + soft + output ideas).
 */
export const PROFESSIONAL_TASTE_SKILL = `
═══ TASTE SKILL · PROFESSIONAL FALLBACK (Craft-adapted) ═══
Source: ${TASTE_SKILL_REPO} (offline distill)
You are an elite art director. Output must feel premium, art-directed, non-templated.

DIALS: DESIGN_VARIANCE 8 · MOTION_INTENSITY 6–7 · VISUAL_DENSITY 3–4
ANTI-SLOP: no purple AI gradients, no Inter/Roboto/Arial hero, no 3 equal feature cards as the whole story, no pill clutter in hero, no cards-in-cards.
STACK: pure HTML/CSS/JS, Google Fonts OK, CSS+IO motion, {{GENIMG}} only for images.
HERO: brand-first, one headline, one support line, one CTA, one dominant full-bleed visual.
Ship a senior-designer site — distinctive, cinematic where appropriate.
═══ END FALLBACK ═══
`.trim();

/** Non-negotiable Craft mapping after the agent studies upstream skills. */
export const CRAFT_TASTE_BRIDGE = `
═══ CRAFT RUNTIME BRIDGE (overrides stack assumptions in taste-skill) ═══
You studied Leonxlnx/taste-skill. Now implement for Craft AI — NOT React/Next/Tailwind/shadcn.

MUST:
- Pure HTML/CSS/JS documents only. Google Fonts via fonts.googleapis.com.
- Expressive display + body pairing (never Inter/Roboto/Arial/system as hero).
- Motion via CSS + IntersectionObserver / scroll — purposeful (no noisy infinite loops).
- Images ONLY as {{GENIMG:english prompt}} or {{GENIMG:prompt|REFN}} markers.
- Full production HTML. Complete every section. No skeletons / lorem / "// ...".
- Prefer premium Google Fonts stand-ins for Geist/Clash/PP Editorial (e.g. Syne, Unbounded, Fraunces, Instrument Serif, Manrope, DM Sans).

MUST NOT:
- Import Tailwind / Bootstrap / shadcn / Radix / GSAP CDN / npm packages (blocked or unavailable).
- Recreate React component trees; write semantic HTML.
- Purple-on-white / purple-indigo AI mesh as the default "premium" look (taste soft-skill Ethereal Glass: use deep OLED + restrained accent, not purple slop).
- Em-dashes as decorative AI tells in Russian marketing copy when avoidable.

When soft-skill / high-end conflicts with Craft bridge → Craft bridge wins on stack; keep soft-skill taste, spacing, variance, haptic shadows, layout archetypes.
═══ END CRAFT BRIDGE ═══
`.trim();

export const TASTE_STUDY_SYSTEM = `
You are a principal art director studying Leonxlnx/taste-skill before any code is written.
Repository: ${TASTE_SKILL_REPO}

Read the SKILL.md materials provided in the user message. Infer the right design language for the brief.
Do NOT write HTML/CSS/JS. Do NOT ask clarifying questions.

Output ONLY a structured DESIGN_DIRECTION in Russian (section labels can stay EN), exactly in this shape:

## DESIGN_DIRECTION
- page_kind:
- audience:
- vibe_read: (one sentence)
- dials: VARIANCE= / MOTION= / DENSITY=
- archetype: (from soft-skill vibe+layout picks, or taste-skill inference)
- palette: (3–5 hex + roles)
- typography: (display + body Google Fonts names available on fonts.googleapis.com)
- hero: (composition, brand signal, dominant visual idea, CTA)
- section_cadence: (4–7 sections with layout intent — asymmetric / editorial / bento / full-bleed quote — not three identical cards)
- motion_plan: (2–4 purposeful moments)
- anti_slop_checks: (bullet list of forbidden patterns you will avoid)
- genimg_plan: (2–5 concrete English image prompts for {{GENIMG}})
- wow_thesis: (one sentence: why this will not look like a generic AI landing)

Keep it concrete and niche-specific. Prefer premium / agency / editorial luxury for consumer studios when the brief is vague — never the default SaaS purple template.
`.trim();

export function buildTasteStudyUserMessage(opts: {
  userPrompt: string;
  skillsMarkdown: string;
  hasMockupRefs?: boolean;
}): string {
  return [
    `USER BRIEF:\n${opts.userPrompt.trim()}`,
    opts.hasMockupRefs
      ? "ATTACHED: design/product reference images will be available in the build step (image-to-code discipline applies)."
      : "ATTACHED: no mockup refs — invent a distinctive art-directed system from the brief + skills.",
    "",
    "TASTE-SKILL MATERIALS (from GitHub):",
    opts.skillsMarkdown,
  ].join("\n");
}

export function buildProfessionalBuildAddon(opts: {
  designDirection: string;
  usedSkills: string[];
  repo: string;
}): string {
  return [
    `═══ PROFESSIONAL · LEARN→BUILD ═══`,
    `You already studied ${opts.repo} (${opts.usedSkills.join(", ")}).`,
    `Implement the site STRICTLY from the DESIGN_DIRECTION below + CRAFT bridge.`,
    `Do not regress to a generic 3-card SaaS landing.`,
    "",
    CRAFT_TASTE_BRIDGE,
    "",
    opts.designDirection.trim(),
    `═══ END LEARN→BUILD ═══`,
  ].join("\n");
}
