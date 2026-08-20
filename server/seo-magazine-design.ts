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

export type SeoArticleBrief = {
  title: string;
  href: string;
  cluster: string;
  image?: string;
};

export function collectSeoArticleBriefs(cfg: SeoConfig, limit = 24): SeoArticleBrief[] {
  const out: SeoArticleBrief[] = [];
  for (const c of cfg.clusters) {
    for (const kw of c.keywords) {
      if (kw.status !== "done") continue;
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
  heroVariant: SeoHeroVariant;
  articles: SeoArticleBrief[];
  logoUrl?: string;
}): string {
  const { cfg, heroVariant, articles, logoUrl } = opts;
  const cats = cfg.clusters.map((c) => ({
    name: c.name,
    slug: c.slug,
    href: `/${c.slug}/`,
    description: c.description,
    count: c.keywords.filter((k) => k.status === "done").length,
  }));

  return `You are a principal UI/UX art director for a premium digital WEB MAGAZINE (Russian language UI).
Create a COMPLETE unique homepage + stylesheet. The site must look like top magazine designers shipped it — NOT a generic SaaS blog, NOT a white Bootstrap template.

PUBLICATION
- Brand / H1: ${JSON.stringify(cfg.siteTitle)}
- Niche: ${JSON.stringify(cfg.niche)}
- Description: ${JSON.stringify(cfg.siteDescription)}
- Logo URL (optional <img>): ${logoUrl ? JSON.stringify(logoUrl) : "(text mark OK)"}
- CTA URL (optional, use rel=noopener sponsored if present): ${cfg.targetUrl ? JSON.stringify(cfg.targetUrl) : "(none)"}
- CTA label: ${JSON.stringify(cfg.ctaLabel || "Подробнее")}

ASSIGNED HERO ARCHETYPE (build THIS interactive hero — invent the visual language):
${heroVariantDescription(heroVariant)}

OTHER HERO ARCHETYPES (do NOT copy them; your site uses only "${heroVariant}"):
${SEO_HERO_VARIANTS.map((v, i) => `${i + 1}. ${v}`).join("\n")}

REAL ARTICLES (use exact href/title/image; if image missing use rich gradient panels):
${JSON.stringify(articles, null, 2)}

CATEGORIES:
${JSON.stringify(cats, null, 2)}

CREATIVE MANDATE
1. Invent typography (Cyrillic Google Fonts), palette, density, motion for THIS niche. Deep living backgrounds OK (gradients, subtle noise, soft blobs, parallax layers, cinematic overlays) — keep text WCAG-readable.
2. Quality bar: web magazines / editorial sites (energy like gamemag.ru) but ORIGINAL for this niche — never clone a known brand.
3. Interactive Hero is the star: motion, hover, autoplay/slider/tilt/marquee as fits the archetype. Brand name + short description MUST appear in the hero (left or integrated elegantly).
4. Below hero: article feed + topics. Use semantic classes so the server can refresh cards:
   - Wrap article cards in <div data-seo-article-feed class="...">...</div>
   - Each card: <a class="article-card" href="..."> with .ac-img-wrap / .ac-title / .ac-cat
5. Single sticky top nav with category links (overflow OK). Footer with niche line.
6. Include inline <script> for hero interactivity (no external JS CDNs except Google Fonts).
7. GEO in <head>: charset, viewport, title, description, canonical "/", og tags, link rel="alternate" type="text/plain" href="/llms.txt", JSON-LD WebSite+Organization+ItemList for latest articles.
8. link stylesheet exactly: href="/assets/style.css"
9. body class must include: structure-v2 art-directed hero-${heroVariant}
10. Mobile-first responsive. No horizontal scroll. No SVG decorative animations that replace photos.
11. Do NOT invent article URLs — only use hrefs from REAL ARTICLES / CATEGORIES.

OUTPUT FORMAT — exactly two files, nothing else:
--- FILE: assets/style.css ---
\`\`\`css
/* magazine-art-v6 */
...full CSS including @import Google Fonts first...
\`\`\`

--- FILE: index.html ---
\`\`\`html
<!DOCTYPE html>
...complete document...
\`\`\`
`;
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

export function parseMagazineDesignFiles(raw: string): { css?: string; html?: string } {
  const out: { css?: string; html?: string } = {};
  const re =
    /---\s*FILE:\s*([^\n-]+?)\s*---\s*```(?:css|html|HTML|CSS)?\s*([\s\S]*?)```/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw))) {
    const name = m[1].trim().replace(/^\.\//, "");
    const body = m[2].trim();
    if (/style\.css/i.test(name)) out.css = body;
    if (/index\.html/i.test(name)) out.html = body;
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

/** Soft accessibility / monetization guard — does NOT force hero-split or 4-col grid. */
export function buildSoftMagazineGuardCss(): string {
  return `
/* structural-guard-v8 — soft magazine guard (agent-owned layout) */
html,body{overflow-x:hidden!important;max-width:100%!important}
img,video,canvas,svg{max-width:100%;height:auto}
.ref-offer{display:block!important;position:relative!important;margin:2.25rem 0!important;border-radius:18px!important;overflow:hidden!important}
.ref-offer-title{color:var(--text,#18181b)!important}
.ref-offer-desc{color:var(--text2,#3f3f46)!important}
.ref-offer-btn{position:relative!important;display:inline-flex!important;align-items:center!important;justify-content:center!important;min-height:48px!important;padding:.9rem 1.4rem!important;border-radius:999px!important;color:#fff!important;font-weight:800!important;text-decoration:none!important}
.cta-block{display:none!important}
.article-body{font-size:clamp(17px,1.05vw,19px);line-height:1.75;max-width:72ch}
.on-media{color:#fff!important;text-shadow:0 1px 2px rgba(0,0,0,.45)}
`;
}

export function ensureSoftMagazineGuardCss(css: string): string {
  if (!css) return buildSoftMagazineGuardCss();
  if (css.includes("structural-guard-v8") || css.includes("magazine-art-v6")) {
    if (css.includes("structural-guard-v8")) return css;
    const stripped = css.replace(/\n?\/\*\s*structural-guard(?:-v\d+)?[\s\S]*$/i, "").trim();
    return `${stripped}\n${buildSoftMagazineGuardCss()}`;
  }
  const withoutOld = css.replace(/\n?\/\*\s*structural-guard(?:-v\d+)?[\s\S]*$/i, "").trim();
  return `${withoutOld}\n${buildSoftMagazineGuardCss()}`;
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
      (a, i) => `<a href="${escapeHtml(a.href)}" class="article-card">
  <div class="ac-img-wrap">${
    a.image
      ? `<img src="${escapeHtml(a.image)}" alt="${escapeHtml(a.title)}" loading="lazy">`
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

export function patchHomeArticleFeed(homeHtml: string, articles: SeoArticleBrief[]): string {
  if (!homeHtml || articles.length === 0) return homeHtml;
  const feed = refreshArticleFeedHtml(articles);
  if (/data-seo-article-feed/i.test(homeHtml)) {
    return homeHtml.replace(
      /(<[^>]*data-seo-article-feed[^>]*>)([\s\S]*?)(<\/[^>]+>)/i,
      `$1\n${feed}\n$3`,
    );
  }
  return homeHtml;
}
