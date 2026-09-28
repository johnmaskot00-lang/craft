/**
 * Единая тема сайта для всех интерактивных hero-режимов
 * (parallax / split / action / motion / trigger / artdirector / immersion /
 * site3d / animational).
 *
 * Раньше каждый билдер хардкодил Syne + Manrope и свои цвета. У Syne нет
 * кириллицы, поэтому русский заголовок падал в system-ui — и во всех hero
 * был один и тот же шрифт независимо от тематики сайта.
 *
 * Тема выводится из:
 *   1) ниши сайта (тексты hero + бриф видео + title страницы),
 *   2) CSS уже сгенерированной страницы (:root-переменные, body, шрифты),
 * и всегда даёт шрифты с кириллицей.
 */

import { GF_CYRILLIC_RAW } from "./google-fonts-cyrillic";

export type SiteTheme = {
  niche: string;
  /** font-family стек заголовков. */
  display: string;
  /** font-family стек текста. */
  body: string;
  /** URL Google Fonts (может быть пустым). */
  importUrl: string;
  displayWeight: number;
  displayTracking: string;
  displayTransform: string;
  /** Множитель размера заголовка: широкие гротески крупнее на вид. */
  displayScale: number;
  bg: string;
  ink: string;
  muted: string;
  accent: string;
  accent2: string;
  card: string;
  dark: boolean;
};

type Palette = Pick<SiteTheme, "bg" | "ink" | "muted" | "accent" | "accent2" | "card" | "dark">;

type FontPair = { display: string; body: string };

type Niche = { id: string; re: RegExp; fonts: FontPair[]; palettes: Palette[] };

// ── Шрифты ────────────────────────────────────────────────────────────────

type FontInfo = {
  /** Оси для css2 API. Пусто = у шрифта один вес. */
  axes: string;
  /** Вес заголовка, который реально есть у шрифта. */
  weight: number;
  serif?: boolean;
  tracking?: string;
  transform?: string;
  scale?: number;
};

/** Только шрифты Google Fonts с кириллицей и существующими весами. */
const FONTS: Record<string, FontInfo> = {
  Unbounded: { axes: "wght@400;500;600;700;800", weight: 700, tracking: "-0.035em", scale: 0.9 },
  Onest: { axes: "wght@400;500;600;700;800", weight: 700, tracking: "-0.03em" },
  "Golos Text": { axes: "wght@400;500;600;700;800", weight: 700, tracking: "-0.025em" },
  Manrope: { axes: "wght@400;500;600;700;800", weight: 800, tracking: "-0.03em" },
  "Cormorant Garamond": { axes: "wght@500;600;700", weight: 700, serif: true, tracking: "-0.01em", scale: 1.14 },
  "Playfair Display": { axes: "wght@500;600;700;800", weight: 700, serif: true, tracking: "-0.02em" },
  "Russo One": { axes: "", weight: 400, tracking: "-0.01em", scale: 0.95 },
  Oswald: { axes: "wght@400;500;600;700", weight: 600, tracking: "-0.005em", transform: "uppercase", scale: 1.05 },
  "Rubik Mono One": { axes: "", weight: 400, tracking: "-0.04em", scale: 0.78 },
  "Dela Gothic One": { axes: "", weight: 400, tracking: "-0.02em", scale: 0.9 },
  "Montserrat Alternates": { axes: "wght@400;500;600;700;800", weight: 700, tracking: "-0.03em", scale: 0.95 },
  Montserrat: { axes: "wght@400;500;600;700;800", weight: 700, tracking: "-0.03em" },
  "Tenor Sans": { axes: "", weight: 400, tracking: "0.01em" },
  Forum: { axes: "", weight: 400, serif: true, tracking: "0.01em", scale: 1.08 },
  "Yeseva One": { axes: "", weight: 400, serif: true, tracking: "0" },
  Comfortaa: { axes: "wght@400;500;600;700", weight: 700, tracking: "-0.02em", scale: 0.95 },
  Nunito: { axes: "wght@400;500;600;700;800", weight: 800, tracking: "-0.02em" },
  Prata: { axes: "", weight: 400, serif: true, tracking: "-0.01em" },
  Lora: { axes: "wght@400;500;600;700", weight: 700, serif: true, tracking: "-0.01em" },
  "PT Serif": { axes: "wght@400;700", weight: 700, serif: true, tracking: "-0.01em" },
  "PT Sans": { axes: "wght@400;700", weight: 700, tracking: "-0.01em" },
  Jost: { axes: "wght@400;500;600;700;800", weight: 600, tracking: "-0.02em" },
  "Exo 2": { axes: "wght@400;500;600;700;800", weight: 700, tracking: "-0.02em" },
  "Press Start 2P": { axes: "", weight: 400, tracking: "0", scale: 0.6 },
  "Bad Script": { axes: "", weight: 400, tracking: "0", scale: 1.05 },
  Caveat: { axes: "wght@400;500;600;700", weight: 700, tracking: "0", scale: 1.25 },
  Rubik: { axes: "wght@400;500;600;700;800", weight: 700, tracking: "-0.025em" },
};

/** Популярные у LLM шрифты без кириллицы — в заголовок их брать нельзя. */
const NO_CYRILLIC =
  /^(fraunces|bebas neue|syne|dm serif display|dm serif text|source sans 3|source sans pro|instrument serif|instrument sans|dm sans|space grotesk|clash display|satoshi|archivo|archivo black|epilogue|outfit|plus jakarta sans|work sans|libre franklin|bricolage grotesque|anton|league spartan|sora|lexend|poppins|righteous|abril fatface|big shoulders display|chivo|urbanist|general sans|cabinet grotesk|zodiak|gambetta|boska|switzer)$/i;

/** Текстовые шрифты: их не берём как «шрифт заголовка» страницы. */
const BODY_FONTS = /^(manrope|onest|golos text|rubik|nunito|montserrat|pt sans|jost|inter|roboto|open sans|noto sans|ibm plex sans|source sans 3)$/i;

const SANS = "system-ui,-apple-system,'Segoe UI',Roboto,sans-serif";
const SERIF = "Georgia,'Times New Roman',serif";

function clean(family: string): string {
  return family.trim().replace(/^['"]+|['"]+$/g, "").trim();
}

export function fontHasCyrillic(family: string): boolean {
  const name = clean(family);
  return !!name && !NO_CYRILLIC.test(name) && !!knownFont(name);
}

// ── Полный каталог Google Fonts с кириллицей ─────────────────────────────
// Агент сам выбирает шрифт под тему сайта из всего каталога, а тема hero
// подхватывает его. FONTS выше — только ручная настройка метрик и запасные
// пары для случаев, когда страницы ещё нет.

type CatalogFont = { family: string; cat: "s" | "r" | "d" | "h" | "m"; weights: number[]; variable: boolean };

const CATALOG: Map<string, CatalogFont> = new Map(
  GF_CYRILLIC_RAW.split("\n")
    .map((line): CatalogFont | null => {
      const [family, cat, w, v] = line.split("|");
      if (!family || !w) return null;
      return { family, cat: (cat || "s") as CatalogFont["cat"], weights: w.split(",").map(Number), variable: v === "1" };
    })
    .filter((f): f is CatalogFont => !!f)
    .map((f) => [f.family.toLowerCase(), f]),
);

const infoCache = new Map<string, FontInfo>();

/** Метрики шрифта: ручные для FONTS, выведенные из каталога — для остальных. */
function fontInfo(family: string): FontInfo | undefined {
  if (FONTS[family]) return FONTS[family];
  const cached = infoCache.get(family);
  if (cached) return cached;
  const c = CATALOG.get(family.toLowerCase());
  if (!c) return undefined;
  const ws = c.weights;
  const pick = (pref: number[]) => pref.find((w) => ws.includes(w));
  const weight = pick([700, 800, 600, 900, 500, 400]) ?? ws[ws.length - 1];
  const axisWeights = ws.filter((w) => w >= 400 && w <= 800);
  const info: FontInfo = {
    axes: ws.length > 1 ? `wght@${(axisWeights.length ? axisWeights : ws).join(";")}` : "",
    weight: ws.length > 1 ? weight : ws[0],
    serif: c.cat === "r",
    tracking: c.cat === "h" ? "0" : c.cat === "r" ? "-0.01em" : "-0.02em",
    scale: c.cat === "h" ? 1.15 : 1,
  };
  infoCache.set(family, info);
  return info;
}

function knownFont(family: string): string | null {
  const name = clean(family).toLowerCase();
  if (!name) return null;
  const manual = Object.keys(FONTS).find((k) => k.toLowerCase() === name);
  return manual || CATALOG.get(name)?.family || null;
}

function fontStack(family: string): string {
  const c = CATALOG.get(family.toLowerCase());
  const fallback = fontInfo(family)?.serif ? SERIF : c?.cat === "h" ? `cursive,${SANS}` : c?.cat === "m" ? `ui-monospace,monospace` : SANS;
  return `'${family}',${fallback}`;
}

function gfUrl(families: string[]): string {
  const uniq = families.filter((fam, i) => fam && families.indexOf(fam) === i && fontInfo(fam));
  if (!uniq.length) return "";
  const q = uniq
    .map((fam) => {
      const axes = fontInfo(fam)!.axes;
      return `family=${fam.replace(/ /g, "+")}${axes ? `:${axes}` : ""}`;
    })
    .join("&");
  return `https://fonts.googleapis.com/css2?${q}&display=swap`;
}

// ── Палитры ───────────────────────────────────────────────────────────────

const P_DARK: Palette = { bg: "#07080c", ink: "#ffffff", muted: "rgba(255,255,255,0.84)", accent: "#a78bfa", accent2: "#60a5fa", card: "rgba(255,255,255,0.06)", dark: true };
const P_NEON: Palette = { bg: "#08060f", ink: "#ffffff", muted: "rgba(255,255,255,0.82)", accent: "#ff2ecc", accent2: "#22d3ee", card: "rgba(255,255,255,0.06)", dark: true };
const P_ACID: Palette = { bg: "#0b0b0d", ink: "#f4f4f0", muted: "rgba(244,244,240,0.8)", accent: "#c6ff3d", accent2: "#ff4d8d", card: "rgba(255,255,255,0.06)", dark: true };
const P_LOFT: Palette = { bg: "#0e1116", ink: "#e8edf2", muted: "rgba(232,237,242,0.8)", accent: "#d4ff4f", accent2: "#7dd3fc", card: "rgba(255,255,255,0.06)", dark: true };
const P_CORP: Palette = { bg: "#0b1220", ink: "#f5f8ff", muted: "rgba(245,248,255,0.8)", accent: "#4f8cff", accent2: "#22d3ee", card: "rgba(255,255,255,0.06)", dark: true };
const P_MINT: Palette = { bg: "#050608", ink: "#eaf2ff", muted: "rgba(234,242,255,0.78)", accent: "#00e5a0", accent2: "#7dd3fc", card: "rgba(255,255,255,0.06)", dark: true };
const P_GOLD: Palette = { bg: "#0c0b09", ink: "#f6f1e6", muted: "rgba(246,241,230,0.8)", accent: "#c9a227", accent2: "#e8d9a8", card: "rgba(255,255,255,0.06)", dark: true };
const P_BRONZE: Palette = { bg: "#141210", ink: "#f3ede2", muted: "rgba(243,237,226,0.78)", accent: "#b08d57", accent2: "#8a9a76", card: "rgba(255,255,255,0.05)", dark: true };
const P_NOIR: Palette = { bg: "#0a0a0a", ink: "#f5f5f5", muted: "rgba(245,245,245,0.78)", accent: "#e5e5e5", accent2: "#b08d57", card: "rgba(255,255,255,0.06)", dark: true };
const P_EMBER: Palette = { bg: "#1a1009", ink: "#f8efe3", muted: "rgba(248,239,227,0.8)", accent: "#e0762f", accent2: "#c9a227", card: "rgba(255,255,255,0.06)", dark: true };
const P_FOREST: Palette = { bg: "#0d1410", ink: "#f2f0e8", muted: "rgba(242,240,232,0.82)", accent: "#8fbf6a", accent2: "#d9c98a", card: "rgba(255,255,255,0.06)", dark: true };
const P_STEEL: Palette = { bg: "#12161a", ink: "#eef2f5", muted: "rgba(238,242,245,0.78)", accent: "#f0a500", accent2: "#5aa9e6", card: "rgba(255,255,255,0.06)", dark: true };
const P_RACE: Palette = { bg: "#0a0b0d", ink: "#f0f2f5", muted: "rgba(240,242,245,0.76)", accent: "#ff3b30", accent2: "#8fa3b8", card: "rgba(255,255,255,0.06)", dark: true };
const P_GYM: Palette = { bg: "#12100e", ink: "#f2f0ea", muted: "rgba(242,240,234,0.78)", accent: "#ff5a1f", accent2: "#facc15", card: "rgba(255,255,255,0.06)", dark: true };
const P_NAVY: Palette = { bg: "#101827", ink: "#eef2f8", muted: "rgba(238,242,248,0.78)", accent: "#c9a227", accent2: "#5a7fb0", card: "rgba(255,255,255,0.06)", dark: true };
const P_LAGOON: Palette = { bg: "#06222b", ink: "#f2fbfd", muted: "rgba(242,251,253,0.8)", accent: "#22c1c3", accent2: "#f6c177", card: "rgba(255,255,255,0.06)", dark: true };
const P_PLUM: Palette = { bg: "#151014", ink: "#f6eef1", muted: "rgba(246,238,241,0.78)", accent: "#d98ba0", accent2: "#c9a227", card: "rgba(255,255,255,0.06)", dark: true };
const P_CREAM: Palette = { bg: "#f4efe7", ink: "#1d1a16", muted: "#6a6258", accent: "#8b7355", accent2: "#6b7c8f", card: "rgba(29,26,22,0.05)", dark: false };
const P_WARM: Palette = { bg: "#f7f2ea", ink: "#241a12", muted: "#6b5c4c", accent: "#b4551f", accent2: "#8a6b3f", card: "rgba(36,26,18,0.05)", dark: false };
const P_LIGHT: Palette = { bg: "#f6f7f9", ink: "#14171f", muted: "#525a6b", accent: "#2f6b4f", accent2: "#3b6ea8", card: "rgba(20,23,31,0.05)", dark: false };
const P_CLINIC: Palette = { bg: "#f4f8fb", ink: "#0f2233", muted: "#4c6478", accent: "#1785c4", accent2: "#39b6a3", card: "rgba(15,34,51,0.05)", dark: false };
const P_BEAUTY: Palette = { bg: "#fbf3f1", ink: "#2b1c20", muted: "#7a6167", accent: "#c96a7a", accent2: "#b99a6b", card: "rgba(43,28,32,0.05)", dark: false };
const P_SUNNY: Palette = { bg: "#fff7ec", ink: "#2b2118", muted: "#6f6053", accent: "#f59e0b", accent2: "#4ecdc4", card: "rgba(43,33,24,0.05)", dark: false };

// ── Ниши ──────────────────────────────────────────────────────────────────
// В JS `\b` не работает с кириллицей, поэтому границы слова — через lookaround.
const L = "(?<![а-яёa-z])";
const R = "(?![а-яёa-z])";

const fp = (display: string, body: string): FontPair => ({ display, body });

const NICHES: Niche[] = [
  {
    id: "dance",
    re: new RegExp(`(танц|ритм|хореограф|балет|${L}клуб|диджей|${L}dj${R}|музык|вечерин|баттл|концерт|hip[- ]?hop|брейк|dance|music|nightlife|рейв|${L}rave${R})`, "g"),
    fonts: [fp("Dela Gothic One", "Golos Text"), fp("Rubik Mono One", "Rubik"), fp("Dela Gothic One", "Onest")],
    palettes: [P_NEON, P_ACID],
  },
  {
    id: "gaming",
    re: new RegExp(`(${L}игров|${L}гейм|киберспорт|esport|gaming|${L}game${R}|${L}квест|пиксел|стрим)`, "g"),
    fonts: [fp("Russo One", "Exo 2"), fp("Press Start 2P", "Rubik"), fp("Unbounded", "Onest")],
    palettes: [P_NEON, P_MINT, P_LOFT],
  },
  {
    id: "kids",
    re: new RegExp(`(${L}дет[иейскяо]|ребён|ребен|малыш|игруш|развивающ|${L}детсад|${L}kids${R}|${L}child)`, "g"),
    fonts: [fp("Comfortaa", "Nunito"), fp("Yeseva One", "Nunito"), fp("Montserrat Alternates", "Nunito")],
    palettes: [P_SUNNY, P_CREAM, P_BEAUTY],
  },
  {
    id: "luxury",
    re: new RegExp(`(ювелир|бриллиант|премиал|премиум|${L}элит|luxury|${L}часы${R}|парфюм|бутик|${L}вилл[аы]|${L}яхт|haute)`, "g"),
    fonts: [fp("Cormorant Garamond", "Manrope"), fp("Prata", "Jost"), fp("Forum", "Montserrat")],
    palettes: [P_GOLD, P_BRONZE, P_CREAM],
  },
  {
    id: "fashion",
    re: new RegExp(`(${L}мод[аыуе]${R}|одежд|коллекци|подиум|fashion|atelier|ателье|лукбук|showroom|шоурум)`, "g"),
    fonts: [fp("Prata", "Jost"), fp("Tenor Sans", "Jost"), fp("Montserrat Alternates", "Montserrat")],
    palettes: [P_CREAM, P_NOIR, P_BEAUTY],
  },
  {
    id: "food",
    re: new RegExp(`(ресторан|${L}шеф|${L}кухн|${L}кофе|кофейн|${L}кафе${R}|${L}еда${R}|${L}вин[оа]${R}|пицц|${L}суши|пекарн|кондитер|${L}бар${R}|бургер|стейк|brunch|coffee|restaurant|${L}food${R}|bakery|гастро)`, "g"),
    fonts: [fp("Playfair Display", "Golos Text"), fp("Yeseva One", "Nunito"), fp("Lora", "Nunito")],
    palettes: [P_EMBER, P_WARM, P_CREAM],
  },
  {
    id: "tech",
    re: new RegExp(`(${L}ai${R}|${L}ии${R}|нейросет|технолог|${L}it${R}|digital|стартап|startup|${L}saas${R}|${L}софт|разработ|платформ|${L}cloud|${L}data${R}|кибер|робот|${L}robot|автоматизац|${L}crm${R}|${L}api${R})`, "g"),
    fonts: [fp("Exo 2", "Onest"), fp("Onest", "Golos Text"), fp("Unbounded", "Onest")],
    palettes: [P_CORP, P_MINT, P_LOFT],
  },
  {
    id: "sport",
    re: new RegExp(`(${L}спорт|фитнес|трениров|кроссфит|${L}бег${R}|${L}бокс|единоборств|${L}gym${R}|fitness|crossfit|${L}mma${R}|бассейн|тренаж)`, "g"),
    fonts: [fp("Oswald", "Golos Text"), fp("Russo One", "Jost"), fp("Oswald", "Manrope")],
    palettes: [P_GYM, P_LOFT, P_RACE],
  },
  {
    id: "beauty",
    re: new RegExp(`(${L}салон|бьюти|красот|космет|маникюр|${L}ногт|ресниц|${L}бров|массаж|${L}spa${R}|${L}спа${R}|барбер|парикмахер|beauty|эпиляц|уход за)`, "g"),
    fonts: [fp("Yeseva One", "Nunito"), fp("Cormorant Garamond", "Manrope"), fp("Prata", "Jost")],
    palettes: [P_BEAUTY, P_CREAM, P_PLUM],
  },
  {
    id: "medical",
    re: new RegExp(`(клиник|${L}врач|стомат|здоровь|медицин|диагност|анализ|аптек|clinic|health|medical|dental|лечени)`, "g"),
    fonts: [fp("Onest", "Golos Text"), fp("Golos Text", "Onest"), fp("Montserrat Alternates", "Montserrat")],
    palettes: [P_CLINIC, P_LIGHT, P_CORP],
  },
  {
    id: "build",
    re: new RegExp(`(${L}строит|${L}стро[йе]|ремонт|монтаж|бетон|кровл|фасад|инженерн|застройщ|недвижим|квартир|новостро|construction|${L}build|real[- ]?estate|интерьер)`, "g"),
    fonts: [fp("Onest", "Golos Text"), fp("Oswald", "Golos Text"), fp("Exo 2", "Onest")],
    palettes: [P_STEEL, P_LIGHT, P_LOFT],
  },
  {
    id: "auto",
    re: new RegExp(`(${L}авто|${L}шин${R}|шиномонт|кузов|детейлинг|${L}мото|${L}car${R}|${L}auto${R}|detailing|тюнинг)`, "g"),
    fonts: [fp("Exo 2", "Onest"), fp("Russo One", "Jost"), fp("Oswald", "Onest")],
    palettes: [P_RACE, P_LOFT, P_DARK],
  },
  {
    id: "eco",
    re: new RegExp(`(${L}эко(?!ном)|природ|${L}сад${R}|${L}ферм|органик|устойчив|растени|ландшафт|${L}eco${R}|organic|garden|${L}farm|${L}green${R}|${L}цвет[ыо]|флорист)`, "g"),
    fonts: [fp("Cormorant Garamond", "Manrope"), fp("Forum", "Jost"), fp("Tenor Sans", "Jost")],
    palettes: [P_FOREST, P_CREAM, P_LIGHT],
  },
  {
    id: "education",
    re: new RegExp(`(${L}школ|${L}курс|обучен|образован|репетитор|университет|колледж|студент|лекци|education|school|course|academy|академи)`, "g"),
    fonts: [fp("Onest", "Golos Text"), fp("Playfair Display", "Golos Text"), fp("Montserrat Alternates", "Montserrat")],
    palettes: [P_LIGHT, P_CORP, P_CREAM],
  },
  {
    id: "law",
    re: new RegExp(`(юрист|юридич|правов|арбитраж|${L}прав[оа]${R}|адвокат|нотариус|бухгалт|аудит|${L}банк|финанс|инвест|страхов|налог|${L}law${R}|legal|finance|${L}bank)`, "g"),
    fonts: [fp("Forum", "Montserrat"), fp("Prata", "Jost"), fp("Onest", "Golos Text")],
    palettes: [P_NAVY, P_LIGHT, P_GOLD],
  },
  {
    id: "travel",
    re: new RegExp(`(${L}тур${R}|${L}туры|туризм|путешеств|${L}отел|гостиниц|курорт|экскурс|${L}море${R}|${L}отдых|travel|${L}tour|hotel|resort|глэмпинг|кемпинг)`, "g"),
    fonts: [fp("Tenor Sans", "Jost"), fp("Prata", "Jost"), fp("Yeseva One", "Nunito")],
    palettes: [P_LAGOON, P_CREAM, P_WARM],
  },
  {
    id: "photo",
    re: new RegExp(`(${L}фото|съёмк|съемк|видеограф|галере|художник|${L}арт${R}|${L}art${R}|${L}photo|gallery|выставк|${L}музе)`, "g"),
    fonts: [fp("Prata", "Jost"), fp("Tenor Sans", "Jost"), fp("Montserrat Alternates", "Montserrat")],
    palettes: [P_NOIR, P_CREAM, P_BEAUTY],
  },
  {
    id: "wedding",
    re: new RegExp(`(свадьб|свадеб|венчан|торжеств|банкет|wedding|bridal)`, "g"),
    fonts: [fp("Cormorant Garamond", "Manrope"), fp("Forum", "Jost"), fp("Bad Script", "Manrope")],
    palettes: [P_CREAM, P_BEAUTY, P_GOLD],
  },
  {
    id: "pets",
    re: new RegExp(`(${L}зоо|ветеринар|питомц|${L}собак|${L}кош[кеа]|груминг|${L}pet${R}|${L}vet${R})`, "g"),
    fonts: [fp("Comfortaa", "Nunito"), fp("Yeseva One", "Nunito"), fp("Onest", "Golos Text")],
    palettes: [P_SUNNY, P_CREAM, P_FOREST],
  },
  {
    id: "coaching",
    re: new RegExp(`(${L}коуч|психолог|${L}терап|консульт|наставни|${L}йог|медитац|${L}coach|therapy|${L}yoga${R}|ретрит)`, "g"),
    fonts: [fp("Cormorant Garamond", "Manrope"), fp("Onest", "Golos Text"), fp("Comfortaa", "Nunito")],
    palettes: [P_CREAM, P_FOREST, P_LIGHT],
  },
];

const DEFAULT_FONTS: FontPair[] = [fp("Onest", "Golos Text"), fp("Manrope", "Onest"), fp("Playfair Display", "Golos Text")];
const DEFAULT_PALETTES: Palette[] = [P_DARK, P_CORP, P_CREAM];

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function pickNiche(copy: string): Niche | null {
  let best: Niche | null = null;
  let bestScore = 0;
  for (const n of NICHES) {
    const score = (copy.match(n.re) || []).length;
    // Строгое «>»: при равенстве выигрывает ниша выше в списке.
    if (score > bestScore) {
      best = n;
      bestScore = score;
    }
  }
  return best;
}

// ── Цвета ─────────────────────────────────────────────────────────────────

function normColor(v: string | undefined | null): string | null {
  if (!v) return null;
  const s = v.trim().replace(/\s*!important$/i, "");
  if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(s)) return s;
  if (/^#[0-9a-f]{8}$/i.test(s)) return s.slice(0, 7);
  if (/^rgba?\(\s*[\d.]+[\s,]+[\d.]+[\s,]+[\d.]+(?:[\s,/]+[\d.]+%?)?\s*\)$/i.test(s)) return s;
  return null;
}

function rgbOf(c: string): [number, number, number] | null {
  const hex = c.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (hex) {
    let h = hex[1];
    if (h.length === 3) h = h.split("").map((x) => x + x).join("");
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  }
  const m = c.match(/rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i);
  if (m) return [Number(m[1]), Number(m[2]), Number(m[3])];
  return null;
}

function lum(c: string): number | null {
  const rgb = rgbOf(c);
  if (!rgb) return null;
  const [r, g, b] = rgb.map((v) => {
    const x = v / 255;
    return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const la = lum(a);
  const lb = lum(b);
  if (la === null || lb === null) return 21;
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/** Цвет с прозрачностью; нераспознанный цвет возвращается как есть. */
export function alpha(c: string, a: number): string {
  const rgb = rgbOf(c);
  if (!rgb) return c;
  return `rgba(${rgb.map((v) => Math.round(v)).join(",")},${a})`;
}

function cssVar(html: string, names: string[]): string | null {
  for (const n of names) {
    const m = html.match(new RegExp(`--${n}\\s*:\\s*([^;}\\n]{1,80})`, "i"));
    const c = normColor(m?.[1]);
    if (c) return c;
  }
  return null;
}

// ── Шрифты страницы ───────────────────────────────────────────────────────

function firstFamily(decl: string | undefined | null): string | null {
  if (!decl) return null;
  const name = clean(decl.split(",")[0]);
  if (!name || /^var\(/i.test(name) || /^(inherit|initial|sans-serif|serif|system-ui|monospace)$/i.test(name)) return null;
  return name;
}

/** Шрифт заголовков, который страница реально использует. */
function pageDisplayFont(html: string): string | null {
  const candidates: Array<string | null> = [
    firstFamily(html.match(/--(?:font-)?(?:display|heading|head|title|headline)\s*:\s*([^;}\n]{1,200})/i)?.[1]),
    firstFamily(html.match(/--font-(?:primary|accent|brand)\s*:\s*([^;}\n]{1,200})/i)?.[1]),
    firstFamily(html.match(/[}>\s,]h1\s*[,{][^}]{0,400}?font-family\s*:\s*([^;}]{1,200})/i)?.[1]),
  ];
  for (const c of candidates) {
    const k = c ? knownFont(c) : null;
    if (k) return k;
  }
  // Иначе — первый Google-шрифт страницы, который не «текстовый».
  return pageLinkFonts(html).find((k) => !BODY_FONTS.test(k)) || null;
}

/** Известные (кириллические) семейства из ссылок fonts.googleapis.com, по порядку. */
function pageLinkFonts(html: string): string[] {
  const out: string[] = [];
  const re = /fonts\.googleapis\.com\/css2?\?([^"'\s>)]{1,600})/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    for (const part of m[1].replace(/&amp;/g, "&").split("&")) {
      const fam = part.match(/^family=([^:&]+)/i);
      if (!fam) continue;
      let name = fam[1];
      try {
        name = decodeURIComponent(name);
      } catch {}
      const k = knownFont(name.replace(/\+/g, " "));
      if (k && !out.includes(k)) out.push(k);
    }
  }
  return out;
}

function pageBodyFont(html: string): string | null {
  const c =
    firstFamily(html.match(/--font-(?:body|text|base|sans|main)\s*:\s*([^;}\n]{1,200})/i)?.[1]) ||
    firstFamily(html.match(/[}>\s,]body\s*\{[^}]{0,400}?font-family\s*:\s*([^;}]{1,200})/i)?.[1]);
  return c ? knownFont(c) : null;
}

/** Текстовый шрифт из ссылки Google Fonts, когда в CSS он не объявлен явно. */
function pageLinkBodyFont(html: string, display: string | null): string | null {
  const rest = pageLinkFonts(html).filter((k) => k !== display);
  return rest.find((k) => BODY_FONTS.test(k)) || rest[0] || null;
}

// ── Публичный API ─────────────────────────────────────────────────────────

export type DetectThemeInput = {
  /** Тексты hero — главный сигнал ниши. */
  texts?: Array<{ title?: string; sub?: string }>;
  /** Бриф / промпт видео. */
  brief?: string;
  /** HTML уже сгенерированной страницы. */
  html?: string;
  /** Сид выбора варианта (бренд). По умолчанию — тексты. */
  seed?: string;
};

function buildTheme(niche: string, pair: FontPair, pal: Palette): SiteTheme {
  const d = fontInfo(pair.display) || FONTS.Onest;
  return {
    niche,
    display: fontStack(pair.display),
    body: fontStack(pair.body),
    importUrl: gfUrl([pair.display, pair.body]),
    displayWeight: d.weight,
    displayTracking: d.tracking ?? "-0.02em",
    displayTransform: d.transform ?? "none",
    displayScale: d.scale ?? 1,
    ...pal,
  };
}

function familyOf(stack: string): string {
  return clean(stack.split(",")[0]);
}

export function detectSiteTheme(input: DetectThemeInput = {}): SiteTheme {
  const heroCopy = (input.texts || []).map((t) => `${t.title || ""} ${t.sub || ""}`).join(" ");
  const html = input.html || "";
  // Title/description страницы — тоже сигнал ниши, когда тексты hero абстрактные.
  const pageMeta = html
    ? [
        html.match(/<title[^>]*>([^<]{0,200})<\/title>/i)?.[1] || "",
        html.match(/<meta[^>]{0,40}name=["']description["'][^>]{0,40}content=["']([^"']{0,300})/i)?.[1] || "",
      ].join(" ")
    : "";
  // Тексты hero учитываются дважды: они точнее брифа видео.
  const copy = `${heroCopy} ${heroCopy} ${input.brief || ""} ${pageMeta}`.toLowerCase();

  const n = pickNiche(copy);
  const fonts = n?.fonts || DEFAULT_FONTS;
  const palettes = n?.palettes || DEFAULT_PALETTES;
  const h = hash(input.seed || heroCopy || input.brief || "craft");

  let theme = buildTheme(n?.id || "default", fonts[h % fonts.length], palettes[(h >>> 5) % palettes.length]);
  if (!html) return theme;

  // 1. Шрифты страницы (с кириллицей) — это и есть «дизайн сайта».
  const pDisplay = pageDisplayFont(html);
  const pBody = pageBodyFont(html) || pageLinkBodyFont(html, pDisplay);
  if (pDisplay || pBody) {
    const display = pDisplay || familyOf(theme.display);
    const body = pBody && pBody !== display ? pBody : familyOf(theme.body);
    const d = fontInfo(display);
    theme = {
      ...theme,
      display: fontStack(display),
      body: fontStack(body),
      importUrl: gfUrl([display, body]),
      displayWeight: d?.weight ?? theme.displayWeight,
      displayTracking: d?.tracking ?? theme.displayTracking,
      displayTransform: d?.transform ?? "none",
      displayScale: d?.scale ?? 1,
    };
  }

  // 2. Палитра страницы.
  const bodyRule = html.match(/[}>\s,]body\s*\{([^}]{0,600})\}/i)?.[1] || "";
  let bg =
    cssVar(html, ["bg", "background", "color-bg", "bg-color", "background-color", "base", "surface", "dark", "night"]) ||
    normColor(bodyRule.match(/background(?:-color)?\s*:\s*([^;]{1,80})/i)?.[1]);
  let ink =
    cssVar(html, ["text", "fg", "ink", "foreground", "color-text", "text-color", "text-primary", "title"]) ||
    normColor(bodyRule.match(/(?:^|[;\s])color\s*:\s*([^;]{1,80})/i)?.[1]);
  const accent = cssVar(html, ["accent", "primary", "brand", "neon", "highlight", "color-accent", "accent-color", "primary-color", "color-primary", "main"]);
  const accent2 = cssVar(html, ["accent-2", "accent2", "secondary", "color-secondary", "secondary-color", "primary-2"]);

  // Tailwind: тёмный фон задан классом на <body>.
  if (!bg && /<body[^>]{0,200}class=["'][^"']{0,300}\bbg-(?:black|(?:neutral|zinc|slate|gray|stone)-9[05]0)\b/i.test(html)) bg = "#0a0a0a";

  if (bg || ink || accent) {
    const bgL = bg ? lum(bg) : null;
    const dark = bgL !== null ? bgL < 0.2 : theme.dark;
    const finalBg = bg || (dark === theme.dark ? theme.bg : dark ? "#0a0a0a" : "#f6f5f2");
    // Цвет текста должен читаться на фоне — иначе берём контрастный.
    if (!ink || contrast(ink, finalBg) < 4.5) ink = dark ? "#ffffff" : "#15151a";
    theme = {
      ...theme,
      bg: finalBg,
      ink,
      dark,
      muted: alpha(ink, dark ? 0.84 : 0.74),
      accent: accent || theme.accent,
      accent2: accent2 || theme.accent2,
      card: dark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.05)",
    };
  }

  return theme;
}

// ── CSS-хелперы для билдеров ──────────────────────────────────────────────

export function themeImport(theme: SiteTheme): string {
  return theme.importUrl ? `@import url('${theme.importUrl}');` : "";
}

export function themeLink(theme: SiteTheme): string {
  return theme.importUrl
    ? `<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link rel="stylesheet" href="${theme.importUrl}">`
    : "";
}

/** Размер заголовка с поправкой на ширину шрифта. */
export function themeSize(theme: SiteTheme, clampExpr: string): string {
  return theme.displayScale === 1 ? clampExpr : `calc(${clampExpr} * ${theme.displayScale})`;
}

/** Декларации шрифта заголовка (без font-size). */
export function themeHeadingCss(theme: SiteTheme): string {
  return `font-family:${theme.display};font-weight:${theme.displayWeight};letter-spacing:${theme.displayTracking};text-transform:${theme.displayTransform};`;
}

/** Вуаль под текстом поверх видео/кадров. */
export function themeVeil(theme: SiteTheme): string {
  if (theme.dark) return "linear-gradient(to top,rgba(0,0,0,0.62) 0%,rgba(0,0,0,0.18) 38%,rgba(0,0,0,0) 65%)";
  return `linear-gradient(to top,${alpha(theme.bg, 0.92)} 0%,${alpha(theme.bg, 0.45)} 38%,${alpha(theme.bg, 0)} 65%)`;
}

export function themeTextShadow(theme: SiteTheme): string {
  return theme.dark ? "0 2px 24px rgba(0,0,0,0.6)" : `0 2px 22px ${alpha(theme.bg, 0.7)}`;
}

export function themeSubShadow(theme: SiteTheme): string {
  return theme.dark ? "0 1px 14px rgba(0,0,0,0.5)" : `0 1px 12px ${alpha(theme.bg, 0.6)}`;
}

/** Панель split-раскладки: фон страницы, растворяющийся к видео. */
export function themePanel(theme: SiteTheme): string {
  return `linear-gradient(to right,${alpha(theme.bg, 0.94)} 0%,${alpha(theme.bg, 0.78)} 42%,${alpha(theme.bg, 0)} 100%)`;
}

export function themePanelMobile(theme: SiteTheme): string {
  return alpha(theme.bg, 0.96);
}

/** Тема для вызовов, куда её не прокинули: детерминирована по текстам. */
export function themeOrDefault(theme: SiteTheme | undefined, texts?: Array<{ title?: string; sub?: string }>, brief?: string): SiteTheme {
  return theme || detectSiteTheme({ texts, brief });
}

/** Цвет текста на акцентной заливке (кнопки). */
export function themeOnAccent(theme: SiteTheme): string {
  return contrast(theme.accent, "#ffffff") >= contrast(theme.accent, "#0a0a0a") ? "#ffffff" : "#0a0a0a";
}
