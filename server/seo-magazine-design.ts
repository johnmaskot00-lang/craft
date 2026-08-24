/**
 * Agent-owned magazine art direction for SEO sites (architectureVersion 6).
 * Produces unique index.html + assets/style.css — not a fixed server template.
 */
import type { SeoConfig, SeoCluster, SeoKeyword, SeoTheme } from "@shared/schema";

export const SEO_HERO_VARIANTS = [
  "slider-split",
  "cinematic-cover",
  "mosaic-stage",
  "newsroom-wire",
  "story-rail",
  "topic-orbit",
  "magazine-deck",
] as const;

export type SeoHeroVariant = (typeof SEO_HERO_VARIANTS)[number];

export function isArtDirectedSeo(cfg: Pick<SeoConfig, "architectureVersion" | "theme">): boolean {
  return (cfg.architectureVersion ?? 0) >= 6 || !!cfg.theme?.artDirected;
}

export function pickHeroVariant(seed: string): SeoHeroVariant {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return SEO_HERO_VARIANTS[h % SEO_HERO_VARIANTS.length];
}

/**
 * Mechanical variety for the reading layout. The model gravitates to one
 * "safe" article page (sticky sidebar right, inset cover, drop-cap lead) no
 * matter the niche, so the shape is assigned from the project seed and the
 * agent designs *within* it.
 */
export const SEO_READING_LAYOUTS = [
  "sidebar-right",
  "sidebar-left",
  "wide-no-sidebar",
  "narrow-margin-notes",
  "two-column-opening",
  "rail-toc",
] as const;
export type SeoReadingLayout = (typeof SEO_READING_LAYOUTS)[number];

export const SEO_COVER_TREATMENTS = [
  "full-bleed",
  "inset-rounded",
  "split-with-title",
  "framed-caption",
  "no-cover-typographic",
] as const;
export type SeoCoverTreatment = (typeof SEO_COVER_TREATMENTS)[number];

export const SEO_TITLE_TREATMENTS = [
  "oversized-flush-left",
  "centered-serif-rule",
  "kicker-over-title",
  "numbered-editorial",
  "title-over-cover",
] as const;
export type SeoTitleTreatment = (typeof SEO_TITLE_TREATMENTS)[number];

/**
 * Left free, the model reaches for the same dark editorial skin every time, so
 * the palette, type voice and homepage rhythm are assigned per project too.
 */
export const SEO_PALETTES = [
  "paper-light",
  "ink-dark",
  "warm-cream",
  "cold-editorial",
  "duotone-accent",
  "high-contrast-mono",
  "muted-pastel",
] as const;
export type SeoPalette = (typeof SEO_PALETTES)[number];

export const SEO_TYPE_VOICES = [
  "serif-display",
  "grotesque-bold",
  "condensed-news",
  "humanist-soft",
  "mono-accent",
  "mixed-serif-sans",
] as const;
export type SeoTypeVoice = (typeof SEO_TYPE_VOICES)[number];

export const SEO_HOME_RHYTHMS = [
  "hero-then-feed",
  "categories-first",
  "editors-picks-band",
  "index-column-list",
  "alternating-bands",
] as const;
export type SeoHomeRhythm = (typeof SEO_HOME_RHYTHMS)[number];

export type SeoLayoutDna = {
  hero: SeoHeroVariant;
  reading: SeoReadingLayout;
  cover: SeoCoverTreatment;
  title: SeoTitleTreatment;
  palette: SeoPalette;
  type: SeoTypeVoice;
  rhythm: SeoHomeRhythm;
};

function seedHash(seed: string, salt: string): number {
  let h = 2166136261 >>> 0;
  const s = `${salt}::${seed}`;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

export function pickLayoutDna(seed: string): SeoLayoutDna {
  return {
    hero: SEO_HERO_VARIANTS[seedHash(seed, "hero") % SEO_HERO_VARIANTS.length],
    reading: SEO_READING_LAYOUTS[seedHash(seed, "reading") % SEO_READING_LAYOUTS.length],
    cover: SEO_COVER_TREATMENTS[seedHash(seed, "cover") % SEO_COVER_TREATMENTS.length],
    title: SEO_TITLE_TREATMENTS[seedHash(seed, "title") % SEO_TITLE_TREATMENTS.length],
    palette: SEO_PALETTES[seedHash(seed, "palette") % SEO_PALETTES.length],
    type: SEO_TYPE_VOICES[seedHash(seed, "type") % SEO_TYPE_VOICES.length],
    rhythm: SEO_HOME_RHYTHMS[seedHash(seed, "rhythm") % SEO_HOME_RHYTHMS.length],
  };
}

function paletteDescription(v: SeoPalette): string {
  switch (v) {
    case "paper-light":
      return "light paper background, near-black text, one saturated accent. Bright and airy — NOT a dark theme.";
    case "ink-dark":
      return "deep ink background with warm off-white text and a single glowing accent.";
    case "warm-cream":
      return "cream/sand background, brown-black text, terracotta or olive accent. Print magazine warmth.";
    case "cold-editorial":
      return "cool grey-white surfaces, steel blue or slate accent, crisp hairlines.";
    case "duotone-accent":
      return "two strong brand colours carrying the whole site (background tint + accent), minimal neutrals.";
    case "high-contrast-mono":
      return "black and white with one tiny accent used sparingly — brutal editorial contrast.";
    case "muted-pastel":
      return "soft desaturated pastel surfaces with a deep text colour; gentle, boutique feel.";
    default:
      return String(v);
  }
}

function typeVoiceDescription(v: SeoTypeVoice): string {
  switch (v) {
    case "serif-display":
      return "expressive Cyrillic serif for headlines (e.g. Playfair Display, PT Serif, Cormorant), quiet sans for body.";
    case "grotesque-bold":
      return "heavy neo-grotesque headlines with tight tracking; same family lighter for body.";
    case "condensed-news":
      return "condensed newspaper headlines, wide-set body text — dense masthead energy.";
    case "humanist-soft":
      return "friendly humanist sans throughout, generous line height, rounded shapes.";
    case "mono-accent":
      return "sans body with monospace kickers, meta and numbers as the signature detail.";
    case "mixed-serif-sans":
      return "serif deck/lead against sans headlines — deliberate mismatch as the house style.";
    default:
      return String(v);
  }
}

function homeRhythmDescription(v: SeoHomeRhythm): string {
  switch (v) {
    case "hero-then-feed":
      return "hero, then straight into the article feed; categories live in the footer/menu.";
    case "categories-first":
      return "a strong category index sits above the hero — the site reads as a directory first.";
    case "editors-picks-band":
      return "hero, then a hand-picked band of 2–3 highlighted stories, then the feed.";
    case "index-column-list":
      return "the homepage is a numbered index list of material rather than a card grid (the feed block still exists below).";
    case "alternating-bands":
      return "full-width alternating colour bands, each section on its own surface.";
    default:
      return String(v);
  }
}

function readingLayoutDescription(v: SeoReadingLayout): string {
  switch (v) {
    case "sidebar-right":
      return "main column + sticky right rail (related, category index, offer).";
    case "sidebar-left":
      return "sticky left rail carrying navigation/context, text column on the right.";
    case "wide-no-sidebar":
      return "no rail at all — one wide centred measure, section dividers do the structuring work.";
    case "narrow-margin-notes":
      return "narrow text measure with margin notes / pull elements hanging into the outer margin (desktop only).";
    case "two-column-opening":
      return "opening spread is two columns (deck + meta beside the lead), then the body collapses to one measure.";
    case "rail-toc":
      return "slim vertical section rail that tracks scroll position beside the text.";
    default:
      return String(v);
  }
}

function coverTreatmentDescription(v: SeoCoverTreatment): string {
  switch (v) {
    case "full-bleed":
      return "cover runs edge to edge above the text.";
    case "inset-rounded":
      return "cover sits inside the measure with generous whitespace.";
    case "split-with-title":
      return "cover and title share a split composition side by side.";
    case "framed-caption":
      return "cover is framed with a visible caption/credit line, print style.";
    case "no-cover-typographic":
      return "no big cover — the opening is purely typographic; the photo appears later in the body.";
    default:
      return String(v);
  }
}

function titleTreatmentDescription(v: SeoTitleTreatment): string {
  switch (v) {
    case "oversized-flush-left":
      return "very large flush-left headline, tight tracking.";
    case "centered-serif-rule":
      return "centred headline with a rule above/below, classic print.";
    case "kicker-over-title":
      return "small kicker line above a medium headline.";
    case "numbered-editorial":
      return "issue/section number set beside the headline.";
    case "title-over-cover":
      return "headline overlaid on the cover with a readable scrim.";
    default:
      return String(v);
  }
}

export type SeoArticleBrief = {
  title: string;
  href: string;
  cluster: string;
  image?: string;
};

export const SEO_HOME_FEED_PAGE_SIZE = 12;

export function collectSeoArticleBriefs(
  cfg: SeoConfig,
  limit = 500,
  opts?: { includePlanned?: boolean },
): SeoArticleBrief[] {
  const out: SeoArticleBrief[] = [];
  for (const c of cfg.clusters) {
    for (const kw of c.keywords) {
      if (kw.status !== "done" && !opts?.includePlanned) continue;
      out.push({
        title: kw.title,
        href: `/${c.slug}/${kw.slug}/`,
        cluster: c.name,
        image: kw.image || undefined,
      });
      if (out.length >= limit) return out;
    }
  }
  return out;
}

export function buildMagazineDesignPrompt(opts: {
  cfg: SeoConfig;
  dna: SeoLayoutDna;
  articles: SeoArticleBrief[];
  logoUrl?: string;
  tasteBrief?: string;
  critique?: string;
}): string {
  const { cfg, dna, articles, logoUrl, tasteBrief, critique } = opts;
  const heroVariant = dna.hero;
  const cats = cfg.clusters.map((c) => ({
    name: c.name,
    slug: c.slug,
    href: `/${c.slug}/`,
    description: c.description,
    count: c.keywords.filter((k) => k.status === "done").length,
  }));
  const feedPreview = articles.slice(0, 12);

  return `You are a world-class digital magazine art director (Russian UI).
Design ONE complete publication: stylesheet + homepage + ARTICLE PAGE TEMPLATE + CATEGORY PAGE TEMPLATE + the component kit its writers must use.
Beauty and uniqueness come FIRST. Technical contracts are short and at the end.

════════════════════════════════════
1) CREATIVE NORTH STAR (non-negotiable)
════════════════════════════════════
- First decide WHAT KIND OF PUBLICATION this niche deserves — cookbook, field guide, trade journal, city guide, buyer's lab, almanac, fanzine, clinical reference… The niche picks the format, not a generic "tech blog" default.
- Invent a visual system that could ONLY belong to THIS niche after removing the logo.
- Custom masthead/menu (editorial, numbered, side rail, oversized type, underline tabs — YOUR call). Forbidden: generic sticky dark glass bar + cyan pills + identical dark cards.
- Expressive Cyrillic Google Fonts pair unique to this brief (never Inter/Roboto/Arial/Onest+cyan default).
- Rich atmosphere: living backgrounds, intentional motion, magazine photography hierarchy — still WCAG-readable.
- Interactive Hero is the star (${heroVariant}): ${heroVariantDescription(heroVariant)}
- Brand lockup = magazine title ${JSON.stringify(cfg.siteTitle)} + short editorial deck from niche — NOT a partner marketplace pitch.
- Optional header CTA only: ${cfg.targetUrl ? JSON.stringify(cfg.targetUrl) : "(none)"} · ${JSON.stringify(cfg.ctaLabel || "Подробнее")}
- Do NOT put partner/offer brand names into hero badges, H1, deck, category names, or footer essays. Offers live inside articles later.

PUBLICATION
- Title: ${JSON.stringify(cfg.siteTitle)}
- Niche: ${JSON.stringify(cfg.niche)}
- Description: ${JSON.stringify(cfg.siteDescription)}
- Logo: ${logoUrl ? JSON.stringify(logoUrl) : "(text mark OK)"}

ASSIGNED SHAPE FOR THIS PUBLICATION (mandatory — design inside it, never substitute another):
- Hero: "${heroVariant}" (do not mix other archetypes)
- Palette: "${dna.palette}" — ${paletteDescription(dna.palette)}
- Type voice: "${dna.type}" — ${typeVoiceDescription(dna.type)}
- Homepage rhythm: "${dna.rhythm}" — ${homeRhythmDescription(dna.rhythm)}
- Reading layout: "${dna.reading}" — ${readingLayoutDescription(dna.reading)}
- Cover treatment: "${dna.cover}" — ${coverTreatmentDescription(dna.cover)}
- Headline treatment: "${dna.title}" — ${titleTreatmentDescription(dna.title)}
The palette and type voice are NOT suggestions: two sites from this generator must not be recognisable as siblings. If the assigned palette is light, ship a light site.

${critique ? `PREVIOUS ATTEMPT REJECTED — fix this:\n${critique}\n` : ""}
${tasteBrief ? `TASTE REFERENCES (principles only, never copy layouts):\n${tasteBrief.slice(0, 10000)}\n` : ""}

REAL ARTICLES (use in hero + sample feed cards; server will refresh the full feed):
${JSON.stringify(feedPreview, null, 2)}

CATEGORIES:
${JSON.stringify(cats, null, 2)}

════════════════════════════════════
2) HOMEPAGE
════════════════════════════════════
Compose it however the publication demands — order, rhythm and section count are YOURS. It only must contain:
- <header class="site-header"> with brand + <nav> category links + optional CTA (copied to every page)
- the assigned interactive hero, driven by an inline <script>
- some way into the categories (cards, index, rail, table of contents — your call)
- the article feed (contract in §5)
- a footer with a niche line + category links
- body class: structure-v2 art-directed hero-${heroVariant}
- link href="/assets/style.css" exactly; GEO meta + JSON-LD in <head>
- Mobile-first; no horizontal scroll; real photo covers, not decorative SVG loops
- Only REAL article/category hrefs from the lists above
- IMAGES: use ONLY the "image" URLs from REAL ARTICLES above (and the logo). Unsplash, Pexels, Picsum, placeholder services and any other external host are FORBIDDEN — those pictures are blocked for our readers and the server overwrites them anyway. If an article has no image yet, use a CSS gradient/colour block instead of an <img>.

════════════════════════════════════
3) FEED CONTRACT (short — server paginates)
════════════════════════════════════
- Exactly ONE on the homepage: <div data-seo-article-feed data-page-size="12" class="articles-grid">…up to 12 sample cards…</div>
- Cards ONLY inside it: <a class="article-card" href="…"> with .ac-img-wrap + .ac-title (+ optional .ac-cat)
- Compact equal cards (photo top / title below). No /page/2/ URLs. No empty «Статьи» section.

════════════════════════════════════
4) FULL-SITE CSS
════════════════════════════════════
Define --bg --text --text2 --muted --brand --border --heading-font --body-font --r --w
and style: header, hero, category entries, .articles-grid, .article-card, .ac-*, .seo-feed-pager,
the article reading layout for "${dna.reading}", .article-body typography, .article-header h1/.article-deck/.article-meta,
.breadcrumb (+ .sep/.cur), footer.
These EXACT class names are emitted by the server or by our writers on every article — style all of them or the pages ship broken:
.sidebar .sb-block .sb-head .sb-body .sb-list .sb-num · .related-articles .related-grid .related-card .rc-title .tag ·
.faq-section .faq-item .faq-question .faq-answer · .author-box .author-avatar .author-info .author-name .author-bio ·
.callout .callout-title .callout.offer-native · .stat-grid .stat-card .stat-num .stat-label · .pull-quote ·
.table-scroll table.comparison-table (th/td/.ct-winner) · .pros-cons .pros .cons · .step-box .step-num · .verdict-box · .reading-time
A second pass will ask you for the article and category page markup — the classes you write here are the ones it will use.

OUTPUT — exactly two FILE blocks, nothing else:
--- FILE: assets/style.css ---
\`\`\`css
/* magazine-art-v7 */
...
\`\`\`

--- FILE: index.html ---
\`\`\`html
<!DOCTYPE html>
...
\`\`\`
`;
}

/**
 * Second art-direction pass. Asking for five files in one response truncated the
 * stylesheet, so the page templates and the writer kit are generated separately
 * against the CSS the first pass produced.
 */
export function buildArticleTemplatePrompt(opts: {
  cfg: SeoConfig;
  dna: SeoLayoutDna;
  css: string;
  homeHtml: string;
  critique?: string;
}): string {
  const { cfg, dna, css, homeHtml, critique } = opts;
  const headerSample = homeHtml.match(/<header[\s\S]*?<\/header>/i)?.[0]?.slice(0, 2500) || "";

  return `You are the same art director who just designed this publication. Now build its ARTICLE and CATEGORY pages, plus the component kit its writers must follow.

PUBLICATION: ${JSON.stringify(cfg.siteTitle)} — ${JSON.stringify(cfg.niche)}
ASSIGNED SHAPE (mandatory):
- Reading layout: "${dna.reading}" — ${readingLayoutDescription(dna.reading)}
- Cover treatment: "${dna.cover}" — ${coverTreatmentDescription(dna.cover)}
- Headline treatment: "${dna.title}" — ${titleTreatmentDescription(dna.title)}

${critique ? `PREVIOUS ATTEMPT REJECTED — fix this:\n${critique}\n` : ""}
YOUR STYLESHEET (use these exact class names; you may add new classes only if you also return the extra CSS):
\`\`\`css
${css.slice(0, 14000)}
\`\`\`

YOUR HOMEPAGE MASTHEAD (for visual continuity — the server copies the real one in):
\`\`\`html
${headerSample}
\`\`\`

════════════════════════════════════
1) ARTICLE PAGE — this is where readers actually spend their time
════════════════════════════════════
Return the full <body> markup with these tokens left VERBATIM (the server substitutes them):
  {{HEADER}} {{BREADCRUMB}} {{ARTICLE}} {{SIDEBAR}} {{RELATED}} {{FOOTER}}
- {{ARTICLE}} is the writer's fragment: .article-header (h1 + .article-deck + .article-meta), the cover image, .article-body, .author-box, .faq-section.
- {{SIDEBAR}} renders as <aside class="sidebar">…</aside>. Place it per the assigned reading layout. If that layout has no rail, still leave the token in a sensible spot and style/hide .sidebar accordingly.
- {{RELATED}} is one real related-articles block — place it ONCE at the end of the reading flow.
- Use your own containers and classes. Do NOT ship a generic .article-page + .article-layout sidebar grid unless it genuinely is the assigned layout.
- Keep <body class="…"> — the server merges its own runtime classes into it.
- NEVER put a token inside an HTML comment (\`<!-- … {{ARTICLE}} … -->\`). The server substitutes text literally, so the whole article would end up commented out and invisible. No explanatory comments in the template at all.

════════════════════════════════════
2) CATEGORY PAGE
════════════════════════════════════
Full <body> markup with tokens: {{HEADER}} {{BREADCRUMB}} {{CATEGORY_NAME}} {{CATEGORY_DESCRIPTION}} {{CATEGORY_NUMBER}} {{ARTICLE_COUNT}} {{CARDS}} {{FOOTER}}
- {{CARDS}} is a list of <a class="article-card"> blocks — wrap it in your own grid/list container.
- Give the category header its own identity, not the gradient band every SEO template ships.

════════════════════════════════════
3) WRITER KIT — drives every article on this site
════════════════════════════════════
Mandatory anchors the server depends on (exact class names):
  .article-header > h1 · p.article-deck · .article-meta · .article-body · p.lead (first paragraph) · .author-box · .faq-section with .faq-item/.faq-question/.faq-answer
Everything else is yours. Specify in short bullets (Russian is fine):
- how .article-meta is composed for THIS publication — what facts belong there. Never a generic "⏱ N мин · Обновлено" line unless it truly fits the niche.
- 4–6 in-body components with their EXACT HTML snippet and when to use each. Invent components this niche actually needs (ингредиенты, шаги, врезка эксперта, таблица, предупреждение, цифра, цитата, чек-лист…). Do NOT reuse the generic 💡 Совет / ⚠️ Важно / 📌 Запомните trio.
- whether the lead uses a drop cap, and how often a visual element should appear
- the author box wording style for this publication
Every class named in the kit MUST exist in the CSS — put any new ones in the extra CSS file.

Two server-owned blocks are injected into every article — the kit must NOT redefine them, and your CSS MUST style them so they look native here:
- \`<div class="callout offer-native"><div class="callout-title">…</div><p>… <a>…</a></p></div>\` — the editorial recommendation. Make it read like a staff pick, not a banner.
- \`<div class="table-scroll"><table class="comparison-table"><thead>…</thead><tbody>…</tbody></table></div>\` — used only in comparison-style articles. Style thead, cell padding, row separation and \`.ct-winner\`; it must stay readable at 360px width.
Also style \`.pros-cons\`/\`.pros\`/\`.cons\`, \`.step-box\`/\`.step-num\`, \`.verdict-box\` — the writer uses them for how-to and review formats.
In the kit, tell writers plainly: a comparison table belongs ONLY in articles where the reader is choosing between options, at most one per article.

OUTPUT — exactly four FILE blocks, nothing else:
--- FILE: templates/article.html ---
\`\`\`html
<body class="read-${dna.reading}">
...
</body>
\`\`\`

--- FILE: templates/category.html ---
\`\`\`html
<body>
...
</body>
\`\`\`

--- FILE: templates/writer-kit.md ---
\`\`\`md
...
\`\`\`

--- FILE: assets/extra.css ---
\`\`\`css
/* only the NEW classes used by the templates and the kit */
\`\`\`
`;
}

export type MagazineDesignFiles = {
  css?: string;
  html?: string;
  articleShell?: string;
  categoryShell?: string;
  writerKit?: string;
  extraCss?: string;
};

const ARTICLE_SHELL_TOKENS = ["{{ARTICLE}}", "{{HEADER}}", "{{FOOTER}}"] as const;
const CATEGORY_SHELL_TOKENS = ["{{CARDS}}", "{{HEADER}}", "{{FOOTER}}", "{{CATEGORY_NAME}}"] as const;

/** Tokens the agent parked inside an explanatory comment would render invisible content. */
export function shellTokensInsideComments(shell: string | undefined): string[] {
  if (!shell) return [];
  const buried = new Set<string>();
  for (const comment of shell.match(/<!--[\s\S]*?-->/g) || []) {
    for (const token of comment.match(/\{\{[A-Z_]+\}\}/g) || []) buried.add(token);
  }
  return [...buried];
}

/** A shell we can actually render into — missing tokens mean we fall back to the server skeleton. */
export function isUsableArticleShell(shell: string | undefined): boolean {
  if (!shell || shell.length < 200) return false;
  return ARTICLE_SHELL_TOKENS.every((t) => shell.includes(t));
}

export function isUsableCategoryShell(shell: string | undefined): boolean {
  if (!shell || shell.length < 150) return false;
  return CATEGORY_SHELL_TOKENS.every((t) => shell.includes(t));
}

/** Reject weak / truncated / empty-feed magazine drafts so we retry instead of shipping bland shells. */
export function magazineDesignQualityIssues(
  css: string,
  html: string,
  articleCount: number,
  files?: Pick<MagazineDesignFiles, "articleShell" | "categoryShell" | "writerKit">,
): string[] {
  const issues: string[] = [];
  if (!css || css.length < 2500) issues.push("CSS too short — invent a full magazine system (fonts, header, hero, cards, article pages).");
  if (!html || html.length < 3500) issues.push("HTML too short — complete homepage with hero, topics, and article feed.");
  if (!/<header\b[^>]*\bsite-header\b/i.test(html)) issues.push("Missing <header class=\"site-header\">.");
  if (!/<script\b/i.test(html)) issues.push("Missing inline <script> for interactive hero.");
  if (!/\bdata-seo-article-feed\b/i.test(html)) issues.push("Missing data-seo-article-feed wrapper under the articles heading.");
  if (articleCount > 0) {
    const cards = (html.match(/<a\b[^>]*\barticle-card\b/gi) || []).length;
    if (cards === 0) issues.push("Article feed has zero article-card links — fill sample cards from REAL ARTICLES.");
  }
  if (/Статьи[\s\S]{0,400}<(?:div|section)[^>]*>\s*<\/(?:div|section)>/i.test(html)) {
    issues.push("Empty «Статьи» section — put data-seo-article-feed with cards directly under the heading.");
  }
  // Common bland defaults we keep rejecting
  if (/onest/i.test(css) && /#22d3ee|#06b6d4|cyan/i.test(css)) {
    issues.push("Too generic Onest+cyan look — invent a niche-specific type+palette.");
  }
  if (files) issues.push(...articleTemplateIssues(files));
  return issues;
}

/** Validation for the second art-direction pass (article/category shells + kit). */
export function articleTemplateIssues(files: MagazineDesignFiles): string[] {
  const issues: string[] = [];
  if (!isUsableArticleShell(files.articleShell)) {
    issues.push(
      `templates/article.html missing or incomplete — return the full article <body> containing ${ARTICLE_SHELL_TOKENS.join(" ")} verbatim.`,
    );
  } else if (!files.articleShell!.includes("{{RELATED}}")) {
    issues.push("templates/article.html must place {{RELATED}} once at the end of the reading flow.");
  }
  if (!isUsableCategoryShell(files.categoryShell)) {
    issues.push(
      `templates/category.html missing or incomplete — return the full category <body> containing ${CATEGORY_SHELL_TOKENS.join(" ")} verbatim.`,
    );
  }
  if (!files.writerKit || files.writerKit.length < 400) {
    issues.push("templates/writer-kit.md missing or too short — define the in-body components with exact HTML snippets.");
  }
  for (const [name, shell] of [
    ["templates/article.html", files.articleShell],
    ["templates/category.html", files.categoryShell],
  ] as const) {
    const buried = shellTokensInsideComments(shell);
    if (buried.length) {
      issues.push(
        `${name} places ${buried.join(", ")} inside an HTML comment — the whole page would be commented out. Put tokens in real markup and keep notes out of the template.`,
      );
    }
  }
  return issues;
}

function heroVariantDescription(v: SeoHeroVariant): string {
  switch (v) {
    case "slider-split":
      return `slider-split — Classic premium split: LEFT brand title+description+kicker; RIGHT interactive article cover slider (autoplay, dots, prev/next). Polished magazine chrome.`;
    case "cinematic-cover":
      return `cinematic-cover — Full-bleed living background (deep motion atmosphere). Floating brand block + featured article stage with crossfade covers. Immersive, premium.`;
    case "mosaic-stage":
      return `mosaic-stage — Asymmetric photo mosaic of covers; brand copy anchors the composition; hover/focus expands a tile. Editorial collage energy.`;
    case "newsroom-wire":
      return `newsroom-wire — Dense magazine masthead energy: live strip + large lead cover + stacked side headlines. Fast, authoritative.`;
    case "story-rail":
      return `story-rail — Tall featured story column beside immersive lead art; vertical rail of covers scrolls or snaps.`;
    case "topic-orbit":
      return `topic-orbit — Brand copy + interactive topic chips that swap the featured hero art/story. Playful but serious editorial.`;
    case "magazine-deck":
      return `magazine-deck — Stacked/ overlapping cover deck with tilt or swipe; brand lockup integrated. Collectible magazine feel.`;
    default:
      return String(v);
  }
}

export function parseMagazineDesignFiles(raw: string): MagazineDesignFiles {
  const out: MagazineDesignFiles = {};
  const re =
    /---\s*FILE:\s*([^\n-]+?)\s*---\s*```(?:css|html|HTML|CSS|md|markdown)?\s*([\s\S]*?)```/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw))) {
    const name = m[1].trim().replace(/^\.\//, "");
    const body = m[2].trim();
    if (/extra\.css/i.test(name)) out.extraCss = body;
    else if (/style\.css/i.test(name)) out.css = body;
    else if (/article\.html/i.test(name)) out.articleShell = body;
    else if (/category\.html/i.test(name)) out.categoryShell = body;
    else if (/writer-kit|article-kit/i.test(name)) out.writerKit = body;
    else if (/index\.html/i.test(name)) out.html = body;
  }
  if (!out.css) {
    const cssOnly = raw.match(/```css\s*([\s\S]*?)```/i);
    if (cssOnly) out.css = cssOnly[1].trim();
  }
  if (!out.html) {
    const htmlOnly = raw.match(/```html\s*([\s\S]*?)```/i);
    if (htmlOnly) out.html = htmlOnly[1].trim();
  }
  return out;
}

/**
 * Components the article writer is told to use (tables, steps, pros/cons,
 * verdicts, editorial offer callout). They are server-driven, so every site
 * needs at least a readable default — the agent stylesheet may restyle them.
 *
 * `w` wraps each selector: plain for legacy sites, :where() for v7 sites where
 * the art director's own CSS must always win.
 */
function articleComponentRules(w: (sel: string) => string): string {
  return `
${w(".article-body table")},${w("table.comparison-table")}{width:100%;border-collapse:collapse;margin:1.75rem 0;font-size:.92rem;line-height:1.45;text-align:left}
${w(".article-body table th")},${w("table.comparison-table th")}{padding:.7rem .9rem;font-weight:750;font-size:.82rem;letter-spacing:.01em;background:color-mix(in srgb,var(--brand,currentColor) 16%,transparent);color:var(--text,inherit);border-bottom:2px solid color-mix(in srgb,var(--brand,currentColor) 45%,transparent);vertical-align:bottom}
${w(".article-body table td")},${w("table.comparison-table td")}{padding:.65rem .9rem;border-bottom:1px solid var(--border,rgba(127,127,127,.22));vertical-align:top;color:var(--text2,inherit)}
${w(".article-body table tbody tr:last-child td")},${w("table.comparison-table tbody tr:last-child td")}{border-bottom:0}
${w(".article-body table tbody tr:nth-child(even) td")},${w("table.comparison-table tbody tr:nth-child(even) td")}{background:color-mix(in srgb,var(--text,currentColor) 5%,transparent)}
${w(".article-body table td:first-child")},${w("table.comparison-table td:first-child")}{font-weight:700;color:var(--text,inherit)}
${w("table .ct-winner")},${w(".comparison-table .ct-winner")}{color:var(--brand,inherit);font-weight:750}
${w(".table-scroll")}{overflow-x:auto;-webkit-overflow-scrolling:touch;margin:1.75rem 0;border:1px solid var(--border,rgba(127,127,127,.22));border-radius:var(--r,12px)}
${w(".table-scroll table")}{margin:0;min-width:34rem}
${w(".pros-cons")}{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:.9rem;margin:1.5rem 0}
${w(".pros")},${w(".cons")}{padding:1rem 1.1rem;border-radius:var(--r,12px);border:1px solid var(--border,rgba(127,127,127,.22))}
${w(".pros")}{background:color-mix(in srgb,#16a34a 9%,transparent)}
${w(".cons")}{background:color-mix(in srgb,#dc2626 9%,transparent)}
${w(".pros h4")},${w(".cons h4")}{margin:0 0 .5rem;font-size:.76rem;font-weight:800;letter-spacing:.07em;text-transform:uppercase}
${w(".pros ul")},${w(".cons ul")}{margin:0;padding-left:1.1rem}
${w(".step-box")}{display:flex;gap:.9rem;align-items:flex-start;margin:1.1rem 0;padding:1rem 1.1rem;border-radius:var(--r,12px);border:1px solid var(--border,rgba(127,127,127,.22))}
${w(".step-num")}{flex:0 0 auto;width:2rem;height:2rem;border-radius:50%;display:flex;align-items:center;justify-content:center;background:var(--brand,currentColor);color:#fff;font-weight:800}
${w(".step-content h3")}{margin:0 0 .35rem}
${w(".verdict-box")}{margin:1.75rem 0;padding:1.2rem 1.3rem;border-radius:var(--r,14px);border:1px solid color-mix(in srgb,var(--brand,currentColor) 35%,transparent);background:color-mix(in srgb,var(--brand,currentColor) 10%,transparent)}
${w(".verdict-box h3")}{margin:0 0 .5rem;font-size:.78rem;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:var(--brand,inherit)}
${w(".article-photo")}{margin:1.7rem 0}
${w(".article-photo img")}{width:100%;border-radius:var(--r,14px);display:block}
@media(max-width:640px){
  ${w(".article-body table")},${w("table.comparison-table")}{font-size:.82rem}
  ${w(".article-body table th")},${w(".article-body table td")}{padding:.5rem .55rem}
  ${w(".pros-cons")}{grid-template-columns:1fr}
  ${w(".step-box")}{flex-direction:column;gap:.6rem}
}
`;
}

/** Safety net: unique chrome stays agent-owned; articles/menu/offer always look finished. */
export function buildSoftMagazineGuardCss(): string {
  return `
/* structural-guard-v15 — article magazine kit + compact feed + agent-written native offer */
html,body{overflow-x:hidden!important;max-width:100%!important}
img,video,canvas,svg{max-width:100%;height:auto}
.cta-block{display:none!important}
.on-media{color:#fff!important;text-shadow:0 1px 2px rgba(0,0,0,.45)}

/* Adaptive masthead — layout only, colors/fonts stay with the art director */
.site-header,header.site-header{
  position:sticky;top:0;z-index:80;width:100%;box-sizing:border-box;
  display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;
  gap:.65rem 1.15rem;padding:.75rem clamp(.9rem,3vw,2.1rem);
  background:color-mix(in srgb,var(--bg,canvas) 86%,transparent);
  backdrop-filter:saturate(1.2) blur(14px);-webkit-backdrop-filter:saturate(1.2) blur(14px);
  border-bottom:1px solid var(--border,rgba(127,127,127,.16));
}
.site-header nav,.site-header .nav-links{
  display:flex;flex-wrap:wrap;align-items:center;gap:.35rem .85rem;max-width:100%;
}
.site-header a{color:inherit;text-decoration:none}
.site-header nav a,.site-header .nav-links a{
  font-size:clamp(.78rem,.72rem + .25vw,.92rem);font-weight:650;opacity:.86;white-space:nowrap;
}
.site-header nav a:hover,.site-header .nav-links a:hover{opacity:1}

/* Article page — guaranteed magazine reading layout */
.article-page{max-width:var(--w,1120px);margin:0 auto;padding:0 1.25rem 4.5rem;box-sizing:border-box}
.article-layout{display:grid;grid-template-columns:minmax(0,1fr) minmax(210px,280px);gap:clamp(1.25rem,3vw,2.4rem);align-items:start;margin-top:.5rem}
.article-layout-sidebar-left{grid-template-columns:minmax(210px,280px) minmax(0,1fr)}
.article-layout-single,.article-layout-full{grid-template-columns:minmax(0,1fr)}
.article-main{min-width:0}
.breadcrumb{display:flex;flex-wrap:wrap;gap:.35rem;align-items:center;padding:.85rem 0 .35rem;font-size:.78rem;color:var(--muted,var(--text2,#666))}
.breadcrumb a{color:inherit;text-decoration:none;opacity:.8}
.breadcrumb a:hover{opacity:1;color:var(--brand,currentColor)}
.breadcrumb .sep{opacity:.4}
.article-header{max-width:46rem;margin:0 0 1.1rem}
.article-header h1{font-family:var(--heading-font,inherit);font-size:clamp(1.85rem,1.3rem + 2.2vw,3.15rem);font-weight:850;letter-spacing:-.04em;line-height:1.08;text-wrap:balance;margin:0 0 .75rem}
.article-deck{max-width:42rem;font-size:clamp(1.02rem,.95rem + .3vw,1.22rem);line-height:1.55;color:var(--text2,inherit);opacity:.92;margin:0 0 1rem}
.article-meta{display:flex;flex-wrap:wrap;gap:.5rem .85rem;align-items:center;font-size:.76rem;color:var(--muted,#777);margin:0 0 1.25rem}
.article-meta .tag{display:inline-flex;padding:.18rem .55rem;border-radius:999px;background:var(--brand,currentColor);color:#fff;font-size:.62rem;font-weight:800;letter-spacing:.06em;text-transform:uppercase}
.hero-article-img,.article-body img,.article-img{width:100%;max-height:min(520px,58vw);object-fit:cover;display:block;border-radius:var(--r,14px);margin:0 0 1.35rem}
.hero-cover-fallback{width:100%;height:min(340px,52vw);border-radius:var(--r,14px);margin:0 0 1.35rem}
.article-body{max-width:70ch;font-family:var(--body-font,inherit);font-size:clamp(1.05rem,1rem + .18vw,1.18rem);line-height:1.78}
.article-body h2{font-family:var(--heading-font,inherit);font-size:clamp(1.35rem,1.15rem + .7vw,1.85rem);font-weight:800;letter-spacing:-.03em;line-height:1.2;margin:2.75rem 0 .9rem;padding-top:.55rem;border-top:1px solid var(--border,rgba(127,127,127,.18));scroll-margin-top:88px}
.article-body h3{font-family:var(--heading-font,inherit);font-size:clamp(1.12rem,1.05rem + .3vw,1.32rem);font-weight:750;margin:1.8rem 0 .6rem}
.article-body p{margin:0 0 1.2rem;color:var(--text2,inherit)}
.article-body .lead{font-size:1.12em;line-height:1.62;color:var(--text,inherit);font-weight:550}
.article-body .lead::first-letter{float:left;font-family:var(--heading-font,inherit);font-size:3.05rem;line-height:.78;font-weight:800;color:var(--brand,currentColor);margin:.1rem .55rem 0 0}
.article-body ul,.article-body ol{margin:.4rem 0 1.4rem;padding-left:1.35rem;color:var(--text2,inherit)}
.article-body li{margin:0 0 .45rem}
.article-body a{color:var(--brand,inherit);text-decoration:underline;text-underline-offset:.16em}
.article-body figure{margin:1.6rem 0}
.pull-quote,blockquote.pull-quote,.article-body blockquote{
  margin:1.6rem 0;padding:.15rem 0 .15rem 1.15rem;border-left:4px solid var(--brand,currentColor);
  font-size:1.18rem;line-height:1.5;font-weight:700;font-style:normal;color:var(--text,inherit)
}
.callout{margin:1.35rem 0;padding:1rem 1.15rem;border-radius:var(--r,12px);border:1px solid color-mix(in srgb,var(--brand,currentColor) 22%,var(--border,rgba(127,127,127,.25)));background:color-mix(in srgb,var(--brand,currentColor) 8%,transparent)}
.callout-title{font-size:.72rem;font-weight:800;letter-spacing:.08em;text-transform:uppercase;margin:0 0 .35rem;color:var(--brand,inherit)}
.callout.offer-native{margin:1.45rem 0;padding:1.05rem 1.2rem}
.callout.offer-native p{margin:0;line-height:1.65;color:var(--text2,inherit)}
.callout.offer-native a{font-weight:750;color:var(--brand,inherit)}
.stat-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(132px,1fr));gap:.75rem;margin:1.4rem 0}
.stat-card{padding:1rem .85rem;text-align:center;border-radius:var(--r,12px);border:1px solid var(--border,rgba(127,127,127,.2));background:color-mix(in srgb,var(--bg2,var(--bg,transparent)) 88%,transparent)}
.stat-num{font-family:var(--heading-font,inherit);font-size:1.65rem;font-weight:850;color:var(--brand,inherit);line-height:1}
.stat-label{font-size:.76rem;margin-top:.35rem;color:var(--text2,inherit)}
.key-takeaways,.toc,nav.toc{
  margin:1.25rem 0 1.5rem;padding:1.05rem 1.2rem;border-radius:var(--r,14px);
  border:1px solid color-mix(in srgb,var(--brand,currentColor) 22%,var(--border,rgba(127,127,127,.22)));
  background:color-mix(in srgb,var(--brand,currentColor) 7%,var(--bg,transparent));
}
.key-takeaways h3,.toc-title,.toc>p:first-child{
  margin:0 0 .65rem;font-size:.72rem;font-weight:800;letter-spacing:.1em;text-transform:uppercase;color:var(--brand,inherit)
}
.key-takeaways ul,.toc ol,.toc ul,ul.key-takeaways,ol.key-takeaways,ul.toc,ol.toc{margin:0;padding-left:1.15rem}
.key-takeaways li,.toc li{margin:0 0 .38rem;font-size:.95rem;line-height:1.5}
.article-main > h2 + ul,.article-main > h3 + ul,.article-main > h2 + ol,.article-main > h3 + ol,.article-header + ul{
  margin:1.25rem 0 1.5rem;padding:1.05rem 1.2rem 1.05rem 2.15rem;border-radius:var(--r,14px);
  border:1px solid color-mix(in srgb,var(--brand,currentColor) 22%,var(--border,rgba(127,127,127,.22)));
  background:color-mix(in srgb,var(--brand,currentColor) 7%,var(--bg,transparent));
}
.author-box{display:flex;gap:.85rem;align-items:flex-start;margin:2rem 0 1.25rem;padding:1rem 1.1rem;border:1px solid var(--border,rgba(127,127,127,.2));border-radius:var(--r,14px)}
.author-avatar{width:2.4rem;height:2.4rem;border-radius:50%;display:flex;align-items:center;justify-content:center;background:var(--brand,currentColor);color:#fff;font-weight:800}
.faq-section{margin:2.1rem 0 1.5rem;padding-top:1.5rem;border-top:2px solid var(--brand,currentColor)}
.faq-section>h2{font-family:var(--heading-font,inherit);font-size:1.2rem;margin:0 0 1rem}
.faq-item{border:1px solid var(--border,rgba(127,127,127,.2));border-radius:var(--r,12px);margin:0 0 .45rem;overflow:hidden}
.faq-question{display:flex;justify-content:space-between;gap:.75rem;padding:.8rem 1rem;font-weight:700;cursor:pointer}
.faq-answer{display:none;padding:.15rem 1rem 1rem;color:var(--text2,inherit);line-height:1.65}
.related-articles{margin:2.2rem 0 1rem;padding-top:1.5rem;border-top:1px solid var(--border,rgba(127,127,127,.2))}
.related-articles>h2{font-family:var(--heading-font,inherit);font-size:1.05rem;margin:0 0 .85rem}
.related-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:.7rem}
.related-card{display:block;padding:.85rem;border:1px solid var(--border,rgba(127,127,127,.2));border-radius:var(--r,12px);text-decoration:none;color:inherit;background:color-mix(in srgb,var(--bg2,var(--bg,transparent)) 90%,transparent)}
.related-card:hover{border-color:var(--brand,currentColor)}
.related-card .tag,.related-card .rc-cat{display:block;font-size:.62rem;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:var(--brand,inherit);margin:0 0 .3rem}
.related-card .rc-title,h3.rc-title{font-size:.86rem;line-height:1.35;margin:0;font-weight:700}
.sidebar{position:sticky;top:5.2rem}
.sb-block{margin:0 0 1.15rem;border:1px solid var(--border,rgba(127,127,127,.2));border-radius:var(--r,14px);overflow:hidden}
.sb-head{padding:.55rem .9rem;font-size:.68rem;font-weight:800;letter-spacing:.08em;text-transform:uppercase;background:color-mix(in srgb,var(--brand,currentColor) 12%,transparent)}
.sb-body{padding:.7rem .9rem}
.sb-list{list-style:none;margin:0;padding:0}
.sb-list li{padding:.4rem 0;border-bottom:1px solid var(--border,rgba(127,127,127,.14));font-size:.82rem}
.sb-list li:last-child{border-bottom:0}
.sb-list a{color:inherit;text-decoration:none}
.sb-list a:hover{color:var(--brand,inherit)}
.sb-num{font-size:.62rem;font-weight:800;color:var(--brand,inherit)}
.reading-progress{position:fixed;left:0;top:0;z-index:90;height:3px;width:0;background:var(--brand,currentColor)}
footer{padding:2.2rem clamp(.9rem,3vw,2.1rem) 2.6rem;margin-top:2rem;border-top:1px solid var(--border,rgba(127,127,127,.16))}
.footer-inner{display:grid;grid-template-columns:minmax(0,1.4fr) repeat(2,minmax(0,1fr));gap:1.4rem;max-width:var(--w,1120px);margin:0 auto}
.footer-inner a{color:inherit;text-decoration:none}
.footer-inner ul{list-style:none;margin:.4rem 0 0;padding:0}
.footer-inner li{margin:.28rem 0}
.article-also{font-size:.95em;padding:.85rem 1rem;border-left:3px solid var(--brand,currentColor);background:color-mix(in srgb,var(--brand,currentColor) 7%,transparent);border-radius:0 var(--r,10px) var(--r,10px) 0}

/* Home feed: always 4 compact photo+title cards per row (12/page) */
[data-seo-article-feed]{
  display:grid!important;
  grid-template-columns:repeat(4,minmax(0,1fr))!important;
  gap:clamp(.85rem,1.5vw,1.15rem)!important;
  margin:0 0 1rem!important;
  align-items:stretch!important;
}
[data-seo-article-feed]>.article-card,
[data-seo-article-feed]>a.article-card{
  grid-column:auto!important;
  grid-row:auto!important;
  width:100%!important;
  max-width:none!important;
  display:flex!important;
  flex-direction:column!important;
  text-decoration:none!important;
  color:inherit!important;
  overflow:hidden!important;
  min-height:0!important;
  height:auto!important;
}
[data-seo-article-feed] .ac-img-wrap{
  position:relative!important;
  width:100%!important;
  height:auto!important;
  min-height:0!important;
  aspect-ratio:16/10!important;
  overflow:hidden!important;
  background:rgba(0,0,0,.25)!important;
  flex:0 0 auto!important;
}
[data-seo-article-feed] .ac-img-wrap img,
[data-seo-article-feed] .ac-img-grad{
  width:100%!important;height:100%!important;object-fit:cover!important;display:block!important;
}
[data-seo-article-feed] .ac-body,
[data-seo-article-feed] .ac-content{padding:.7rem .8rem .85rem!important;flex:1 1 auto!important}
[data-seo-article-feed] .ac-cat{display:block!important;font-size:.62rem!important;font-weight:800!important;letter-spacing:.06em!important;text-transform:uppercase!important;opacity:.75!important;margin:0 0 .3rem!important}
[data-seo-article-feed] .ac-title{font-family:var(--heading-font,inherit)!important;font-size:clamp(.82rem,.7rem + .35vw,.98rem)!important;font-weight:750!important;line-height:1.3!important;margin:0!important;display:-webkit-box!important;-webkit-line-clamp:3!important;-webkit-box-orient:vertical!important;overflow:hidden!important}
/* Pager hides cards with [hidden] — author display rules above would defeat it */
[data-seo-article-feed]>[hidden],[data-seo-article-feed] .article-card[hidden]{display:none!important}
${articleComponentRules((sel) => sel)}

/* Native referral offer — always visible at article start */
.ref-offer{display:block!important;position:relative!important;margin:1.5rem 0 1.75rem!important;border-radius:calc(var(--r,14px) + 4px)!important;overflow:hidden!important;border:1px solid color-mix(in srgb,var(--brand,currentColor) 32%,var(--border,rgba(127,127,127,.35)))!important;background:linear-gradient(160deg,color-mix(in srgb,var(--brand,currentColor) 12%,var(--bg,transparent)) 0%,var(--bg,transparent) 55%)!important}
.ref-offer-glow{position:absolute!important;inset:-40% auto auto -25%!important;width:70%!important;height:90%!important;background:radial-gradient(circle,color-mix(in srgb,var(--brand,currentColor) 28%,transparent),transparent 70%)!important;pointer-events:none!important;filter:blur(10px)!important}
.ref-offer-inner{position:relative!important;z-index:1!important;display:grid!important;grid-template-columns:minmax(0,1fr) auto!important;gap:1.1rem!important;align-items:center!important;padding:clamp(1rem,2vw,1.45rem) clamp(1rem,2vw,1.5rem)!important}
.ref-offer-copy{min-width:0!important;display:grid!important;gap:.4rem!important}
.ref-offer-eyebrow{display:inline-flex!important;align-self:flex-start!important;font-size:.68rem!important;font-weight:800!important;letter-spacing:.1em!important;text-transform:uppercase!important;opacity:.9!important}
.ref-offer-title{font-family:var(--heading-font,inherit)!important;font-size:clamp(1.05rem,1rem + .45vw,1.35rem)!important;font-weight:800!important;line-height:1.25!important;color:var(--text,inherit)!important}
.ref-offer-desc{margin:0!important;font-size:.92rem!important;line-height:1.5!important;color:var(--text2,inherit)!important;opacity:.9!important}
.ref-offer-note{font-size:.7rem!important;opacity:.65!important}
.ref-offer-btn{position:relative!important;isolation:isolate!important;display:inline-flex!important;align-items:center!important;justify-content:center!important;min-height:48px!important;padding:.85rem 1.35rem!important;border-radius:999px!important;text-decoration:none!important;font-weight:800!important;font-size:.9rem!important;white-space:nowrap!important;color:#fff!important;background:var(--brand,#2563eb)!important;box-shadow:0 10px 24px color-mix(in srgb,var(--brand,#2563eb) 35%,transparent)!important}
.ref-offer-btn-label{position:relative!important;z-index:2!important;color:#fff!important}
.ref-offer-btn-shine{position:absolute!important;inset:0!important;z-index:1!important;background:linear-gradient(110deg,transparent 20%,rgba(255,255,255,.45) 48%,transparent 72%)!important;transform:translateX(-130%)!important;animation:refBtnShine 2.6s ease-in-out infinite!important}
.offer-inline-tip{margin:0.85rem 0 1.1rem!important;padding:0.75rem 1rem!important;border-left:3px solid var(--brand,currentColor)!important;background:color-mix(in srgb,var(--brand,currentColor) 8%,transparent)!important;border-radius:0 var(--r,10px) var(--r,10px) 0!important;font-size:0.95em!important;line-height:1.55!important}
.offer-inline-tip a{font-weight:700!important;text-decoration:underline!important;text-underline-offset:2px!important}
@keyframes refBtnShine{0%{transform:translateX(-130%)}55%,100%{transform:translateX(130%)}}
.seo-feed-pager{display:flex;align-items:center;justify-content:center;gap:.65rem;flex-wrap:wrap;margin:1.25rem 0 2.5rem;font-family:var(--heading-font,inherit)}
.seo-feed-pager[hidden]{display:none!important}
.seo-feed-pager button{appearance:none;border:1px solid var(--border,currentColor);background:transparent;color:inherit;font:inherit;font-weight:700;padding:.55rem .9rem;border-radius:999px;cursor:pointer;opacity:.9}
.seo-feed-pager button:disabled{opacity:.35;cursor:default}
.seo-feed-pager span{font-size:.85rem;font-weight:700;letter-spacing:.04em;opacity:.75}
@media(max-width:1024px){[data-seo-article-feed]{grid-template-columns:repeat(3,minmax(0,1fr))!important}}
@media(max-width:720px){
  [data-seo-article-feed]{grid-template-columns:repeat(2,minmax(0,1fr))!important}
  .ref-offer-inner{grid-template-columns:1fr!important}
  .ref-offer-btn{width:100%!important}
  .article-layout,.article-layout-sidebar-left{grid-template-columns:1fr}
  .sidebar{position:static}
  .site-header nav,.site-header .nav-links{width:100%;flex-wrap:nowrap;overflow-x:auto;-webkit-overflow-scrolling:touch;padding-bottom:.2rem}
  .footer-inner{grid-template-columns:1fr}
  .article-body .lead::first-letter{font-size:2.5rem}
}
@media(max-width:420px){[data-seo-article-feed]{grid-template-columns:1fr!important}}
`;
}

/**
 * Guard for v7 sites where the art director owns the article/category shells.
 * Every cosmetic rule sits in :where() so its specificity is 0 — the agent's
 * own stylesheet always wins, and this only keeps unstyled server blocks
 * (offer, related, FAQ, feed) from looking broken.
 */
export function buildArticleShellGuardCss(): string {
  return `
/* structural-guard-v15-shell — safety only; layout belongs to the art director */
html,body{overflow-x:hidden!important;max-width:100%!important}
img,video,canvas,svg{max-width:100%;height:auto}
.cta-block{display:none!important}
:where(.on-media){color:#fff;text-shadow:0 1px 2px rgba(0,0,0,.45)}
:where(.site-header) a{color:inherit;text-decoration:none}

/* Server-generated blocks — neutral fallbacks, zero specificity */
:where(.article-body) img,:where(.article-img),:where(.hero-article-img){display:block;width:100%;border-radius:var(--r,14px)}
:where(.hero-cover-fallback){width:100%;height:min(340px,52vw);border-radius:var(--r,14px)}
:where(.breadcrumb){display:flex;flex-wrap:wrap;gap:.35rem;align-items:center;font-size:.78rem;opacity:.75}
:where(.breadcrumb) a{color:inherit;text-decoration:none}
:where(.sidebar) .sb-list{list-style:none;margin:0;padding:0}
:where(.sidebar) .sb-list a{color:inherit;text-decoration:none}
:where(.related-articles){margin:2.2rem 0 1rem}
:where(.related-grid){display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:.7rem}
:where(.related-card){display:block;padding:.85rem;border:1px solid var(--border,rgba(127,127,127,.2));border-radius:var(--r,12px);text-decoration:none;color:inherit}
:where(.faq-answer){display:none}
:where(.faq-question){cursor:pointer;display:flex;justify-content:space-between;gap:.75rem}
:where(.author-box){display:flex;gap:.85rem;align-items:flex-start;margin:2rem 0 1.25rem}
:where(.author-avatar){width:2.4rem;height:2.4rem;border-radius:50%;display:flex;align-items:center;justify-content:center;background:var(--brand,currentColor);color:#fff;font-weight:800;flex:0 0 auto}
:where(.reading-progress){position:fixed;left:0;top:0;z-index:90;height:3px;width:0;background:var(--brand,currentColor)}

/* Home feed — server paginates 12 per page; the agent may restyle freely */
:where([data-seo-article-feed]){display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:clamp(.85rem,1.5vw,1.15rem);align-items:stretch}
:where([data-seo-article-feed]>.article-card){display:flex;flex-direction:column;text-decoration:none;color:inherit;overflow:hidden}
:where([data-seo-article-feed] .ac-img-wrap){position:relative;width:100%;aspect-ratio:16/10;overflow:hidden;background:rgba(0,0,0,.2)}
:where([data-seo-article-feed] .ac-img-wrap img),:where([data-seo-article-feed] .ac-img-grad){width:100%;height:100%;object-fit:cover;display:block}
:where([data-seo-article-feed] .ac-body),:where([data-seo-article-feed] .ac-content){padding:.7rem .8rem .85rem;flex:1 1 auto}
:where([data-seo-article-feed] .ac-title){font-family:var(--heading-font,inherit);font-size:clamp(.82rem,.7rem + .35vw,.98rem);font-weight:750;line-height:1.3;margin:0;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
/* Pager hides cards with [hidden] — author display rules above would defeat it */
[data-seo-article-feed]>[hidden],[data-seo-article-feed] .article-card[hidden]{display:none!important}
.seo-feed-pager{display:flex;align-items:center;justify-content:center;gap:.65rem;flex-wrap:wrap;margin:1.25rem 0 2.5rem;font-family:var(--heading-font,inherit)}
.seo-feed-pager[hidden]{display:none!important}
.seo-feed-pager button{appearance:none;border:1px solid var(--border,currentColor);background:transparent;color:inherit;font:inherit;font-weight:700;padding:.55rem .9rem;border-radius:999px;cursor:pointer;opacity:.9}
.seo-feed-pager button:disabled{opacity:.35;cursor:default}

/* Native referral offer — server-injected, must stay readable on any theme */
:where(.offer-inline-tip){margin:.85rem 0 1.1rem;padding:.75rem 1rem;border-left:3px solid var(--brand,currentColor);background:color-mix(in srgb,var(--brand,currentColor) 8%,transparent);border-radius:0 var(--r,10px) var(--r,10px) 0;line-height:1.55}
:where(.offer-inline-tip) a{font-weight:700;text-decoration:underline;text-underline-offset:2px}
:where(.ref-offer){display:block;position:relative;margin:1.5rem 0 1.75rem;border-radius:calc(var(--r,14px) + 4px);overflow:hidden;border:1px solid color-mix(in srgb,var(--brand,currentColor) 32%,var(--border,rgba(127,127,127,.35)))}
:where(.ref-offer-inner){display:grid;grid-template-columns:minmax(0,1fr) auto;gap:1.1rem;align-items:center;padding:clamp(1rem,2vw,1.45rem)}
:where(.ref-offer-btn){display:inline-flex;align-items:center;justify-content:center;min-height:48px;padding:.85rem 1.35rem;border-radius:999px;text-decoration:none;font-weight:800;white-space:nowrap;color:#fff;background:var(--brand,#2563eb)}
/* The editorial recommendation is server-materialised — never leave it bare text */
:where(.callout){margin:1.35rem 0;padding:1rem 1.15rem;border-radius:var(--r,12px);border:1px solid color-mix(in srgb,var(--brand,currentColor) 22%,var(--border,rgba(127,127,127,.25)));background:color-mix(in srgb,var(--brand,currentColor) 8%,transparent)}
:where(.callout-title){font-size:.72rem;font-weight:800;letter-spacing:.08em;text-transform:uppercase;margin:0 0 .35rem;color:var(--brand,inherit)}
:where(.callout.offer-native) p{margin:0;line-height:1.65}
:where(.callout.offer-native) a{font-weight:750;color:var(--brand,inherit);text-decoration:underline;text-underline-offset:.16em}

/* Blocks the server or the writer emits by contract. The art director does not
   always style them, and an unstyled sidebar or stat grid ruins the page. */
:where(.tag){display:inline-flex;padding:.18rem .55rem;border-radius:999px;background:color-mix(in srgb,var(--brand,currentColor) 16%,transparent);color:var(--brand,inherit);font-size:.62rem;font-weight:800;letter-spacing:.06em;text-transform:uppercase}
:where(.reading-time),:where(.article-meta) span{font-size:.76rem;opacity:.75}
:where(.breadcrumb) .sep{opacity:.4;padding:0 .1rem}
:where(.breadcrumb) .cur{opacity:.65}
:where(.stat-grid){display:grid;grid-template-columns:repeat(auto-fit,minmax(132px,1fr));gap:.75rem;margin:1.4rem 0}
:where(.stat-card){padding:1rem .85rem;text-align:center;border-radius:var(--r,12px);border:1px solid var(--border,rgba(127,127,127,.2))}
:where(.stat-num){font-family:var(--heading-font,inherit);font-size:1.65rem;font-weight:850;line-height:1;color:var(--brand,inherit)}
:where(.stat-label){display:block;font-size:.76rem;margin-top:.35rem;opacity:.8}
:where(.pull-quote),:where(.article-body) blockquote{margin:1.6rem 0;padding:.15rem 0 .15rem 1.15rem;border-left:4px solid var(--brand,currentColor);font-size:1.18rem;line-height:1.5;font-weight:700;font-style:normal}
:where(.key-takeaways),:where(.toc){margin:1.25rem 0 1.5rem;padding:1.05rem 1.2rem;border-radius:var(--r,14px);border:1px solid var(--border,rgba(127,127,127,.22))}
:where(.sidebar){display:block}
:where(.sb-block){margin:0 0 1.15rem;border:1px solid var(--border,rgba(127,127,127,.2));border-radius:var(--r,14px);overflow:hidden}
:where(.sb-head){padding:.55rem .9rem;font-size:.68rem;font-weight:800;letter-spacing:.08em;text-transform:uppercase;background:color-mix(in srgb,var(--brand,currentColor) 12%,transparent)}
:where(.sb-body){padding:.7rem .9rem}
:where(.sb-list) li{padding:.4rem 0;border-bottom:1px solid var(--border,rgba(127,127,127,.14));font-size:.82rem;line-height:1.4}
:where(.sb-list) li:last-child{border-bottom:0}
:where(.sb-num){font-size:.62rem;font-weight:800;color:var(--brand,inherit);margin-right:.35rem}
:where(.related-card) .rc-title,:where(h3.rc-title){font-size:.86rem;line-height:1.35;margin:.3rem 0 0;font-weight:700}
:where(.faq-item){border:1px solid var(--border,rgba(127,127,127,.2));border-radius:var(--r,12px);margin:0 0 .45rem;overflow:hidden}
:where(.faq-item) .faq-question{padding:.8rem 1rem;font-weight:700}
:where(.faq-item) .faq-answer{padding:.15rem 1rem 1rem;line-height:1.65}
:where(.author-info) .author-name{font-weight:750}
:where(.author-info) .author-bio{font-size:.82rem;opacity:.75;line-height:1.5}
${articleComponentRules((sel) => `:where(${sel})`)}
@media(max-width:1024px){:where([data-seo-article-feed]){grid-template-columns:repeat(3,minmax(0,1fr))}}
@media(max-width:720px){
  :where([data-seo-article-feed]){grid-template-columns:repeat(2,minmax(0,1fr))}
  :where(.ref-offer-inner){grid-template-columns:1fr}
  :where(.sidebar){position:static}
  .site-header nav,.site-header .nav-links{max-width:100%;overflow-x:auto;-webkit-overflow-scrolling:touch}
}
@media(max-width:420px){:where([data-seo-article-feed]){grid-template-columns:1fr}}
`;
}

export function ensureSoftMagazineGuardCss(css: string, opts?: { shellOwned?: boolean }): string {
  const guard = opts?.shellOwned ? buildArticleShellGuardCss() : buildSoftMagazineGuardCss();
  if (!css) return guard;
  const stripped = css.replace(/\n?\/\*\s*structural-guard(?:-v\d+)?[\s\S]*$/i, "").trim();
  return `${stripped}\n${guard}`;
}

export function applyHeroVariantToTheme(theme: SeoTheme | undefined, hero: SeoHeroVariant): SeoTheme {
  const base = theme || ({} as SeoTheme);
  return {
    ...base,
    artDirected: true,
    homeVariant: hero as SeoTheme["homeVariant"],
    designBrief:
      base.designBrief ||
      `Agent-directed ${hero} magazine hero with niche-specific typography, living background and interactive covers.`,
  };
}

export function refreshArticleFeedHtml(articles: SeoArticleBrief[]): string {
  return articles
    .map(
      (a, i) => `<a href="${escapeHtml(a.href)}" class="article-card article-card--compact">
  <div class="ac-img-wrap">${
    a.image
      ? `<img src="${escapeHtml(a.image)}" alt="${escapeHtml(a.title)}" loading="lazy" width="480" height="300">`
      : `<div class="ac-img-grad" style="background:linear-gradient(135deg,hsl(${(i * 47) % 360} 55% 42%),hsl(${(i * 47 + 40) % 360} 50% 28%));width:100%;height:100%"></div>`
  }</div>
  <div class="ac-body">
    <span class="ac-cat">${escapeHtml(a.cluster)}</span>
    <div class="ac-title">${escapeHtml(a.title)}</div>
  </div>
</a>`,
    )
    .join("\n");
}

function escapeHtml(s: string): string {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Find start index of the matching close tag for an element that opened ending at openTagEnd. */
export function findMatchingTagClose(html: string, openTagEnd: number, tagName: string): number {
  const tag = String(tagName || "div").toLowerCase().replace(/[^a-z0-9:-]/g, "") || "div";
  const openPrefix = `<${tag}`;
  const closeRe = new RegExp(`^</\\s*${tag}\\s*>`, "i");
  let depth = 1;
  let i = openTagEnd;
  while (i < html.length) {
    const nextLt = html.indexOf("<", i);
    if (nextLt < 0) return -1;
    const rest = html.slice(nextLt);
    if (closeRe.test(rest)) {
      depth -= 1;
      if (depth === 0) return nextLt;
      const gt = html.indexOf(">", nextLt);
      i = gt < 0 ? html.length : gt + 1;
      continue;
    }
    // Opening same tag (not comment / close / self-ish)
    if (rest.length >= openPrefix.length && rest.slice(0, openPrefix.length).toLowerCase() === openPrefix) {
      const next = rest[openPrefix.length];
      if (next === undefined || /[\s>/]/.test(next)) {
        depth += 1;
        const gt = html.indexOf(">", nextLt);
        i = gt < 0 ? html.length : gt + 1;
        continue;
      }
    }
    i = nextLt + 1;
  }
  return -1;
}

/** @deprecated use findMatchingTagClose — kept for callers */
export function findMatchingDivClose(html: string, openTagEnd: number): number {
  return findMatchingTagClose(html, openTagEnd, "div");
}

type FeedOpenMatch = {
  full: string;
  tag: string;
  index: number;
  openEnd: number;
};

function matchSeoArticleFeedOpen(homeHtml: string): FeedOpenMatch | null {
  // Any element with data-seo-article-feed (div/section/main/…)
  const openRe = /<([a-zA-Z][\w:-]*)\b([^>]*\bdata-seo-article-feed\b[^>]*)>/i;
  const m = openRe.exec(homeHtml);
  if (!m) return null;
  return {
    full: m[0],
    tag: m[1],
    index: m.index,
    openEnd: m.index + m[0].length,
  };
}

/** Replace inner HTML of the first data-seo-article-feed wrapper (handles nested tags). */
export function replaceSeoArticleFeedInner(homeHtml: string, newInner: string): string | null {
  if (!homeHtml) return null;
  const open = matchSeoArticleFeedOpen(homeHtml);
  if (!open) return null;
  const closeStart = findMatchingTagClose(homeHtml, open.openEnd, open.tag);
  if (closeStart < 0) return null;
  return `${homeHtml.slice(0, open.openEnd)}\n${newInner}\n${homeHtml.slice(closeStart)}`;
}

/** Extract full outer HTML of the first data-seo-article-feed block. */
export function extractSeoArticleFeedBlock(homeHtml: string): { block: string; start: number; end: number } | null {
  const open = matchSeoArticleFeedOpen(homeHtml);
  if (!open) return null;
  const closeStart = findMatchingTagClose(homeHtml, open.openEnd, open.tag);
  if (closeStart < 0) return null;
  const closeMatch = homeHtml.slice(closeStart).match(new RegExp(`^</\\s*${open.tag}\\s*>`, "i"));
  if (!closeMatch) return null;
  const end = closeStart + closeMatch[0].length;
  return { block: homeHtml.slice(open.index, end), start: open.index, end };
}

/** Remove duplicate article-card dumps outside the single data-seo-article-feed region. */
export function stripOrphanHomeArticleCards(homeHtml: string): string {
  if (!homeHtml) return homeHtml;
  const extracted = extractSeoArticleFeedBlock(homeHtml);
  let html = homeHtml;
  const slot = "<!--SEO_FEED_SLOT_0-->";
  if (extracted) {
    html = homeHtml.slice(0, extracted.start) + slot + homeHtml.slice(extracted.end);
  } else if (/\bdata-seo-article-feed\b/i.test(homeHtml)) {
    // Broken/unclosed feed wrapper — drop it entirely so we can re-inject later.
    html = homeHtml.replace(/<[^>]*\bdata-seo-article-feed\b[^>]*>[\s\S]*?(?=<\/(?:body|footer|html)\b|$)/i, slot);
  }
  html = html.replace(/<!--\s*Main Editorial Feed[\s\S]*?-->/gi, "");
  // Drop agent-made /page/N/ pagination shells (we use client-side pager only).
  html = html.replace(/<a\b[^>]*\bhref=["']\/page\/\d+\/?["'][^>]*>[\s\S]*?<\/a>/gi, "");
  html = html.replace(/<nav\b[^>]*\bclass=["'][^"']*\b(?:pagination|pager|pages)\b[^"']*["'][^>]*>[\s\S]*?<\/nav>/gi, "");
  html = html.replace(/<a\b[^>]*\bclass=["'][^"']*\barticle-card\b[^"']*["'][^>]*>[\s\S]*?<\/a>/gi, "");
  html = html.replace(/<a\b[^>]*\barticle-card\b[^>]*>[\s\S]*?<\/a>/gi, "");
  if (html.includes(slot) && extracted) {
    html = html.replace(slot, extracted.block);
  } else {
    html = html.replace(slot, "");
  }
  return html;
}

function buildHomeFeedSection(feedInner: string, pageSize = SEO_HOME_FEED_PAGE_SIZE): string {
  return `<section class="container section-latest" data-seo-home-feed>
  <div class="section-headline-bar"><h2 class="section-title">Свежие публикации</h2></div>
  <div data-seo-article-feed data-page-size="${pageSize}" class="articles-grid">
${feedInner}
  </div>
</section>`;
}

/**
 * Agent often paints an empty «Статьи» block without data-seo-article-feed.
 * Put the real feed right under that heading so the visible section is not blank.
 */
function hydrateEmptyArticleHeadingSections(homeHtml: string, feedInner: string, pageSize = SEO_HOME_FEED_PAGE_SIZE): string {
  if (!homeHtml || !feedInner) return homeHtml;
  const re = /<(h1|h2|h3)(\b[^>]*)>([\s\S]*?)<\/\1>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(homeHtml))) {
    const text = m[3].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    if (!/(статьи|материалы|публикации|свежие|обзоры|база\s*знаний)/i.test(text)) continue;
    const insertAt = m.index + m[0].length;
    const tail = homeHtml.slice(insertAt);
    if (/^\s*<[^>]{0,240}\bdata-seo-article-feed\b/i.test(tail)) return homeHtml;
    const feedBlock = `\n<div data-seo-article-feed data-page-size="${pageSize}" class="articles-grid">\n${feedInner}\n</div>`;
    const empty = tail.match(/^\s*<(div|section)(\b[^>]*)>\s*<\/\1>/i);
    if (empty) {
      return homeHtml.slice(0, insertAt) + feedBlock + homeHtml.slice(insertAt + empty[0].length);
    }
    return homeHtml.slice(0, insertAt) + feedBlock + homeHtml.slice(insertAt);
  }
  return homeHtml;
}

export function buildHomeFeedPagerBlock(pageSize = SEO_HOME_FEED_PAGE_SIZE): string {
  return `<nav class="seo-feed-pager" data-seo-feed-pager hidden aria-label="Страницы материалов"></nav>
<script data-seo-feed-pager-script>
(function(){
  var size=${Math.max(1, pageSize|0)};
  var feed=document.querySelector('[data-seo-article-feed]');
  if(!feed)return;
  var attrSize=parseInt(feed.getAttribute('data-page-size')||'',10);
  if(attrSize>0)size=attrSize;
  var cards=[].slice.call(feed.children).filter(function(el){
    return el.matches && (el.matches('a.article-card') || el.matches('.article-card') || (el.tagName==='A' && (el.className||'').indexOf('article-card')>=0));
  });
  if(cards.length<=size){
    var idle=document.querySelector('[data-seo-feed-pager]');
    if(idle)idle.hidden=true;
    return;
  }
  var pager=document.querySelector('[data-seo-feed-pager]');
  if(!pager){
    pager=document.createElement('nav');
    pager.className='seo-feed-pager';
    pager.setAttribute('data-seo-feed-pager','');
    pager.setAttribute('aria-label','Страницы материалов');
    if(feed.parentNode)feed.parentNode.insertBefore(pager, feed.nextSibling);
  }
  var page=1;
  var pages=Math.ceil(cards.length/size)||1;
  function show(){
    var start=(page-1)*size;
    cards.forEach(function(c,i){
      var on=(i>=start&&i<start+size);
      c.hidden=!on;
      // Art-directed stylesheets set display on cards, which beats [hidden].
      if(on)c.style.removeProperty('display');
      else c.style.setProperty('display','none','important');
    });
    pager.hidden=false;
    pager.innerHTML='';
    function btn(label,disabled,go){
      var b=document.createElement('button');
      b.type='button';b.textContent=label;b.disabled=!!disabled;
      b.addEventListener('click',function(){page=go;show();try{feed.scrollIntoView({behavior:'smooth',block:'start'});}catch(e){}});
      return b;
    }
    pager.appendChild(btn('←', page<=1, page-1));
    var label=document.createElement('span');
    label.textContent=page+' / '+pages;
    pager.appendChild(label);
    pager.appendChild(btn('→', page>=pages, page+1));
  }
  show();
})();
</script>`;
}

export function ensureHomeFeedPager(homeHtml: string, pageSize = SEO_HOME_FEED_PAGE_SIZE): string {
  if (!homeHtml || !/data-seo-article-feed/i.test(homeHtml)) return homeHtml;
  let html = homeHtml.replace(
    /(<[^>]*\bdata-seo-article-feed\b)([^>]*>)/i,
    (_m, start: string, end: string) => {
      if (/data-page-size=/i.test(start + end)) return `${start}${end}`;
      return `${start} data-page-size="${pageSize}"${end}`;
    },
  );
  html = html.replace(/<nav[^>]*\bdata-seo-feed-pager\b[^>]*>[\s\S]*?<\/nav>\s*/gi, "");
  html = html.replace(/<script[^>]*\bdata-seo-feed-pager-script\b[^>]*>[\s\S]*?<\/script>\s*/gi, "");
  html = html.replace(/<script>\s*\(function\(\)\{\s*var size=\d+;[\s\S]*?data-seo-article-feed[\s\S]*?<\/script>\s*/gi, "");
  html = html.replace(/<a\b[^>]*\bhref=["']\/page\/\d+\/?["'][^>]*>[\s\S]*?<\/a>/gi, "");
  const pager = buildHomeFeedPagerBlock(pageSize);
  const feedBlock = extractSeoArticleFeedBlock(html);
  if (feedBlock) {
    html = html.slice(0, feedBlock.end) + `\n${pager}\n` + html.slice(feedBlock.end);
  }
  return html;
}

function countFeedCards(html: string): number {
  const block = extractSeoArticleFeedBlock(html);
  if (!block) return 0;
  return (block.block.match(/<a\b[^>]*\barticle-card\b/gi) || []).length;
}

export function homeFeedNeedsRepair(homeHtml: string, articleCount: number): boolean {
  if (articleCount <= 0) return false;
  if (!homeHtml) return true;
  return countFeedCards(homeHtml) === 0;
}

const STOCK_IMAGE_HOST_RE =
  /https?:\/\/[^"'\s)]*(?:unsplash\.com|pexels\.com|picsum\.photos|placehold\.co|placeholder\.com|dummyimage\.com|pixabay\.com|loremflickr|placekitten|source\.unsplash)[^"'\s)]*/gi;

/**
 * The art director designs before the covers exist, so it fills the hero with
 * stock URLs — which are also unreliable from Russia. Every picture on the site
 * must be one we generated, so stock links are swapped for real covers: the one
 * belonging to the linked article when we can tell, otherwise the next unused.
 */
export function replaceStockImagesWithCovers(homeHtml: string, articles: SeoArticleBrief[]): string {
  if (!homeHtml || !STOCK_IMAGE_HOST_RE.test(homeHtml)) return homeHtml;
  STOCK_IMAGE_HOST_RE.lastIndex = 0;

  const covers = articles.map((a) => a.image).filter((x): x is string => !!x);
  if (!covers.length) return homeHtml;
  const byHref = new Map(articles.filter((a) => a.image).map((a) => [a.href, a.image!]));

  let cursor = 0;
  const nextCover = () => covers[cursor++ % covers.length];

  // Anything carrying an href/data-href gets that article's own cover.
  const scoped = homeHtml.replace(
    /<(a|div|li|article|section)\b[^>]*\b(?:data-)?href=["']([^"']+)["'][\s\S]*?<\/\1>/gi,
    (block: string, _tag: string, href: string) => {
      const cover = byHref.get(href);
      if (!cover) return block;
      return block.replace(STOCK_IMAGE_HOST_RE, cover);
    },
  );

  return scoped.replace(STOCK_IMAGE_HOST_RE, () => nextCover());
}

export function patchHomeArticleFeed(homeHtml: string, articles: SeoArticleBrief[]): string {
  if (!homeHtml || articles.length === 0) return homeHtml;
  let html = replaceStockImagesWithCovers(stripOrphanHomeArticleCards(homeHtml), articles);
  const feed = refreshArticleFeedHtml(articles);

  // Fill visible empty «Статьи» / «Материалы» blocks the art director left blank.
  html = hydrateEmptyArticleHeadingSections(html, feed, SEO_HOME_FEED_PAGE_SIZE);

  if (/data-seo-article-feed/i.test(html)) {
    html = html.replace(
      /<([a-zA-Z][\w:-]*)\b([^>]*\bdata-seo-article-feed\b)([^>]*)>/i,
      (_m, tag: string, mid: string, rest: string) => {
        let attrs = `${tag}${mid}${rest}`;
        attrs = attrs.replace(/\sclass=(["'])([\s\S]*?)\1/i, (_c, q: string, cls: string) => {
          const cleaned = String(cls)
            .split(/\s+/)
            .filter((c) => c && !/feed-span|featured|span-\d+|col-span|mega/i.test(c));
          if (!cleaned.includes("articles-grid")) cleaned.push("articles-grid");
          return ` class=${q}${cleaned.join(" ")}${q}`;
        });
        if (!/\bclass=/i.test(attrs)) attrs += ` class="articles-grid"`;
        if (!/data-page-size=/i.test(attrs)) attrs += ` data-page-size="${SEO_HOME_FEED_PAGE_SIZE}"`;
        return `<${attrs}>`;
      },
    );
    const next = replaceSeoArticleFeedInner(html, feed);
    if (next) {
      html = next;
    } else {
      // Unclosed/broken wrapper — remove and inject a clean section.
      html = html.replace(/<[^>]*\bdata-seo-article-feed\b[^>]*>[\s\S]*?(?=<\/(?:body|footer|html)\b|$)/i, "");
      const section = buildHomeFeedSection(feed);
      if (/<footer[\s\S]*?<\/footer>/i.test(html)) {
        html = html.replace(/<footer[\s\S]*?<\/footer>/i, `${section}\n$&`);
      } else if (/<\/body>/i.test(html)) {
        html = html.replace(/<\/body>/i, `${section}\n</body>`);
      } else {
        html = `${html}\n${section}`;
      }
    }
  } else {
    const section = buildHomeFeedSection(feed);
    if (/<footer[\s\S]*?<\/footer>/i.test(html)) {
      html = html.replace(/<footer[\s\S]*?<\/footer>/i, `${section}\n$&`);
    } else if (/<\/body>/i.test(html)) {
      html = html.replace(/<\/body>/i, `${section}\n</body>`);
    } else {
      html = `${html}\n${section}`;
    }
  }

  // Safety: if feed still empty after patch, force a fresh section before footer.
  if (countFeedCards(html) === 0) {
    html = html.replace(/<[^>]*\bdata-seo-article-feed\b[\s\S]*?<\/[a-zA-Z][\w:-]*>/i, "");
    const section = buildHomeFeedSection(feed);
    if (/<footer[\s\S]*?<\/footer>/i.test(html)) {
      html = html.replace(/<footer[\s\S]*?<\/footer>/i, `${section}\n$&`);
    } else if (/<\/body>/i.test(html)) {
      html = html.replace(/<\/body>/i, `${section}\n</body>`);
    } else {
      html = `${html}\n${section}`;
    }
  }

  // Strip orphan cards only outside the (now filled) feed — never wipe the feed itself.
  html = stripOrphanHomeArticleCards(html);
  if (countFeedCards(html) === 0) {
    // stripOrphan failed on broken wrapper — last-resort inject
    const section = buildHomeFeedSection(feed);
    if (/<footer[\s\S]*?<\/footer>/i.test(html)) {
      html = html.replace(/<footer[\s\S]*?<\/footer>/i, `${section}\n$&`);
    } else {
      html = `${html}\n${section}`;
    }
  }
  return ensureHomeFeedPager(html, SEO_HOME_FEED_PAGE_SIZE);
}

/** Demote brand <h1> so article/category pages keep a single content H1. */
export function demoteHeaderBrandH1(headerHtml: string): string {
  return headerHtml
    .replace(/<h1(\s[^>]*)?>/gi, "<div$1>")
    .replace(/<\/h1>/gi, "</div>");
}

/** Show human category names in the copied masthead, not raw slugs. */
export function relabelHeaderCategoryLinks(headerHtml: string, clusters: Array<{ slug: string; name: string }>): string {
  if (!headerHtml || !clusters?.length) return headerHtml;
  let out = headerHtml;
  for (const c of clusters) {
    if (!c.slug || !c.name) continue;
    const slugRe = new RegExp(
      `(<a\\b[^>]*href=["']\\/${c.slug.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\/?["'][^>]*>)([\\s\\S]*?)(<\\/a>)`,
      "gi",
    );
    out = out.replace(slugRe, (_m, open: string, inner: string, close: string) => {
      const text = String(inner).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
      if (text && text !== c.slug && text !== `/${c.slug}/` && /[а-яa-z]/i.test(text) && text.length > 2 && text !== c.slug.replace(/-/g, " ")) {
        return `${open}${inner}${close}`;
      }
      return `${open}${escapeHtml(c.name)}${close}`;
    });
  }
  return out;
}

export function extractHomeShell(homeHtml: string | undefined): {
  header?: string;
  nav?: string;
  footer?: string;
  bodyClass?: string;
} {
  if (!homeHtml) return {};
  const header =
    homeHtml.match(/<header\b[^>]*\bsite-header\b[^>]*>[\s\S]*?<\/header>/i)?.[0] ||
    homeHtml.match(/<header\b[\s\S]*?<\/header>/i)?.[0];
  const nav = homeHtml.match(/<nav\b[\s\S]*?<\/nav>/i)?.[0];
  const footer = homeHtml.match(/<footer\b[\s\S]*?<\/footer>/i)?.[0];
  const bodyAttrs = homeHtml.match(/<body([^>]*)>/i)?.[1] || "";
  const bodyClass = /class=["']([^"']+)["']/i.exec(bodyAttrs)?.[1];
  return { header, nav, footer, bodyClass };
}

export function buildRelatedArticlesHtml(
  kw: Pick<SeoKeyword, "slug" | "title">,
  cluster: SeoCluster,
  cfg: Pick<SeoConfig, "clusters">,
): string {
  const same = cluster.keywords
    .filter((k) => k.slug !== kw.slug && (k.status === "done" || k.filename))
    .slice(0, 3)
    .map((k) => ({ title: k.title, href: `/${cluster.slug}/${k.slug}/`, cat: cluster.name }));
  const others = (cfg.clusters || [])
    .filter((c) => c.slug !== cluster.slug)
    .flatMap((c) =>
      c.keywords
        .filter((k) => k.status === "done" || k.filename)
        .slice(0, 1)
        .map((k) => ({ title: k.title, href: `/${c.slug}/${k.slug}/`, cat: c.name })),
    )
    .slice(0, 2);
  const items = [...same, ...others].slice(0, 4);
  if (!items.length) return "";
  const cards = items
    .map(
      (it) => `<a href="${escapeHtml(it.href)}" class="related-card">
      <span class="tag">${escapeHtml(it.cat)}</span>
      <h3 class="rc-title">${escapeHtml(it.title)}</h3>
    </a>`,
    )
    .join("\n    ");
  return `${RELATED_MARK_OPEN}<div class="related-articles">
  <h2>Читайте также</h2>
  <div class="related-grid">
    ${cards}
  </div>
</div>${RELATED_MARK_CLOSE}`;
}

const RELATED_BLOCK_RE =
  /<div\s+class=["'][^"']*related-articles[^"']*["'][^>]*>[\s\S]*?<div\s+class=["'][^"']*related-grid[^"']*["'][^>]*>[\s\S]*?<\/div>\s*<\/div>/gi;
const RELATED_MARKED_RE = /<!--seo-related-->[\s\S]*?<!--\/seo-related-->/gi;
const RELATED_MARK_OPEN = "<!--seo-related-->";
const RELATED_MARK_CLOSE = "<!--/seo-related-->";

/**
 * Legacy inline «Читайте также» paragraph. It was injected after the lead on
 * every project load, so articles accumulated several of them right where the
 * reader starts. Real related links now live in one block at the end.
 */
export function stripInlineAlsoParagraphs(html: string): string {
  if (!html) return html;
  return html.replace(/\s*<p\s+class=["'][^"']*article-also[^"']*["'][^>]*>[\s\S]*?<\/p>/gi, "");
}

/**
 * Repair for pages built from a shell that annotated its {{ARTICLE}} slot with
 * an HTML comment: the substituted article ended up inside the comment, so the
 * page rendered as chrome around nothing. Keeps the markup, drops the note.
 */
export function uncommentBuriedArticle(html: string): string {
  if (!html) return html;
  return html.replace(/<!--([\s\S]*?)-->/g, (whole: string, inner: string) => {
    if (!/class=["'][^"']*\barticle-(?:header|body)\b/i.test(inner)) return whole;
    const firstTag = inner.indexOf("<");
    return firstTag >= 0 ? inner.slice(firstTag) : whole;
  });
}

export function stripRelatedArticleBlocks(html: string): string {
  if (!html) return html;
  return html.replace(RELATED_MARKED_RE, "").replace(RELATED_BLOCK_RE, "");
}

/**
 * Keeps exactly ONE related block per article and, once it has been placed,
 * refreshes it where it already sits instead of appending another copy.
 */
export function ensureRealRelatedArticles(
  html: string,
  kw: Pick<SeoKeyword, "slug" | "title">,
  cluster: SeoCluster,
  cfg: Pick<SeoConfig, "clusters">,
): string {
  if (!html) return html;
  const block = buildRelatedArticlesHtml(kw, cluster, cfg);
  const noAlso = stripInlineAlsoParagraphs(html);

  if (RELATED_MARKED_RE.test(noAlso)) {
    RELATED_MARKED_RE.lastIndex = 0;
    let first = true;
    return noAlso.replace(RELATED_MARKED_RE, () => {
      if (!first) return "";
      first = false;
      return block;
    });
  }

  const cleaned = stripRelatedArticleBlocks(noAlso);
  if (!block) return cleaned;
  if (cleaned.includes("{{RELATED}}")) return cleaned.replace("{{RELATED}}", block);
  if (/<\/main>/i.test(cleaned)) return cleaned.replace(/<\/main>/i, `${block}\n</main>`);
  if (/<aside\s+class=["']sidebar["']/i.test(cleaned)) {
    return cleaned.replace(/<aside\s+class=["']sidebar["']/i, `${block}\n<aside class="sidebar"`);
  }
  // Inner article fragment (no page chrome) — append after FAQ / body
  return `${cleaned.trim()}\n${block}`;
}
