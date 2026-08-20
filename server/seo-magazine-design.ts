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
4. Below hero MUST be magazine-grade (not a dump of plain boxes):
   - Topics / category hubs with visual weight (image or strong panel + typography)
   - Editorial article feed in a designed grid
   - Optional promo strip
5. Article feed contract (CRITICAL — server refreshes this):
   - Exactly ONE wrapper: <div data-seo-article-feed class="articles-grid ...">...</div>
   - Put ALL homepage article-cards ONLY inside that wrapper — never duplicate cards outside it
   - Each card: <a class="article-card" href="..."> with .ac-img-wrap / .ac-title / .ac-cat / .ac-body
6. Sticky top chrome MUST be a full <header class="site-header"> containing brand lockup + <nav> category links + optional CTA. The server copies this entire <header> onto category and article pages — design it to work on every page, not only home.
7. Footer with niche line + category links.
8. Include inline <script> for hero interactivity (no external JS CDNs except Google Fonts).
9. GEO in <head>: charset, viewport, title, description, canonical "/", og tags, link rel="alternate" type="text/plain" href="/llms.txt", JSON-LD WebSite+Organization+ItemList for latest articles.
10. link stylesheet exactly: href="/assets/style.css"
11. body class must include: structure-v2 art-directed hero-${heroVariant}
12. Mobile-first responsive. No horizontal scroll. No SVG decorative animations that replace photos.
13. Do NOT invent article URLs — only use hrefs from REAL ARTICLES / CATEGORIES.

FULL-SITE CSS (mandatory — same stylesheet styles EVERY page type):
Style all of these with the same art direction (use CSS variables --bg --text --text2 --muted --brand --border --heading-font --body-font --r --w):
- .site-header, .nav-wrapper / header chrome, .brand-*, .cat-nav-link, header CTA
- .categories-showcase / .cats-grid / .cat-hub-card (or your topic hubs)
- .articles-grid, .article-card, .ac-*
- .article-page, .article-layout, .article-main, .article-header, .article-deck, .article-meta, .article-body
- .breadcrumb, .cat-header, .category-composition, .sidebar, .sb-*
- .related-articles, .related-grid, .related-card
- .key-takeaways, .faq-section, .faq-item, .callout, .pull-quote, .stat-grid, .author-box
- .hero-article-img, tables, lists, footer
Article pages must read as the same magazine as the homepage — never unstyled black text on empty canvas.

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

/** Soft accessibility / monetization + full-site editorial fallback (agent may under-style articles). */
export function buildSoftMagazineGuardCss(): string {
  return `
/* structural-guard-v9 — soft magazine guard + full-site editorial fallback */
html,body{overflow-x:hidden!important;max-width:100%!important}
img,video,canvas,svg{max-width:100%;height:auto}
a{color:inherit;text-decoration:none}
.ref-offer{display:block!important;position:relative!important;margin:2.25rem 0!important;border-radius:18px!important;overflow:hidden!important}
.ref-offer-title{color:var(--text,#18181b)!important}
.ref-offer-desc{color:var(--text2,#3f3f46)!important}
.ref-offer-btn{position:relative!important;display:inline-flex!important;align-items:center!important;justify-content:center!important;min-height:48px!important;padding:.9rem 1.4rem!important;border-radius:999px!important;color:#fff!important;font-weight:800!important;text-decoration:none!important}
.cta-block{display:none!important}
.on-media{color:#fff!important;text-shadow:0 1px 2px rgba(0,0,0,.45)}

/* Header chrome (copied from home onto all pages) */
.site-header{position:sticky;top:0;z-index:200;backdrop-filter:saturate(140%) blur(14px);-webkit-backdrop-filter:saturate(140%) blur(14px);background:color-mix(in srgb,var(--bg,#07080c) 82%,transparent);border-bottom:1px solid color-mix(in srgb,var(--border,#27272a) 80%,transparent)}
.site-header .nav-wrapper,.site-header .container{max-width:var(--w,1200px);margin:0 auto;padding:.85rem 1.25rem;display:flex;align-items:center;gap:1rem;min-width:0}
.brand-group,.brand-lockup,.nav-logo{display:inline-flex;align-items:center;gap:.65rem;min-width:0;color:var(--text,#fafafa);font-weight:800;letter-spacing:-.03em}
.brand-h1,.brand-group h1,.logo-text{font-size:clamp(1rem,2vw,1.2rem);font-weight:900;margin:0;font-family:var(--heading-font,inherit);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.categories-nav,.site-header nav{display:flex;align-items:center;gap:.15rem;margin-left:auto;min-width:0;overflow-x:auto;scrollbar-width:none}
.categories-nav::-webkit-scrollbar{display:none}
.cat-nav-link,.categories-nav a,.site-header nav a{font-size:.82rem;font-weight:600;color:var(--muted,#a1a1aa);padding:.45rem .7rem;border-radius:999px;white-space:nowrap;transition:.15s}
.cat-nav-link:hover,.categories-nav a:hover,.site-header nav a:hover{color:var(--text,#fff);background:color-mix(in srgb,var(--brand,#22d3ee) 16%,transparent)}
.header-cta-btn{flex-shrink:0;display:inline-flex;align-items:center;gap:.35rem;padding:.65rem 1.05rem;border-radius:999px;background:var(--brand,#22d3ee);color:#041016;font-weight:800;font-size:.78rem;letter-spacing:.04em;text-transform:uppercase}

/* Home below-fold */
.categories-showcase,.section-latest,.editorial-feed{padding:2.5rem 0 1rem}
.section-headline-bar,.section-header{display:flex;align-items:baseline;justify-content:space-between;gap:1rem;margin:0 0 1.25rem;padding:0 0 .75rem;border-bottom:1px solid var(--border,#27272a)}
.section-title{font-family:var(--heading-font,inherit);font-size:clamp(1.25rem,2.4vw,1.75rem);font-weight:900;letter-spacing:-.03em;margin:0}
.section-counter{font-size:.75rem;color:var(--muted,#71717a);font-weight:600}
.cats-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:1rem}
.cat-hub-card,.cat-card{display:block;padding:1.25rem 1.3rem;border-radius:calc(var(--r,16px) + 2px);border:1px solid var(--border,#27272a);background:color-mix(in srgb,var(--bg2,#12141c) 88%,transparent);transition:transform .2s ease,border-color .2s ease,box-shadow .2s ease}
.cat-hub-card:hover,.cat-card:hover{transform:translateY(-3px);border-color:color-mix(in srgb,var(--brand,#22d3ee) 45%,var(--border,#27272a));box-shadow:0 18px 40px rgba(0,0,0,.28)}
.cat-hub-header{display:flex;align-items:flex-start;justify-content:space-between;gap:.75rem;margin-bottom:.55rem}
.cat-hub-name,.cat-card h2,.cat-card h3{font-family:var(--heading-font,inherit);font-size:1.05rem;font-weight:800;margin:0;letter-spacing:-.02em}
.cat-hub-count{font-size:.68rem;font-weight:800;color:var(--brand,#22d3ee);white-space:nowrap}
.cat-hub-desc,.cat-card p{margin:0;font-size:.86rem;line-height:1.55;color:var(--text2,#a1a1aa)}
.articles-grid,[data-seo-article-feed]{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:1.1rem;margin:0 0 2.5rem}
.article-card{display:block;border-radius:var(--r,16px);overflow:hidden;border:1px solid var(--border,#27272a);background:color-mix(in srgb,var(--bg2,#12141c) 92%,transparent);color:var(--text,#fafafa);transition:transform .2s ease,box-shadow .2s ease,border-color .2s ease}
.article-card:hover{transform:translateY(-3px);border-color:color-mix(in srgb,var(--brand,#22d3ee) 40%,var(--border,#27272a));box-shadow:0 18px 40px rgba(0,0,0,.3)}
.ac-img-wrap{height:170px;overflow:hidden;background:#0a0a0a}
.ac-img-wrap img,.ac-img-grad{width:100%;height:100%;object-fit:cover;display:block;transition:transform .25s ease}
.article-card:hover .ac-img-wrap img{transform:scale(1.05)}
.ac-body,.ac-content{padding:.9rem 1rem 1.05rem}
.ac-cat{display:block;font-size:.65rem;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:var(--brand,#22d3ee);margin-bottom:.35rem}
.ac-title{font-family:var(--heading-font,inherit);font-size:.95rem;font-weight:750;line-height:1.35;margin:0 0 .35rem}
.article-card:hover .ac-title{color:var(--brand,#22d3ee)}
.ac-meta,.ac-arrow{font-size:.72rem;color:var(--muted,#71717a)}

/* Category pages */
.cat-header{padding:2rem 0 1.25rem}
.cat-header h1{font-family:var(--heading-font,inherit);font-size:clamp(1.8rem,4vw,2.6rem);font-weight:900;letter-spacing:-.04em;margin:.35rem 0 .5rem}
.cat-header p{max-width:62ch;color:var(--text2,#a1a1aa);font-size:1.02rem;line-height:1.6}
.category-number{font-size:.78rem;font-weight:800;color:var(--brand,#22d3ee);letter-spacing:.12em}
.category-composition,.container{max-width:var(--w,1200px);margin:0 auto;padding:0 1.25rem}
.breadcrumb{display:flex;flex-wrap:wrap;gap:.35rem;align-items:center;padding:.85rem 0;font-size:.78rem;color:var(--muted,#71717a)}
.breadcrumb a:hover{color:var(--brand,#22d3ee)}
.breadcrumb .sep{opacity:.45}
.breadcrumb .cur{color:var(--text2,#d4d4d8)}

/* Article pages */
.article-page{max-width:var(--w,1200px);margin:0 auto;padding:0 1.25rem 4.5rem}
.article-layout{display:grid;grid-template-columns:minmax(0,1fr) 280px;gap:2rem;align-items:start}
.article-layout-sidebar-left{grid-template-columns:280px minmax(0,1fr)}
.article-layout-single,.article-layout-full{grid-template-columns:minmax(0,1fr)}
.article-main{min-width:0}
.article-header h1{font-family:var(--heading-font,inherit);font-size:clamp(1.85rem,4.2vw,2.85rem);font-weight:900;letter-spacing:-.04em;line-height:1.12;margin:0 0 .75rem}
.article-deck{font-size:clamp(1.05rem,1.4vw,1.2rem);line-height:1.55;color:var(--text2,#a1a1aa);max-width:62ch;margin:0 0 1rem}
.article-meta{display:flex;flex-wrap:wrap;gap:.55rem .9rem;align-items:center;font-size:.78rem;color:var(--muted,#71717a);margin-bottom:1.25rem}
.article-meta .tag{display:inline-flex;padding:.2rem .55rem;border-radius:999px;background:color-mix(in srgb,var(--brand,#22d3ee) 18%,transparent);color:var(--brand,#22d3ee);font-weight:800;font-size:.68rem;letter-spacing:.06em;text-transform:uppercase}
.hero-article-img,.hero-cover-fallback{width:100%;max-height:min(520px,58vw);object-fit:cover;border-radius:calc(var(--r,16px) + 4px);margin:0 0 1.5rem;display:block;border:1px solid var(--border,#27272a)}
.hero-cover-fallback{display:flex;align-items:flex-end;min-height:280px;padding:1.25rem;color:#fff;font-weight:800}
.article-body{font-family:var(--body-font,inherit);font-size:clamp(17px,1.05vw,19px);line-height:1.75;max-width:72ch;color:var(--text,#f4f4f5)}
.article-body .lead{font-size:1.12em;font-weight:650;line-height:1.65;margin:0 0 1.25rem}
.article-body .lead::first-letter{font-family:var(--heading-font,inherit);font-size:2.6em;font-weight:900;float:left;line-height:.85;padding:.08em .12em 0 0;color:var(--brand,#22d3ee)}
.article-body h2{font-family:var(--heading-font,inherit);font-size:clamp(1.35rem,2.2vw,1.7rem);font-weight:850;letter-spacing:-.03em;margin:2.4rem 0 .9rem;line-height:1.2}
.article-body h3,.article-body h4{font-family:var(--heading-font,inherit);font-size:1.15rem;font-weight:800;margin:1.6rem 0 .6rem}
.article-body p{margin:0 0 1.05rem}
.article-body ul,.article-body ol{margin:0 0 1.15rem;padding-left:1.2rem}
.article-body li{margin:.35rem 0}
.article-body a{color:var(--brand,#22d3ee);text-decoration:underline;text-underline-offset:2px}
.article-body table,.comparison-table{width:100%;border-collapse:collapse;margin:1.25rem 0 1.5rem;font-size:.9em}
.article-body th,.article-body td,.comparison-table th,.comparison-table td{border:1px solid var(--border,#27272a);padding:.65rem .75rem;text-align:left}
.article-body th,.comparison-table th{background:color-mix(in srgb,var(--bg2,#12141c) 90%,transparent);font-weight:800}
.key-takeaways{margin:0 0 1.5rem;padding:1.15rem 1.25rem;border-radius:var(--r,16px);border:1px solid color-mix(in srgb,var(--brand,#22d3ee) 35%,var(--border,#27272a));background:color-mix(in srgb,var(--brand,#22d3ee) 10%,var(--bg,#07080c))}
.key-takeaways h3{font-family:var(--heading-font,inherit);margin:0 0 .6rem;font-size:1rem;font-weight:850}
.key-takeaways ul{margin:0;padding-left:1.1rem}
.pull-quote{margin:1.5rem 0;padding:1rem 0 1rem 1.15rem;border-left:3px solid var(--brand,#22d3ee);font-family:var(--heading-font,inherit);font-size:1.25rem;font-weight:750;line-height:1.4;color:var(--text,#fff)}
.callout{margin:1.25rem 0;padding:1rem 1.15rem;border-radius:14px;border:1px solid var(--border,#27272a);background:color-mix(in srgb,var(--bg2,#12141c) 88%,transparent)}
.callout-title{font-weight:850;margin-bottom:.35rem}
.stat-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:.75rem;margin:1.25rem 0}
.stat-card{padding:1rem;border-radius:14px;border:1px solid var(--border,#27272a);background:color-mix(in srgb,var(--bg2,#12141c) 90%,transparent);text-align:center}
.stat-num{font-family:var(--heading-font,inherit);font-size:1.6rem;font-weight:900;color:var(--brand,#22d3ee)}
.stat-label{font-size:.78rem;color:var(--muted,#a1a1aa);margin-top:.25rem}
.author-box{display:flex;gap:.9rem;align-items:center;margin:2rem 0;padding:1rem 1.15rem;border-radius:16px;border:1px solid var(--border,#27272a);background:color-mix(in srgb,var(--bg2,#12141c) 90%,transparent)}
.author-avatar{width:44px;height:44px;border-radius:50%;display:grid;place-items:center;background:var(--brand,#22d3ee);color:#041016;font-weight:900}
.author-name{font-weight:850}
.author-bio{font-size:.82rem;color:var(--muted,#a1a1aa)}
.faq-section{margin:2rem 0}
.faq-section>h2{font-family:var(--heading-font,inherit);font-size:1.35rem;font-weight:900;margin:0 0 1rem}
.faq-item{border:1px solid var(--border,#27272a);border-radius:12px;margin:0 0 .65rem;overflow:hidden;background:color-mix(in srgb,var(--bg2,#12141c) 86%,transparent)}
.faq-question{display:flex;justify-content:space-between;gap:1rem;padding:.9rem 1rem;cursor:pointer;font-weight:750}
.faq-answer{display:none;padding:0 1rem 1rem;color:var(--text2,#a1a1aa);line-height:1.6}
.related-articles{margin-top:2.5rem;padding-top:1.5rem;border-top:1px solid var(--border,#27272a)}
.related-articles>h2{font-family:var(--heading-font,inherit);font-size:1.15rem;font-weight:900;margin:0 0 1rem}
.related-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:.85rem}
.related-card{display:block;padding:1rem 1.05rem;border-radius:14px;border:1px solid var(--border,#27272a);background:color-mix(in srgb,var(--bg2,#12141c) 90%,transparent);transition:border-color .15s ease,transform .15s ease}
.related-card:hover{border-color:color-mix(in srgb,var(--brand,#22d3ee) 45%,var(--border,#27272a));transform:translateY(-2px)}
.related-card .tag,.related-card .rc-cat{display:block;font-size:.65rem;font-weight:800;letter-spacing:.07em;text-transform:uppercase;color:var(--brand,#22d3ee);margin-bottom:.35rem}
.related-card h3,.related-card .rc-title{font-family:var(--heading-font,inherit);font-size:.95rem;font-weight:800;line-height:1.35;margin:0}
.sidebar{position:sticky;top:5.5rem;display:flex;flex-direction:column;gap:1rem}
.sb-block{border:1px solid var(--border,#27272a);border-radius:16px;overflow:hidden;background:color-mix(in srgb,var(--bg2,#12141c) 90%,transparent)}
.sb-head{padding:.75rem 1rem;font-size:.72rem;font-weight:850;letter-spacing:.08em;text-transform:uppercase;border-bottom:1px solid var(--border,#27272a);color:var(--muted,#a1a1aa)}
.sb-body{padding:.35rem .4rem .55rem}
.sb-list{list-style:none;margin:0;padding:0}
.sb-list li{display:flex;gap:.55rem;align-items:flex-start;padding:.55rem .6rem;border-radius:10px}
.sb-list li:hover{background:color-mix(in srgb,var(--brand,#22d3ee) 10%,transparent)}
.sb-num{font-size:.68rem;font-weight:850;color:var(--brand,#22d3ee);min-width:1.4rem}
.sb-list a{font-size:.84rem;line-height:1.35;font-weight:650}
.reading-progress{position:fixed;top:0;left:0;height:3px;width:0;z-index:300;background:var(--brand,#22d3ee)}
footer{margin-top:3rem;padding:2.5rem 0 2rem;border-top:1px solid var(--border,#27272a);background:color-mix(in srgb,var(--bg,#07080c) 92%,#000)}
.footer-inner{max-width:var(--w,1200px);margin:0 auto;padding:0 1.25rem;display:grid;grid-template-columns:1.4fr 1fr 1fr;gap:1.5rem}
.footer-desc{color:var(--text2,#a1a1aa);font-size:.9rem;line-height:1.55;max-width:42ch}
.footer-col h4,.footer-col h5{font-size:.75rem;letter-spacing:.08em;text-transform:uppercase;margin:0 0 .7rem;color:var(--muted,#71717a)}
.footer-col ul{list-style:none;margin:0;padding:0}
.footer-col li{margin:.35rem 0}
.footer-col a:hover{color:var(--brand,#22d3ee)}
.footer-bottom{max-width:var(--w,1200px);margin:1.5rem auto 0;padding:1rem 1.25rem 0;border-top:1px solid var(--border,#27272a);display:flex;flex-wrap:wrap;gap:.75rem;justify-content:space-between;font-size:.78rem;color:var(--muted,#71717a)}
@media(max-width:960px){
  .cats-grid,.articles-grid,[data-seo-article-feed],.related-grid{grid-template-columns:1fr 1fr}
  .article-layout,.article-layout-sidebar-left{grid-template-columns:1fr}
  .sidebar{position:static}
  .footer-inner{grid-template-columns:1fr}
  .header-cta-btn{display:none}
}
@media(max-width:640px){
  .cats-grid,.articles-grid,[data-seo-article-feed],.related-grid{grid-template-columns:1fr}
  .categories-nav{display:none}
  .article-page{padding:0 1rem 3rem}
  .article-body{font-size:1.0625rem}
}
`;
}

export function ensureSoftMagazineGuardCss(css: string): string {
  if (!css) return buildSoftMagazineGuardCss();
  const stripped = css.replace(/\n?\/\*\s*structural-guard(?:-v\d+)?[\s\S]*$/i, "").trim();
  return `${stripped}\n${buildSoftMagazineGuardCss()}`;
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

/** Remove duplicate article-card dumps outside the single data-seo-article-feed region. */
export function stripOrphanHomeArticleCards(homeHtml: string): string {
  if (!homeHtml) return homeHtml;
  const feeds: string[] = [];
  let html = homeHtml.replace(/<[^>]*\bdata-seo-article-feed\b[^>]*>[\s\S]*?<\/div>/gi, (m) => {
    feeds.push(m);
    return `<!--SEO_FEED_SLOT_${feeds.length - 1}-->`;
  });
  html = html.replace(/<!--\s*Main Editorial Feed[\s\S]*?-->/gi, "");
  html = html.replace(/<a\b[^>]*\bclass=["'][^"']*\barticle-card\b[^"']*["'][^>]*>[\s\S]*?<\/a>/gi, "");
  feeds.forEach((feed, i) => {
    html = html.replace(`<!--SEO_FEED_SLOT_${i}-->`, feed);
  });
  return html;
}

export function patchHomeArticleFeed(homeHtml: string, articles: SeoArticleBrief[]): string {
  if (!homeHtml || articles.length === 0) return homeHtml;
  let html = stripOrphanHomeArticleCards(homeHtml);
  const feed = refreshArticleFeedHtml(articles);
  if (/data-seo-article-feed/i.test(html)) {
    return html.replace(
      /(<[^>]*\bdata-seo-article-feed\b[^>]*>)([\s\S]*?)(<\/[^>]+>)/i,
      `$1\n${feed}\n$3`,
    );
  }
  // No marked feed — inject a clean one before footer
  const section = `<section class="container section-latest"><div class="section-headline-bar"><h2 class="section-title">Материалы</h2></div><div data-seo-article-feed class="articles-grid">\n${feed}\n</div></section>`;
  if (/<footer[\s\S]*?<\/footer>/i.test(html)) {
    return html.replace(/<footer[\s\S]*?<\/footer>/i, `${section}\n$&`);
  }
  return `${html}\n${section}`;
}

/** Demote brand <h1> so article/category pages keep a single content H1. */
export function demoteHeaderBrandH1(headerHtml: string): string {
  return headerHtml
    .replace(/<h1(\s[^>]*)?>/gi, "<div$1>")
    .replace(/<\/h1>/gi, "</div>");
}

export function extractHomeShell(homeHtml: string | undefined): {
  header?: string;
  nav?: string;
  footer?: string;
  bodyClass?: string;
} {
  if (!homeHtml) return {};
  const header = homeHtml.match(/<header\b[\s\S]*?<\/header>/i)?.[0];
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
  return `<div class="related-articles">
  <h2>Читайте также</h2>
  <div class="related-grid">
    ${cards}
  </div>
</div>`;
}

export function ensureRealRelatedArticles(
  html: string,
  kw: Pick<SeoKeyword, "slug" | "title">,
  cluster: SeoCluster,
  cfg: Pick<SeoConfig, "clusters">,
): string {
  if (!html) return html;
  const block = buildRelatedArticlesHtml(kw, cluster, cfg);
  if (/class=["'][^"']*related-articles/i.test(html)) {
    return html.replace(
      /<div\s+class=["'][^"']*related-articles[^"']*["'][^>]*>[\s\S]*?<div\s+class=["'][^"']*related-grid[^"']*["'][^>]*>[\s\S]*?<\/div>\s*<\/div>/i,
      block || "",
    );
  }
  if (!block) return html;
  if (/<\/main>/i.test(html)) return html.replace(/<\/main>/i, `${block}\n</main>`);
  if (/<aside\s+class=["']sidebar["']/i.test(html)) {
    return html.replace(/<aside\s+class=["']sidebar["']/i, `${block}\n<aside class="sidebar"`);
  }
  // Inner article fragment (no page chrome) — append after FAQ / body
  return `${html.trim()}\n${block}`;
}
