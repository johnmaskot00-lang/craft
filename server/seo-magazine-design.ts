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

export const SEO_HOME_FEED_PAGE_SIZE = 12;

export function collectSeoArticleBriefs(cfg: SeoConfig, limit = 500): SeoArticleBrief[] {
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
  tasteBrief?: string;
}): string {
  const { cfg, heroVariant, articles, logoUrl, tasteBrief } = opts;
  const cats = cfg.clusters.map((c) => ({
    name: c.name,
    slug: c.slug,
    href: `/${c.slug}/`,
    description: c.description,
    count: c.keywords.filter((k) => k.status === "done").length,
  }));
  const feedPreview = articles.slice(0, 16);

  return `You are a principal UI/UX art director for a premium digital WEB MAGAZINE (Russian language UI).
Create a COMPLETE unique homepage + stylesheet — the same ownership model as a custom multipage site:
YOU invent the menu, fonts, colors, density and chrome. The server must NOT look like a shared template.

CRITICAL UNIQUENESS (like Craft multipage «по описанию»):
- Invent a DISTINCT visual system for THIS niche only — custom masthead/menu treatment, not a generic sticky dark bar with cyan pills.
- Forbidden sameness: identical glass sticky header, identical 3-column dark cards, identical cyan round CTA — if it could belong to another SEO site after swapping the logo, redesign it.
- Menu may be: editorial masthead, underline tabs, numbered index, side rail, stacked brand+links, oversized type nav — YOUR choice matching the niche.
- Typography must be expressive Cyrillic Google Fonts pair unique to this brief (avoid Inter/Roboto/Arial; avoid repeating Onest+same cyan every time).

PUBLICATION
- Brand / H1: ${JSON.stringify(cfg.siteTitle)}
- Niche: ${JSON.stringify(cfg.niche)}
- Description: ${JSON.stringify(cfg.siteDescription)}
- Logo URL (optional <img>): ${logoUrl ? JSON.stringify(logoUrl) : "(text mark OK)"}
- OWNER OFFER URL (header CTA + every article recommends this — never invent another): ${cfg.targetUrl ? JSON.stringify(cfg.targetUrl) : "(none — omit partner CTA)"}
- CTA label: ${JSON.stringify(cfg.ctaLabel || "Подробнее")}
- Niche / product to promote in chrome: ${JSON.stringify(cfg.niche || "")}

ASSIGNED HERO ARCHETYPE (build THIS interactive hero — invent the visual language):
${heroVariantDescription(heroVariant)}

OTHER HERO ARCHETYPES (do NOT copy them; your site uses only "${heroVariant}"):
${SEO_HERO_VARIANTS.map((v, i) => `${i + 1}. ${v}`).join("\n")}

${tasteBrief ? `TASTE / DESIGN REFERENCES (absorb principles, do NOT copy layouts verbatim):\n${tasteBrief.slice(0, 14000)}\n` : ""}

REAL ARTICLES (sample for hero + first feed page — server injects the full paginated feed):
${JSON.stringify(feedPreview, null, 2)}

CATEGORIES:
${JSON.stringify(cats, null, 2)}

CREATIVE MANDATE
1. Invent typography, palette, density, motion for THIS niche. Living backgrounds OK — keep text WCAG-readable.
2. Quality bar: best digital magazines, ORIGINAL for this niche.
3. Interactive Hero is the star. Brand name + short description MUST appear in/near the hero.
4. Below hero: magazine-grade topics + article feed (not a dump of plain boxes).
5. Article feed contract (CRITICAL — server refreshes + paginates):
   - Exactly ONE wrapper: <div data-seo-article-feed data-page-size="12" class="articles-grid">...</div>
   - Put article-cards ONLY inside that wrapper — never duplicate cards outside it
   - COMPACT GRID ONLY: 4 equal cards per row (photo on top + title below). NO full-bleed mega-cards, NO featured span-8/12, NO single huge cover card in the feed.
   - Include up to 12 sample compact cards now; server replaces with ALL articles + client-side pager (12/page, 4 columns)
   - FORBIDDEN: invent /page/2/ URLs or separate pagination HTML files — pager is in-place buttons only
   - Each card: <a class="article-card" href="..."> with .ac-img-wrap (16:10 photo) / .ac-title / optional short .ac-cat — keep cards equal height, modest image height (~140–180px)
6. Sticky top chrome MUST be <header class="site-header"> with brand + <nav> category links + optional CTA.
   Server COPIES this entire <header> onto category/article pages — it must look finished on every page.
7. Footer with niche line + category links.
8. Inline <script> for hero interactivity (Google Fonts CDN OK; no other JS CDNs).
9. GEO in <head>: charset, viewport, title, description, canonical "/", og, llms.txt alternate, JSON-LD.
10. link stylesheet exactly: href="/assets/style.css"
11. body class must include: structure-v2 art-directed hero-${heroVariant}
12. Mobile-first. No horizontal scroll. No decorative SVG animations instead of photos.
13. Do NOT invent article URLs — only REAL ARTICLES / CATEGORIES hrefs.

FULL-SITE CSS (mandatory — YOU style every page type; do not leave articles as unstyled black text):
Define CSS variables (--bg --text --text2 --muted --brand --border --heading-font --body-font --r --w) and style:
- .site-header and ALL menu/brand/CTA variants you invented
- topic hubs, .articles-grid, .article-card, .ac-*, .seo-feed-pager
- .article-page, .article-layout, .article-header, .article-body, .breadcrumb, .cat-header
- .sidebar, .related-articles, .faq-*, .key-takeaways, .callout, .author-box, footer
Article/category pages share the SAME magazine system as home.

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

/** Safety net + forced compact home feed (4×3) + readable offers — chrome/menu stays agent-owned. */
export function buildSoftMagazineGuardCss(): string {
  return `
/* structural-guard-v11 — compact feed 4-col + offer + article readability */
html,body{overflow-x:hidden!important;max-width:100%!important}
img,video,canvas,svg{max-width:100%;height:auto}
.cta-block{display:none!important}
.on-media{color:#fff!important;text-shadow:0 1px 2px rgba(0,0,0,.45)}
.article-page{max-width:var(--w,1120px);margin:0 auto;padding:0 1.25rem 4rem;box-sizing:border-box}
.article-layout{display:grid;grid-template-columns:minmax(0,1fr) minmax(200px,280px);gap:clamp(1.25rem,3vw,2rem);align-items:start}
.article-layout-sidebar-left{grid-template-columns:minmax(200px,280px) minmax(0,1fr)}
.article-layout-single,.article-layout-full{grid-template-columns:minmax(0,1fr)}
.article-main{min-width:0}
.article-body{font-size:clamp(17px,1.05vw,19px);line-height:1.75;max-width:72ch}
.article-body .lead{font-size:1.1em;line-height:1.65}
.breadcrumb{display:flex;flex-wrap:wrap;gap:.35rem;align-items:center;padding:.75rem 0;font-size:.78rem}
.hero-article-img{width:100%;max-height:min(520px,58vw);object-fit:cover;display:block;border-radius:var(--r,12px);margin:0 0 1.25rem}

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
  border-radius:var(--r,14px)!important;
  border:1px solid var(--border,rgba(255,255,255,.12))!important;
  background:color-mix(in srgb,var(--bg2,var(--bg,#111)) 92%,transparent)!important;
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
}
@media(max-width:420px){[data-seo-article-feed]{grid-template-columns:1fr!important}}
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

/** Find start index of the matching '</div>' for a div that opened ending at openTagEnd. */
export function findMatchingDivClose(html: string, openTagEnd: number): number {
  let depth = 1;
  let i = openTagEnd;
  while (i < html.length) {
    const nextLt = html.indexOf("<", i);
    if (nextLt < 0) return -1;
    const rest = html.slice(nextLt);
    if (/^<\/div\b/i.test(rest) || /^<\/\s*div\s*>/i.test(rest)) {
      depth -= 1;
      if (depth === 0) return nextLt;
      const gt = html.indexOf(">", nextLt);
      i = gt < 0 ? html.length : gt + 1;
      continue;
    }
    // Match opening <div ...> (not </div>)
    if (rest.length >= 4 && rest.slice(0, 4).toLowerCase() === "<div" && (rest[4] === " " || rest[4] === ">" || rest[4] === "\t" || rest[4] === "\n" || rest[4] === "\r")) {
      depth += 1;
      const gt = html.indexOf(">", nextLt);
      i = gt < 0 ? html.length : gt + 1;
      continue;
    }
    i = nextLt + 1;
  }
  return -1;
}

/** Replace inner HTML of the first data-seo-article-feed wrapper (handles nested divs). */
export function replaceSeoArticleFeedInner(homeHtml: string, newInner: string): string | null {
  if (!homeHtml) return null;
  const openRe = /<([^>]*\bdata-seo-article-feed\b[^>]*)>/i;
  const m = openRe.exec(homeHtml);
  if (!m) return null;
  const openEnd = m.index + m[0].length;
  const closeStart = findMatchingDivClose(homeHtml, openEnd);
  if (closeStart < 0) return null;
  return `${homeHtml.slice(0, openEnd)}\n${newInner}\n${homeHtml.slice(closeStart)}`;
}

/** Extract full outer HTML of the first data-seo-article-feed block. */
export function extractSeoArticleFeedBlock(homeHtml: string): { block: string; start: number; end: number } | null {
  const openRe = /<([^>]*\bdata-seo-article-feed\b[^>]*)>/i;
  const m = openRe.exec(homeHtml);
  if (!m) return null;
  const openEnd = m.index + m[0].length;
  const closeStart = findMatchingDivClose(homeHtml, openEnd);
  if (closeStart < 0) return null;
  const closeMatch = homeHtml.slice(closeStart).match(/^<\/\s*div\s*>/i);
  if (!closeMatch) return null;
  const end = closeStart + closeMatch[0].length;
  return { block: homeHtml.slice(m.index, end), start: m.index, end };
}

/** Remove duplicate article-card dumps outside the single data-seo-article-feed region. */
export function stripOrphanHomeArticleCards(homeHtml: string): string {
  if (!homeHtml) return homeHtml;
  const extracted = extractSeoArticleFeedBlock(homeHtml);
  let html = homeHtml;
  let slot = "";
  if (extracted) {
    slot = "<!--SEO_FEED_SLOT_0-->";
    html = homeHtml.slice(0, extracted.start) + slot + homeHtml.slice(extracted.end);
  }
  html = html.replace(/<!--\s*Main Editorial Feed[\s\S]*?-->/gi, "");
  // Drop agent-made /page/N/ pagination shells (we use client-side pager only).
  html = html.replace(/<a\b[^>]*\bhref=["']\/page\/\d+\/?["'][^>]*>[\s\S]*?<\/a>/gi, "");
  html = html.replace(/<nav\b[^>]*\bclass=["'][^"']*\b(?:pagination|pager|pages)\b[^"']*["'][^>]*>[\s\S]*?<\/nav>/gi, "");
  html = html.replace(/<a\b[^>]*\bclass=["'][^"']*\barticle-card\b[^"']*["'][^>]*>[\s\S]*?<\/a>/gi, "");
  // Also catch cards with class before other attrs
  html = html.replace(/<a\b[^>]*\barticle-card\b[^>]*>[\s\S]*?<\/a>/gi, "");
  if (extracted) {
    html = html.replace(slot, extracted.block);
  }
  return html;
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
    cards.forEach(function(c,i){c.hidden=!(i>=start&&i<start+size);});
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
  // Drop previous pager+script so refresh stays idempotent
  html = html.replace(/<nav[^>]*\bdata-seo-feed-pager\b[^>]*>[\s\S]*?<\/nav>\s*/gi, "");
  html = html.replace(/<script[^>]*\bdata-seo-feed-pager-script\b[^>]*>[\s\S]*?<\/script>\s*/gi, "");
  html = html.replace(/<script>\s*\(function\(\)\{\s*var size=\d+;[\s\S]*?data-seo-article-feed[\s\S]*?<\/script>\s*/gi, "");
  // Kill broken agent /page/N/ navigations
  html = html.replace(/<a\b[^>]*\bhref=["']\/page\/\d+\/?["'][^>]*>[\s\S]*?<\/a>/gi, "");
  const pager = buildHomeFeedPagerBlock(pageSize);
  const feedBlock = extractSeoArticleFeedBlock(html);
  if (feedBlock) {
    html = html.slice(0, feedBlock.end) + `\n${pager}\n` + html.slice(feedBlock.end);
  }
  return html;
}

export function patchHomeArticleFeed(homeHtml: string, articles: SeoArticleBrief[]): string {
  if (!homeHtml || articles.length === 0) return homeHtml;
  let html = stripOrphanHomeArticleCards(homeHtml);
  const feed = refreshArticleFeedHtml(articles);
  if (/data-seo-article-feed/i.test(html)) {
    // Normalize wrapper: drop featured/span mega-card classes from agent HTML
    html = html.replace(
      /<([^>]*\bdata-seo-article-feed\b)([^>]*)>/i,
      (_m, start: string, rest: string) => {
        let attrs = `${start}${rest}`;
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
    if (next) html = next;
  } else {
    const section = `<section class="container section-latest"><div class="section-headline-bar"><h2 class="section-title">Материалы</h2></div><div data-seo-article-feed data-page-size="${SEO_HOME_FEED_PAGE_SIZE}" class="articles-grid">\n${feed}\n</div></section>`;
    if (/<footer[\s\S]*?<\/footer>/i.test(html)) {
      html = html.replace(/<footer[\s\S]*?<\/footer>/i, `${section}\n$&`);
    } else {
      html = `${html}\n${section}`;
    }
  }
  html = stripOrphanHomeArticleCards(html);
  return ensureHomeFeedPager(html, SEO_HOME_FEED_PAGE_SIZE);
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
