/**
 * Самохостинг Google Fonts на опубликованных сайтах (152-ФЗ).
 *
 * Сайт, подключающий fonts.googleapis.com, отдаёт Google IP каждого посетителя —
 * это трансграничная передача персональных данных. При публикации CSS Google
 * скачивается один раз (с UA современного Chrome, чтобы пришёл woff2), файлы
 * шрифтов ложатся в дисковый кэш и едут в бакет сайта вместе со страницами, а
 * ссылки в HTML переписываются на /fonts/<hash>.css.
 *
 * Всё «мягко»: при любой ошибке (Google недоступен, таймаут, лимит размера)
 * исходная ссылка на Google остаётся как была — сайт не ломается.
 *
 * Пути корневые (/fonts/…): сайт живёт в корне бакета или домена, а страницы
 * мультистраничника дублируются как slug/index.html, где относительный путь
 * сломался бы. Внутри CSS ссылки на шрифты относительные — рядом с CSS.
 */
import path from "path";
import { promises as fsp } from "fs";
import crypto from "crypto";

const FONT_CACHE_DIR = path.join(process.cwd(), "uploads", "fonts");

const CHROME_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const CSS_TIMEOUT_MS = 8_000;
const FONT_TIMEOUT_MS = 10_000;
// Публикация не ждёт шрифты дольше этого: недокачанное остаётся на Google,
// а загрузка продолжается в фоне и попадёт в кэш к следующей публикации.
const PUBLISH_DEADLINE_MS = 20_000;
const MAX_CSS_BYTES = 512 * 1024;
// Material Symbols со всеми осями весит несколько мегабайт.
const MAX_FONT_BYTES = 8 * 1024 * 1024;
// CJK-шрифты режутся Google на сотни кусков — такие оставляем на Google.
const MAX_FONTS_PER_CSS = 150;
const MAX_TOTAL_BYTES = Number(process.env.PUBLISH_MAX_FONT_BYTES) || 24 * 1024 * 1024;
const DOWNLOAD_CONCURRENCY = 6;
const FAIL_TTL_MS = 10 * 60_000;
// Google не отвечает вовсе — не ждём таймаут на каждой публикации.
const OUTAGE_TTL_MS = 5 * 60_000;
const MEMO_LIMIT = 5_000;

// Ссылка должна заканчиваться кавычкой или «)»: так обрезанная на пробеле
// или на ${…} ссылка не будет переписана наполовину.
const GOOGLE_CSS_RE = /(?:https?:)?\/\/fonts\.googleapis\.com\/(?:css2?|icon)\?[^"'`\s<>()\\${}]{1,2000}(?=["'`)])/gi;
const GSTATIC_RE = /(?:https?:)?\/\/fonts\.gstatic\.com\/[^"'`\s<>()\\${}]{1,1000}(?=["'`)])/gi;
const CSS_FONT_URL_RE = /url\(\s*['"]?(https:\/\/fonts\.gstatic\.com\/[^'")\s]{1,1000})['"]?\s*\)/g;
const LOCAL_FONT_REF_RE = /url\(([0-9a-f]{16}\.woff2?)\)/g;
const LINK_TAG_RE = /<link\b[^>]{0,2000}>/gi;

interface CssEntry {
  cssFile: string;
  fontFiles: string[];
}

const cssMemo = new Map<string, CssEntry>();
const cssInflight = new Map<string, Promise<CssEntry | null>>();
const fontMemo = new Map<string, string>();
const fontInflight = new Map<string, Promise<string>>();
const failedUntil = new Map<string, number>();
let outageUntil = 0;
let dirReady: Promise<unknown> | null = null;

function remember<V>(map: Map<string, V>, key: string, value: V): void {
  if (map.size >= MEMO_LIMIT) map.clear();
  map.set(key, value);
}

function hashName(s: string): string {
  return crypto.createHash("sha1").update(s).digest("hex").slice(0, 16);
}

function toHttpsUrl(raw: string, host: string): URL | null {
  let u = raw.replace(/&amp;/gi, "&");
  if (u.startsWith("//")) u = `https:${u}`;
  u = u.replace(/^http:/i, "https:");
  try {
    const url = new URL(u);
    return url.hostname === host ? url : null;
  } catch {
    return null;
  }
}

function normalizeCssUrl(raw: string): string | null {
  const url = toHttpsUrl(raw, "fonts.googleapis.com");
  if (!url || !/^\/(?:css2?|icon)$/.test(url.pathname) || !url.searchParams.get("family")) return null;
  return url.toString();
}

function normalizeFontUrl(raw: string): string | null {
  const url = toHttpsUrl(raw, "fonts.gstatic.com");
  if (!url || !/^\/[sl]\//.test(url.pathname)) return null;
  return url.toString();
}

/** Сеть недоступна или не ответила — в отличие от 4xx и лимитов размера. */
function isNetworkError(err: any): boolean {
  return err instanceof TypeError || err?.name === "TimeoutError" || err?.name === "AbortError";
}

async function fetchLimited(url: string, timeoutMs: number, maxBytes: number, accept: string): Promise<Buffer> {
  const res = await fetch(url, {
    headers: { "User-Agent": CHROME_UA, Accept: accept },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const declared = Number(res.headers.get("content-length") || 0);
  if (declared > maxBytes) throw new Error(`too large (${declared} bytes)`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > maxBytes) throw new Error(`too large (${buf.length} bytes)`);
  return buf;
}

async function writeAtomic(file: string, data: Buffer | string): Promise<void> {
  const tmp = `${file}.${process.pid}.${crypto.randomBytes(4).toString("hex")}.tmp`;
  await fsp.writeFile(tmp, data);
  await fsp.rename(tmp, file);
}

async function exists(file: string): Promise<boolean> {
  try {
    await fsp.access(file);
    return true;
  } catch {
    return false;
  }
}

function fontExt(buf: Buffer): "woff2" | "woff" | null {
  if (buf.length < 4) return null;
  const magic = buf.toString("latin1", 0, 4);
  return magic === "wOF2" ? "woff2" : magic === "wOFF" ? "woff" : null;
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

/** Ждёт промис не дольше `ms`; по истечении отдаёт null, сам промис идёт дальше. */
function withDeadline<T>(p: Promise<T | null>, ms: number): Promise<T | null> {
  if (ms <= 0) return Promise.resolve(null);
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), ms);
    timer.unref?.();
  });
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer));
}

/** Скачивает файл шрифта в кэш; возвращает имя файла в кэше. Бросает при ошибке. */
function cacheFontFile(url: string): Promise<string> {
  const memo = fontMemo.get(url);
  if (memo) return Promise.resolve(memo);
  let p = fontInflight.get(url);
  if (!p) {
    p = (async () => {
      const base = hashName(url);
      for (const ext of ["woff2", "woff"]) {
        if (await exists(path.join(FONT_CACHE_DIR, `${base}.${ext}`))) return `${base}.${ext}`;
      }
      const buf = await fetchLimited(url, FONT_TIMEOUT_MS, MAX_FONT_BYTES, "font/woff2,font/woff;q=0.9,*/*;q=0.1");
      const ext = fontExt(buf);
      if (!ext) throw new Error("response is not a woff/woff2 font");
      const name = `${base}.${ext}`;
      await writeAtomic(path.join(FONT_CACHE_DIR, name), buf);
      return name;
    })()
      .then((name) => {
        remember(fontMemo, url, name);
        return name;
      })
      .finally(() => fontInflight.delete(url));
    fontInflight.set(url, p);
  }
  return p;
}

/** CSS, уже собранный раньше: на диске лежит переписанная версия. */
async function readCachedCss(cssUrl: string): Promise<CssEntry | null> {
  const cssFile = `${hashName(cssUrl)}.css`;
  const css = await fsp.readFile(path.join(FONT_CACHE_DIR, cssFile), "utf8").catch(() => null);
  if (!css) return null;
  const fontFiles = Array.from(new Set(Array.from(css.matchAll(LOCAL_FONT_REF_RE), (m) => m[1])));
  if (!fontFiles.length) return null;
  const present = await Promise.all(fontFiles.map((f) => exists(path.join(FONT_CACHE_DIR, f))));
  return present.every(Boolean) ? { cssFile, fontFiles } : null;
}

async function fetchCss(cssUrl: string): Promise<CssEntry> {
  let css: string;
  try {
    css = (await fetchLimited(cssUrl, CSS_TIMEOUT_MS, MAX_CSS_BYTES, "text/css,*/*;q=0.1")).toString("utf8");
  } catch (err) {
    if (isNetworkError(err)) outageUntil = Date.now() + OUTAGE_TTL_MS;
    throw err;
  }
  if (!css.includes("@font-face")) throw new Error("no @font-face in Google CSS");

  // Вариативный шрифт отдаёт один и тот же файл на все начертания.
  const urls = Array.from(new Set(Array.from(css.matchAll(CSS_FONT_URL_RE), (m) => m[1])));
  if (!urls.length) throw new Error("no fonts.gstatic.com files in Google CSS");
  if (urls.length > MAX_FONTS_PER_CSS) throw new Error(`too many font files (${urls.length})`);

  const names = await mapLimit(urls, DOWNLOAD_CONCURRENCY, cacheFontFile);
  const byUrl = new Map(urls.map((u, i) => [u, names[i]] as const));
  const rewritten = css.replace(CSS_FONT_URL_RE, (m, u: string) => `url(${byUrl.get(u) ?? u})`);
  const cssFile = `${hashName(cssUrl)}.css`;
  await writeAtomic(path.join(FONT_CACHE_DIR, cssFile), rewritten);
  return { cssFile, fontFiles: Array.from(new Set(names)) };
}

function resolveCss(cssUrl: string): Promise<CssEntry | null> {
  const memo = cssMemo.get(cssUrl);
  if (memo) return Promise.resolve(memo);
  let p = cssInflight.get(cssUrl);
  if (!p) {
    p = (async () => {
      const cached = await readCachedCss(cssUrl);
      if (cached) return cached;
      const now = Date.now();
      if (outageUntil > now || (failedUntil.get(cssUrl) || 0) > now) return null;
      return fetchCss(cssUrl);
    })()
      .then(
        (entry) => {
          if (entry) {
            remember(cssMemo, cssUrl, entry);
            failedUntil.delete(cssUrl);
          }
          return entry;
        },
        (err) => {
          remember(failedUntil, cssUrl, Date.now() + FAIL_TTL_MS);
          console.warn(`[Fonts] keeping Google link ${cssUrl}: ${err?.message || err}`);
          return null;
        },
      )
      .finally(() => cssInflight.delete(cssUrl));
    cssInflight.set(cssUrl, p);
  }
  return p;
}

function hasMatch(re: RegExp, s: string): boolean {
  re.lastIndex = 0;
  const found = re.test(s);
  re.lastIndex = 0;
  return found;
}

export interface SelfHostedFontFile {
  filename: string;
  contentBuffer: Buffer;
}

export interface SelfHostFontsResult {
  /** Файлы для бакета: fonts/<hash>.css и fonts/<hash>.woff2. */
  files: SelfHostedFontFile[];
  /** Сколько Google-ссылок (CSS и прямых файлов) переведено на свои. */
  hosted: number;
  /** Сколько осталось на Google из-за ошибок, таймаута или лимитов. */
  kept: number;
}

/**
 * Переписывает Google Fonts в HTML страниц на локальные /fonts/… и возвращает
 * файлы, которые нужно положить в бакет. Меняет `content` страниц на месте,
 * и только в самом конце, когда все файлы уже прочитаны с диска.
 */
export async function selfHostPageFonts(pages: Array<{ content?: string }>): Promise<SelfHostFontsResult> {
  const cssByRaw = new Map<string, string>();
  const fontByRaw = new Map<string, string>();
  for (const page of pages) {
    if (!page.content) continue;
    for (const m of Array.from(page.content.matchAll(GOOGLE_CSS_RE))) {
      const url = normalizeCssUrl(m[0]);
      if (url) cssByRaw.set(m[0], url);
    }
    for (const m of Array.from(page.content.matchAll(GSTATIC_RE))) {
      const url = normalizeFontUrl(m[0]);
      if (url) fontByRaw.set(m[0], url);
    }
  }
  if (!cssByRaw.size && !fontByRaw.size) return { files: [], hosted: 0, kept: 0 };

  if (!dirReady) {
    dirReady = fsp.mkdir(FONT_CACHE_DIR, { recursive: true }).catch((err) => {
      dirReady = null;
      throw err;
    });
  }
  await dirReady;

  const deadline = Date.now() + PUBLISH_DEADLINE_MS;
  const cssUrls = Array.from(new Set(cssByRaw.values()));
  const fontUrls = Array.from(new Set(fontByRaw.values()));
  const [cssEntries, fontNames] = await Promise.all([
    Promise.all(cssUrls.map((u) => withDeadline(resolveCss(u), deadline - Date.now()))),
    Promise.all(
      fontUrls.map((u) =>
        withDeadline(
          cacheFontFile(u).catch((err): string | null => {
            console.warn(`[Fonts] keeping Google font file ${u}: ${err?.message || err}`);
            return null;
          }),
          deadline - Date.now(),
        ),
      ),
    ),
  ]);

  const bundle = new Map<string, Buffer>();
  let totalBytes = 0;
  // Берёт набор файлов целиком или ничего: CSS без части шрифтов хуже Google.
  const take = async (names: string[]): Promise<boolean> => {
    const got = new Map<string, Buffer>();
    let added = 0;
    for (const name of names) {
      const key = `fonts/${name}`;
      if (bundle.has(key) || got.has(key)) continue;
      const buf = await fsp.readFile(path.join(FONT_CACHE_DIR, name)).catch(() => null);
      if (!buf) return false;
      added += buf.length;
      if (totalBytes + added > MAX_TOTAL_BYTES) return false;
      got.set(key, buf);
    }
    got.forEach((buf, key) => bundle.set(key, buf));
    totalBytes += added;
    return true;
  };

  const localCss = new Map<string, string>();
  for (let i = 0; i < cssUrls.length; i++) {
    const entry = cssEntries[i];
    if (!entry) continue;
    if (await take([entry.cssFile, ...entry.fontFiles])) {
      localCss.set(cssUrls[i], `/fonts/${entry.cssFile}`);
    } else {
      // Кэш могли почистить — в следующий раз соберём заново.
      cssMemo.delete(cssUrls[i]);
      console.warn(`[Fonts] keeping Google link ${cssUrls[i]}: cache miss or font size cap`);
    }
  }
  const localFont = new Map<string, string>();
  for (let i = 0; i < fontUrls.length; i++) {
    const name = fontNames[i];
    if (!name) continue;
    if (await take([name])) localFont.set(fontUrls[i], `/fonts/${name}`);
    else fontMemo.delete(fontUrls[i]);
  }

  for (const page of pages) {
    if (!page.content) continue;
    let html = page.content
      .replace(GOOGLE_CSS_RE, (m) => localCss.get(cssByRaw.get(m) || "") || m)
      .replace(GSTATIC_RE, (m) => localFont.get(fontByRaw.get(m) || "") || m);
    // preconnect к Google сам по себе отдаёт IP посетителя — убираем, если
    // на странице не осталось ни одной ссылки на Google Fonts.
    if (!hasMatch(GOOGLE_CSS_RE, html) && !hasMatch(GSTATIC_RE, html)) {
      html = html.replace(LINK_TAG_RE, (tag) =>
        /\brel\s*=\s*["']?[^"'>]*\b(?:preconnect|dns-prefetch)\b/i.test(tag) &&
        /fonts\.(?:googleapis|gstatic)\.com/i.test(tag)
          ? ""
          : tag,
      );
    }
    page.content = html;
  }

  return {
    files: Array.from(bundle, ([filename, contentBuffer]) => ({ filename, contentBuffer })),
    hosted: localCss.size + localFont.size,
    kept: cssUrls.length - localCss.size + (fontUrls.length - localFont.size),
  };
}
