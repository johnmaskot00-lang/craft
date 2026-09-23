/**
 * Shared code-intelligence helpers for the site agent.
 *
 * Three groups, all of them indexOf-based on purpose:
 *
 *  1. Diagnostics for a failed SEARCH/REPLACE patch (`buildPatchDiagnostics`).
 *     A miss costs the model a whole extra round; handing it the surrounding
 *     code (and the exact line that diverges) lets it fix the patch on the
 *     first retry instead of guessing again.
 *  2. Post-patch HTML validation (`validatePatchedHtml`). Confirms the patch
 *     did not break tag balance, drop a picture placeholder or delete a
 *     script/nav/footer. Reports regressions only — a file that was already
 *     messy stays quiet.
 *  3. `ls`/`grep`/`cat` primitives so the agent can navigate a project
 *     instead of reading 60-80 KB blind windows.
 *
 * Safety: this file never runs a regex over a whole document. See the outage
 * note in memory — a quadratic regex in selectorRules froze the event loop.
 * Every scan here is a bounded linear walk with explicit caps, and user
 * supplied grep patterns are length-capped and screened before compilation.
 */

const VOID_ELEMENTS = new Set([
  "area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta",
  "param", "source", "track", "wbr",
]);

/** Tags whose closing tag is optional in HTML — never reported as an error. */
const OPTIONAL_CLOSE_ELEMENTS = new Set([
  "html", "head", "body", "p", "li", "td", "th", "tr", "option", "thead",
  "tbody", "tfoot", "dt", "dd", "rt", "rp", "colgroup", "caption", "optgroup",
]);

/** Raw-text elements: everything up to the matching close tag is text. */
const RAW_TEXT_ELEMENTS = new Set(["script", "style", "textarea", "title"]);

/** `12| code`, `12: code`, `12\tcode` — the numbering our own tools emit. */
export const LINE_NUMBER_PREFIX_RE = /^\s*\d+\s*[|:\t]\s?/;

const B64_PLACEHOLDER_RE = /__B64_(\d+)__/g;

// ---------------------------------------------------------------------------
// Lines
// ---------------------------------------------------------------------------

/** Splits on \n and drops a trailing \r, so Windows files behave like Unix. */
export function splitLines(code: string): string[] {
  const out = code.split("\n");
  for (let i = 0; i < out.length; i++) {
    const line = out[i];
    if (line.length > 0 && line.charCodeAt(line.length - 1) === 13) out[i] = line.slice(0, -1);
  }
  return out;
}

/** Numeric line extent with a capped, human-readable renderer. */
export class LineIndex {
  readonly code: string;
  readonly starts: number[];

  constructor(code: string) {
    this.code = code;
    const starts = [0];
    let i = code.indexOf("\n");
    while (i !== -1) {
      starts.push(i + 1);
      i = code.indexOf("\n", i + 1);
    }
    this.starts = starts;
  }

  get lineCount(): number {
    return this.starts.length;
  }

  /** 1-based line number containing a character offset. */
  lineAt(offset: number): number {
    const s = this.starts;
    if (offset <= 0) return 1;
    let lo = 0;
    let hi = s.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (s[mid] <= offset) lo = mid;
      else hi = mid - 1;
    }
    return lo + 1;
  }

  /** 1-based; returns "" past the end. */
  lineText(line: number): string {
    const start = this.starts[line - 1];
    if (start === undefined) return "";
    const next = this.starts[line];
    const raw = next === undefined ? this.code.slice(start) : this.code.slice(start, next - 1);
    return raw.charCodeAt(raw.length - 1) === 13 ? raw.slice(0, -1) : raw;
  }

  /** Character offset where a 1-based line starts. */
  lineStart(line: number): number {
    return this.starts[line - 1] ?? this.code.length;
  }
}

/** Renders `N| text`, Claude-Code style. Always paired with a "don't copy" warning. */
export function formatNumberedLines(
  lines: string[],
  fromLine: number,
  toLine: number,
  opts?: { maxChars?: number; clipLineAt?: number },
): string {
  const maxChars = opts?.maxChars ?? 7000;
  const clipAt = opts?.clipLineAt ?? 400;
  const start = Math.max(1, fromLine);
  const end = Math.min(lines.length, toLine);
  const out: string[] = [];
  let budget = maxChars;
  for (let n = start; n <= end; n++) {
    const raw = lines[n - 1] ?? "";
    const text = raw.length > clipAt ? `${raw.slice(0, clipAt)} [строка обрезана, всего ${raw.length} знаков]` : raw;
    const rendered = `${n}| ${text}`;
    budget -= rendered.length + 1;
    if (budget < 0) break;
    out.push(rendered);
  }
  return out.join("\n");
}

export const NUMBERING_WARNING =
  "цифры перед текстом — только нумерация вывода, в SEARCH их копировать НЕЛЬЗЯ.";

// ---------------------------------------------------------------------------
// SEARCH/REPLACE diagnostics
// ---------------------------------------------------------------------------

function countOccurrences(haystack: string, needle: string, cap = 3): { count: number; positions: number[] } {
  const positions: number[] = [];
  if (!needle) return { count: 0, positions };
  let at = haystack.indexOf(needle);
  while (at !== -1 && positions.length < cap) {
    positions.push(at);
    at = haystack.indexOf(needle, at + needle.length);
  }
  return { count: positions.length, positions };
}

function normalizeLine(line: string): string {
  return line.replace(/\s+/g, " ").trim();
}

function shorten(text: string, max = 120): string {
  const t = text.replace(/\r/g, "");
  return t.length > max ? `${t.slice(0, max)}…` : t;
}

export interface PatchDiagnosticsOptions {
  /** Chars of file context to include around the mismatch. */
  maxWindowChars?: number;
  /** Lines either side of the mismatch. */
  maxWindowLines?: number;
}

/**
 * Explains why a SEARCH block did not apply, and shows the code around the
 * closest match. Returns null when there is nothing useful to add.
 *
 * Call this only after `applySinglePatch` failed — it is the expensive path
 * and must never run on a successful patch.
 */
export function buildPatchDiagnostics(
  fileCode: string,
  searchBlock: string,
  replaceBlock = "",
  opts?: PatchDiagnosticsOptions,
): string | null {
  if (!fileCode || !searchBlock.trim()) return null;

  const maxWindowChars = opts?.maxWindowChars ?? 6000;
  const maxWindowLines = opts?.maxWindowLines ?? 40;
  const idx = new LineIndex(fileCode);
  const parts: string[] = [];

  // --- 0. Already applied? ------------------------------------------------
  // A repeated patch after a successful one is the single most common waste:
  // the model does not realize its change landed. Say so, with a line number.
  const replaceTrimmed = replaceBlock.trim();
  if (replaceTrimmed.length >= 20) {
    const at = fileCode.indexOf(replaceTrimmed);
    if (at !== -1) {
      const line = idx.lineAt(at);
      return (
        `⚠️ Патч УЖЕ применён: REPLACE найден в файле на строке ${line}.\n` +
        `Ничего делать не нужно — вызови finish с коротким отчётом.\n\n` +
        `Строка ${line}: ${shorten(idx.lineText(line), 160)}`
      );
    }
  }

  // --- 1. Ambiguous SEARCH ------------------------------------------------
  const raw = countOccurrences(fileCode, searchBlock);
  const trimmedSearch = searchBlock.trim();
  const trimmedHits = raw.count === 0 && trimmedSearch !== searchBlock
    ? countOccurrences(fileCode, trimmedSearch)
    : { count: 0, positions: [] as number[] };
  const dupPositions = raw.count >= 2 ? raw.positions : trimmedHits.count >= 2 ? trimmedHits.positions : [];

  if (dupPositions.length >= 2) {
    parts.push(
      `SEARCH встречается в файле ${dupPositions.length}${dupPositions.length >= 3 ? "+" : ""} раз(а) — нужен уникальный фрагмент.`,
    );
    for (const pos of dupPositions.slice(0, 5)) {
      const line = idx.lineAt(pos);
      parts.push(`\n— совпадение на строке ${line} —`);
      parts.push(formatNumberedLines(splitLines(fileCode), line - 1, line + 1, { maxChars: 1200, clipLineAt: 200 }));
    }
    parts.push(
      "\nДобавь в SEARCH соседнюю строку, которая встречается только в нужном месте (уникальный текст заголовка, id, класс), и повтори.",
    );
    return parts.join("\n");
  }

  // --- 2. Locate a plausible anchor --------------------------------------
  const fileLines = splitLines(fileCode);
  const searchLines = splitLines(searchBlock);
  const fileNorm: string[] = new Array(fileLines.length);
  for (let i = 0; i < fileLines.length; i++) fileNorm[i] = normalizeLine(fileLines[i]);
  const searchNorm: string[] = new Array(searchLines.length);
  for (let i = 0; i < searchLines.length; i++) searchNorm[i] = normalizeLine(searchLines[i]);

  const candidates: { searchIdx: number; text: string }[] = [];
  for (let i = 0; i < searchNorm.length && candidates.length < 400; i++) {
    const t = searchNorm[i];
    if (t.length < 8) continue;
    if (/^<\/?[a-z0-9-]+>$/.test(t)) continue; // bare tag: matches everywhere
    candidates.push({ searchIdx: i, text: t });
  }
  candidates.sort((a, b) => b.text.length - a.text.length);

  // Bounded scan: longest anchors first, stop after a handful of candidates.
  let anchor: { searchIdx: number; fileLine: number } | null = null;
  for (const cand of candidates.slice(0, 8)) {
    for (let i = 0; i < fileNorm.length; i++) {
      if (fileNorm[i].includes(cand.text)) {
        anchor = { searchIdx: cand.searchIdx, fileLine: i };
        break;
      }
    }
    if (anchor) break;
  }

  // Extra hints that stand on their own, computed before we decide what to show.
  const tips: string[] = [];
  const placeholders = [...new Set((searchBlock.match(B64_PLACEHOLDER_RE) ?? []))];
  const invented = placeholders.filter((p) => !fileCode.includes(p));
  if (invented.length > 0) {
    tips.push(
      `Плейсхолдер ${invented.join(", ")} есть только в промпте: в самом файле на этом месте лежит картинка. ` +
        `Не включай его в SEARCH — бери соседние строки.`,
    );
  }
  if (/…|\.\.\./.test(searchBlock)) {
    tips.push("В SEARCH есть многоточие — это не часть кода. Скопируй строки целиком.");
  }
  let prefixed = 0;
  let numbered = 0;
  for (const line of searchLines) {
    if (!line.trim()) continue;
    numbered++;
    if (LINE_NUMBER_PREFIX_RE.test(line)) prefixed++;
  }
  if (numbered > 1 && prefixed === numbered && !fileLines.some((l) => LINE_NUMBER_PREFIX_RE.test(l))) {
    tips.push("Убери нумерацию строк (`12| `) из SEARCH — " + NUMBERING_WARNING);
  }

  if (!anchor) {
    // Nothing similar at all: the model is probably editing the wrong file,
    // or the fragment is stale beyond recognition.
    parts.push("SEARCH не найден, и ничего похожего в этом файле нет.");
    parts.push("\nНачало файла:");
    parts.push(formatNumberedLines(fileLines, 1, 25, { maxChars: 1500, clipLineAt: 300 }));
    parts.push(
      "\nПроверь, тот ли это файл: `ls` покажет список, `grep` — где вообще встречается нужный текст. " +
        "Если фрагмент устарел — `cat` по нужному участку и повтори патч по живому коду.",
    );
    if (tips.length > 0) parts.push(`\n${tips.map((t) => `• ${t}`).join("\n")}`);
    return parts.join("\n");
  }

  const { searchIdx, fileLine } = anchor;
  const anchorLine = fileLine + 1;

  // --- 3. First diverging line -------------------------------------------
  const mismatch = findFirstDivergence(searchLines, searchNorm, fileLines, fileNorm, searchIdx, fileLine);
  if (mismatch) {
    parts.push(`❌ SEARCH не совпал. Первое расхождение (в SEARCH это строка ${mismatch.searchIdx + 1}):`);
    parts.push(`   SEARCH: ${shorten(mismatch.search)}`);
    parts.push(`   файл ${mismatch.fileLine}: ${shorten(mismatch.file)}`);
  } else {
    parts.push(`SEARCH не найден дословно, ближайшее совпадение — строка ${anchorLine}.`);
  }

  // --- 4. Window ---------------------------------------------------------
  const fileIsMinified = detectMinified(fileLines);
  parts.push(
    `\nКод файла вокруг строки ${anchorLine} (${NUMBERING_WARNING}):`,
  );
  if (fileIsMinified) {
    const at = idx.lineStart(anchorLine);
    const from = Math.max(0, at - 400);
    const to = Math.min(fileCode.length, at + 400);
    parts.push(`${anchorLine}| …${fileCode.slice(from, to)}…`);
    parts.push("(файл минифицирован — правь по уникальной подстроке, а не по строкам)");
  } else {
    parts.push(
      formatNumberedLines(fileLines, anchorLine - maxWindowLines, anchorLine + maxWindowLines, {
        maxChars: maxWindowChars,
        clipLineAt: 400,
      }),
    );
  }

  if (tips.length > 0) parts.push(`\n${tips.map((t) => `• ${t}`).join("\n")}`);
  parts.push("\nСкопируй SEARCH дословно из этого окна и повтори apply_patch.");

  const text = parts.join("\n");
  return text.length > 9000 ? `${text.slice(0, 9000)}\n…(диагностика обрезана)` : text;
}

/**
 * Walks outward from the anchor on both sides, skipping blank lines, and
 * returns the first pair of non-blank lines that differ.
 */
function findFirstDivergence(
  searchLines: string[],
  searchNorm: string[],
  fileLines: string[],
  fileNorm: string[],
  searchAnchor: number,
  fileAnchor: number,
): { searchIdx: number; search: string; fileLine: number; file: string } | null {
  // forward
  let s = searchAnchor + 1;
  let f = fileAnchor + 1;
  let steps = 0;
  while (s < searchNorm.length && f < fileNorm.length && steps < 40) {
    const a = searchNorm[s];
    const b = fileNorm[f];
    if (!a) { s++; continue; }
    if (!b) { f++; continue; }
    if (a !== b) return { searchIdx: s, search: searchLines[s], fileLine: f + 1, file: fileLines[f] };
    s++; f++; steps++;
  }
  // backward
  s = searchAnchor - 1;
  f = fileAnchor - 1;
  steps = 0;
  while (s >= 0 && f >= 0 && steps < 40) {
    const a = searchNorm[s];
    const b = fileNorm[f];
    if (!a) { s--; continue; }
    if (!b) { f--; continue; }
    if (a !== b) return { searchIdx: s, search: searchLines[s], fileLine: f + 1, file: fileLines[f] };
    s--; f--; steps++;
  }
  return null;
}

function detectMinified(lines: string[]): boolean {
  const probe = Math.min(lines.length, 200);
  if (probe === 0) return false;
  let total = 0;
  for (let i = 0; i < probe; i++) total += lines[i].length;
  return total / probe > 400;
}

/** `line N: text` one-liner for tool results. */
export function describeLine(code: string, lineNumber: number): string {
  const lines = splitLines(code);
  if (lineNumber < 1 || lineNumber > lines.length) return "";
  return `строка ${lineNumber}: ${shorten(lines[lineNumber - 1], 160)}`;
}

// ---------------------------------------------------------------------------
// HTML tokenizer
// ---------------------------------------------------------------------------

export interface HtmlToken {
  /** Lowercase tag name. */
  name: string;
  isClose: boolean;
  selfClose: boolean;
  /** Offset of `<`. */
  start: number;
  /** Offset just past `>`. */
  end: number;
  /** 1-based line of `<`. */
  line: number;
}

function isTagNameChar(c: number): boolean {
  return (
    (c >= 97 && c <= 122) || // a-z
    (c >= 65 && c <= 90) || // A-Z
    (c >= 48 && c <= 57) || // 0-9
    c === 45 || // -
    c === 58 || // :
    c === 95 // _
  );
}

function isBoundaryChar(c: number): boolean {
  return Number.isNaN(c) || c === 62 /* > */ || c === 47 /* / */ || c === 32 || c === 9 || c === 10 || c === 13;
}

/**
 * Linear indexOf walk producing every tag token. Skips comments, doctypes,
 * processing instructions and raw-text element bodies, and ignores `<` that
 * is not a tag (e.g. `a < b` in inline script-adjacent markup).
 */
export function tokenizeHtml(code: string): HtmlToken[] {
  const tokens: HtmlToken[] = [];
  const lineIndex = new LineIndex(code);
  let i = 0;
  while (i < code.length && tokens.length < 200000) {
    const lt = code.indexOf("<", i);
    if (lt === -1) break;

    // comment
    if (code.startsWith("<!--", lt)) {
      const close = code.indexOf("-->", lt + 4);
      i = close === -1 ? code.length : close + 3;
      continue;
    }
    // <!doctype ...>, <![CDATA[...]]>, <?php ... ?>
    if (code.startsWith("<!", lt) || code.startsWith("<?", lt)) {
      const gt = code.indexOf(">", lt + 2);
      i = gt === -1 ? code.length : gt + 1;
      continue;
    }

    let p = lt + 1;
    let isClose = false;
    if (code.charCodeAt(p) === 47 /* / */) {
      isClose = true;
      p++;
    }
    let nameEnd = p;
    while (nameEnd < code.length && isTagNameChar(code.charCodeAt(nameEnd))) nameEnd++;
    if (nameEnd === p) {
      i = lt + 1;
      continue;
    }
    const name = code.slice(p, nameEnd).toLowerCase();

    // find `>` outside quoted attribute values
    let q = nameEnd;
    let quote = 0;
    let end = -1;
    while (q < code.length) {
      const c = code.charCodeAt(q);
      if (quote) {
        if (c === quote) quote = 0;
      } else if (c === 34 /* " */ || c === 39 /* ' */) {
        quote = c;
      } else if (c === 62 /* > */) {
        end = q + 1;
        break;
      }
      q++;
    }
    if (end === -1) {
      // unterminated tag — treat the rest as junk and stop scanning tags
      i = lt + 1;
      continue;
    }

    const selfClose = code.charCodeAt(end - 2) === 47 /* / */;
    tokens.push({ name, isClose, selfClose, start: lt, end, line: lineIndex.lineAt(lt) });
    i = end;

    // Raw-text elements: everything up to the matching close tag is text.
    if (!isClose && !selfClose && RAW_TEXT_ELEMENTS.has(name)) {
      i = findRawTextClose(code, name, i);
    }
  }
  return tokens;
}

/** Offset of `</name` at or after `from`, or code.length. */
function findRawTextClose(code: string, name: string, from: number): number {
  let k = code.indexOf("</", from);
  while (k !== -1) {
    if (code.slice(k + 2, k + 2 + name.length).toLowerCase() === name) {
      const after = code.charCodeAt(k + 2 + name.length);
      if (isBoundaryChar(after)) return k;
    }
    k = code.indexOf("</", k + 2);
  }
  return code.length;
}

export interface HtmlTagReport {
  tokenCount: number;
  /** Per-tag count of tags left open that HTML does not allow to be optional. */
  unclosedCount: Map<string, number>;
  /** Per-tag count of closing tags with no opener. */
  strayCount: Map<string, number>;
  /** Per-tag count of optional-close elements left open (informational). */
  looseOptionalCount: Map<string, number>;
  /** A few examples of each, nearest to the top of the file first. */
  unclosedSamples: { tag: string; line: number }[];
  straySamples: { tag: string; line: number }[];
  /** Every `<script …>` token (inline and external). */
  scriptSrcs: string[];
  scriptCount: number;
  jsonLdCount: number;
  navCount: number;
  footerCount: number;
  hasHeader: boolean;
  hasMain: boolean;
}

function bump(map: Map<string, number>, key: string, by = 1): void {
  map.set(key, (map.get(key) ?? 0) + by);
}

function readAttr(tagText: string, attr: string): string | null {
  if (tagText.length > 4000) return null;
  const needle = `${attr}=`;
  let at = tagText.toLowerCase().indexOf(needle);
  while (at !== -1) {
    // must be preceded by whitespace or the tag name boundary
    const prev = tagText.charCodeAt(at - 1);
    if (Number.isNaN(prev) || prev === 32 || prev === 9 || prev === 10 || prev === 13) {
      const q = tagText.charCodeAt(at + needle.length);
      if (q === 34 || q === 39) {
        const close = tagText.indexOf(String.fromCharCode(q), at + needle.length + 1);
        if (close !== -1) return tagText.slice(at + needle.length + 1, close);
      } else {
        let e = at + needle.length;
        while (e < tagText.length && !/[\s>]/.test(tagText[e])) e++;
        return tagText.slice(at + needle.length, e);
      }
    }
    at = tagText.toLowerCase().indexOf(needle, at + needle.length);
  }
  return null;
}

/**
 * Walks the token stream once with a stack matcher and summarises the tag
 * structure. Unclosed tags are those popped off the stack when a *different*
 * closing tag arrives; stray tags are closes with no opener at all.
 */
export function htmlTagStats(code: string): HtmlTagReport {
  const unclosedCount = new Map<string, number>();
  const strayCount = new Map<string, number>();
  const looseOptionalCount = new Map<string, number>();
  const unclosedSamples: { tag: string; line: number }[] = [];
  const straySamples: { tag: string; line: number }[] = [];
  const scriptSrcs: string[] = [];
  let scriptCount = 0;
  let jsonLdCount = 0;
  let navCount = 0;
  let footerCount = 0;
  let hasHeader = false;
  let hasMain = false;

  const stack: { name: string; line: number }[] = [];
  const tokens = tokenizeHtml(code);

  for (const token of tokens) {
    if (token.name === "nav") navCount++;
    else if (token.name === "footer") footerCount++;
    else if (token.name === "header") hasHeader = true;
    else if (token.name === "main") hasMain = true;

    if (token.name === "script" && !token.isClose) {
      scriptCount++;
      const tagText = code.slice(token.start, token.end);
      const src = readAttr(tagText, "src");
      if (src) scriptSrcs.push(src);
      const type = readAttr(tagText, "type");
      if (type && type.toLowerCase() === "application/ld+json") jsonLdCount++;
    }

    if (token.isClose) {
      let hit = -1;
      for (let s = stack.length - 1; s >= 0; s--) {
        if (stack[s].name === token.name) {
          hit = s;
          break;
        }
      }
      if (hit === -1) {
        if (!OPTIONAL_CLOSE_ELEMENTS.has(token.name)) {
          bump(strayCount, token.name);
          if (straySamples.length < 12) straySamples.push({ tag: token.name, line: token.line });
        }
        continue;
      }
      for (let s = stack.length - 1; s > hit; s--) {
        const loose = stack[s];
        if (OPTIONAL_CLOSE_ELEMENTS.has(loose.name)) {
          bump(looseOptionalCount, loose.name);
        } else {
          bump(unclosedCount, loose.name);
          if (unclosedSamples.length < 12) unclosedSamples.push({ tag: loose.name, line: loose.line });
        }
      }
      stack.length = hit;
      continue;
    }

    // opening tag
    if (VOID_ELEMENTS.has(token.name) || token.selfClose) continue;
    stack.push({ name: token.name, line: token.line });
  }

  for (const loose of stack) {
    if (OPTIONAL_CLOSE_ELEMENTS.has(loose.name)) {
      bump(looseOptionalCount, loose.name);
    } else {
      bump(unclosedCount, loose.name);
      if (unclosedSamples.length < 12) unclosedSamples.push({ tag: loose.name, line: loose.line });
    }
  }

  return {
    tokenCount: tokens.length,
    unclosedCount,
    strayCount,
    looseOptionalCount,
    unclosedSamples,
    straySamples,
    scriptSrcs,
    scriptCount,
    jsonLdCount,
    navCount,
    footerCount,
    hasHeader,
    hasMain,
  };
}

// ---------------------------------------------------------------------------
// linkedom second opinion (optional)
// ---------------------------------------------------------------------------

const DOM_SIZE_LIMIT = 400_000;

export interface DomSnapshot {
  navCount: number;
  navLinks: number;
  footerCount: number;
  footerTextLen: number;
  scriptSrcs: string[];
  scriptCount: number;
  jsonLdCount: number;
}

let domLoader: Promise<((html: string) => { document: any }) | null> | null = null;
let domLoadWarned = false;

function loadDomParser(): Promise<((html: string) => { document: any }) | null> {
  if (!domLoader) {
    domLoader = import("linkedom")
      .then((mod: any) => (typeof mod.parseHTML === "function" ? mod.parseHTML : null))
      .catch((err) => {
        if (!domLoadWarned) {
          domLoadWarned = true;
          console.warn("[VALIDATE] linkedom недоступен, DOM-проверки пропущены:", err?.message ?? err);
        }
        return null;
      });
  }
  return domLoader;
}

/**
 * Browser-like reading of nav/footer/scripts. Costs a real parse, so it is
 * capped by size and only used for the link-count and footer-text heuristics
 * that the tokenizer cannot give us.
 */
export async function domSnapshot(code: string): Promise<DomSnapshot | null> {
  if (!code || code.length > DOM_SIZE_LIMIT) return null;
  const parseHTML = await loadDomParser();
  if (!parseHTML) return null;
  try {
    const { document } = parseHTML(code) as any;
    const navs = document.querySelectorAll("nav");
    const footers = document.querySelectorAll("footer");
    const scripts = document.querySelectorAll("script");
    const jsonLd = document.querySelectorAll('script[type="application/ld+json"]');
    const srcs: string[] = [];
    for (const s of scripts) {
      const src = s.getAttribute?.("src");
      if (src) srcs.push(src);
    }
    let footerTextLen = 0;
    for (const f of footers) {
      const text = (f.textContent ?? "").replace(/\s+/g, " ").trim();
      footerTextLen = Math.max(footerTextLen, text.length);
    }
    return {
      navCount: navs.length,
      navLinks: document.querySelectorAll("nav a").length,
      footerCount: footers.length,
      footerTextLen,
      scriptSrcs: srcs,
      scriptCount: scripts.length,
      jsonLdCount: jsonLd.length,
    };
  } catch (err) {
    if (!domLoadWarned) {
      domLoadWarned = true;
      console.warn("[VALIDATE] DOM-разбор не удался:", (err as Error)?.message ?? err);
    }
    return null;
  }
}

// ---------------------------------------------------------------------------
// Post-patch validation
// ---------------------------------------------------------------------------

export interface PatchValidation {
  errors: string[];
  warnings: string[];
}

export interface PatchValidationOptions {
  filename?: string;
  /** Skip the DOM second opinion (keeps the check synchronous). */
  skipDom?: boolean;
  domBefore?: DomSnapshot | null;
  domAfter?: DomSnapshot | null;
}

/**
 * Compares the structure before and after a patch. Reports *regressions* only,
 * so a file that was already unbalanced does not generate noise.
 *
 * The synchronous part (tag balance, placeholders, scripts, nav/footer tokens)
 * is deterministic and safe to gate a rollback on. The DOM part refines it
 * when a linkedom snapshot is available.
 */
export function validatePatchedHtml(before: string, after: string, opts?: PatchValidationOptions): PatchValidation {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!before || !after || before === after) return { errors, warnings };
  const label = opts?.filename ? `${opts.filename}: ` : "";

  // --- placeholders -------------------------------------------------------
  const beforeHolders = new Set(before.match(B64_PLACEHOLDER_RE) ?? []);
  const afterHolders = new Set(after.match(B64_PLACEHOLDER_RE) ?? []);
  const lostHolders = [...beforeHolders].filter((p) => !afterHolders.has(p));
  if (lostHolders.length > 0) {
    errors.push(
      `${label}патч потерял картинку: ${lostHolders.slice(0, 5).join(", ")}${lostHolders.length > 5 ? ` и ещё ${lostHolders.length - 5}` : ""}. ` +
        `Верни этот плейсхолдер в REPLACE.`,
    );
  }

  // --- tag balance --------------------------------------------------------
  const beforeStats = htmlTagStats(before);
  const afterStats = htmlTagStats(after);

  const regressed: { tag: string; delta: number; line: number }[] = [];
  for (const [tag, count] of afterStats.unclosedCount) {
    const delta = count - (beforeStats.unclosedCount.get(tag) ?? 0);
    if (delta <= 0) continue;
    const sample = afterStats.unclosedSamples.find((s) => s.tag === tag);
    regressed.push({ tag, delta, line: sample?.line ?? 0 });
  }
  regressed.sort((a, b) => b.delta - a.delta);
  for (const item of regressed.slice(0, 5)) {
    errors.push(
      `${label}после патча открыт <${item.tag}> без закрывающего (${item.line ? `строка ${item.line}` : "позиция неизвестна"})` +
        `${item.delta > 1 ? `, всего ${item.delta}` : ""}. Добавь </${item.tag}>.`,
    );
  }

  const strayRegressed: { tag: string; delta: number; line: number }[] = [];
  for (const [tag, count] of afterStats.strayCount) {
    const delta = count - (beforeStats.strayCount.get(tag) ?? 0);
    if (delta <= 0) continue;
    const sample = afterStats.straySamples.find((s) => s.tag === tag);
    strayRegressed.push({ tag, delta, line: sample?.line ?? 0 });
  }
  strayRegressed.sort((a, b) => b.delta - a.delta);
  for (const item of strayRegressed.slice(0, 5)) {
    errors.push(
      `${label}после патча появился лишний </${item.tag}>${item.line ? ` на строке ${item.line}` : ""} — открывающего тега нет.`,
    );
  }

  // --- optional-close noise ----------------------------------------------
  for (const [tag, count] of afterStats.looseOptionalCount) {
    const delta = count - (beforeStats.looseOptionalCount.get(tag) ?? 0);
    if (delta > 0) {
      warnings.push(`${label}не закрыт <${tag}> (HTML это допускает, но проверь разметку).`);
    }
  }

  // --- scripts (tokenizer: deterministic) --------------------------------
  const beforeSrcs = new Set(beforeStats.scriptSrcs);
  const afterSrcs = new Set(afterStats.scriptSrcs);
  const lostSrcs = [...beforeSrcs].filter((s) => !afterSrcs.has(s));
  if (lostSrcs.length > 0) {
    errors.push(`${label}патч удалил внешний скрипт: ${lostSrcs.slice(0, 3).join(", ")}. Верни <script src="…"> в REPLACE.`);
  }
  if (afterStats.scriptCount < beforeStats.scriptCount) {
    warnings.push(`${label}скриптов стало меньше: ${beforeStats.scriptCount} → ${afterStats.scriptCount}.`);
  }
  if (afterStats.jsonLdCount < beforeStats.jsonLdCount) {
    warnings.push(`${label}исчез JSON-LD (было ${beforeStats.jsonLdCount}, стало ${afterStats.jsonLdCount}) — это влияет на SEO.`);
  }
  if (beforeStats.navCount > 0 && afterStats.navCount === 0) {
    warnings.push(`${label}пропал <nav> — навигация могла сломаться.`);
  }
  if (beforeStats.footerCount > 0 && afterStats.footerCount === 0) {
    warnings.push(`${label}пропал <footer>.`);
  }

  // --- DOM second opinion (refines with link counts / footer text) --------
  const domBefore = opts?.domBefore ?? null;
  const domAfter = opts?.domAfter ?? null;
  if (domBefore && domAfter) {
    if (domBefore.navLinks > 0 && domAfter.navLinks < domBefore.navLinks) {
      warnings.push(`${label}ссылок в <nav> стало меньше: ${domBefore.navLinks} → ${domAfter.navLinks}.`);
    }
    if (domBefore.footerTextLen > 80 && domAfter.footerTextLen < domBefore.footerTextLen * 0.5) {
      warnings.push(
        `${label}текст <footer> сократился с ${domBefore.footerTextLen} до ${domAfter.footerTextLen} знаков.`,
      );
    }
    if (domBefore.scriptCount > 0 && domAfter.scriptCount === 0) {
      errors.push(`${label}после патча в документе не осталось ни одного <script>.`);
    }
  }

  return { errors, warnings };
}

// ---------------------------------------------------------------------------
// grep
// ---------------------------------------------------------------------------

const GREP_PATTERN_MAX = 200;
const GREP_LINE_CHUNK = 200;
const GREP_LONG_LINE = 300;

export interface GrepOptions {
  pattern: string;
  filename?: string;
  regex?: boolean;
  ignore_case?: boolean;
  max_results?: number;
}

export interface GrepHit {
  file: string;
  line: number;
  column: number;
  text: string;
}

/**
 * Screens a user-supplied regex before it is ever compiled. Node has no
 * synchronous regex timeout, so bounded input plus a shape check is the only
 * real protection against catastrophic backtracking.
 */
export function screenGrepPattern(pattern: string): string | null {
  if (!pattern) return "Пустой pattern.";
  if (pattern.length > GREP_PATTERN_MAX) return `pattern длиннее ${GREP_PATTERN_MAX} знаков — сократи его.`;
  if (/\\[1-9]/.test(pattern)) return "Обратные ссылки (\\1) не поддерживаются — упрости pattern.";
  if (/\\k</.test(pattern)) return "Именованные обратные ссылки (\\k<>) не поддерживаются.";
  if (/\(\?<?[=!]/.test(pattern)) return "Lookahead/lookbehind не поддерживаются — упрости pattern.";
  if (/^\|/.test(pattern) || /\|$/.test(pattern) || /\|\|/.test(pattern) || /\(\s*\|/.test(pattern) || /\|\s*\)/.test(pattern)) {
    return "Пустая альтернатива в pattern — убери лишний `|`.";
  }
  if (/\)\s*[*+]/.test(pattern) || /\)\s*\{\d+,\s*\}/.test(pattern)) {
    return "Группа под квантификатором опасна для скорости — перепиши без `(...)*`.";
  }

  // Count unbounded quantifiers outside character classes.
  let unbounded = 0;
  let i = 0;
  let inClass = false;
  while (i < pattern.length) {
    const ch = pattern[i];
    if (ch === "\\") {
      i += 2;
      continue;
    }
    if (ch === "[") inClass = true;
    else if (ch === "]") inClass = false;
    else if (!inClass) {
      if (ch === "*" || ch === "+") unbounded++;
      else if (ch === "{") {
        const close = pattern.indexOf("}", i);
        if (close !== -1) {
          const bound = pattern.slice(i + 1, close).match(/^(\d+),\s*$/);
          if (bound && Number(bound[1]) >= 50) unbounded++;
          i = close + 1;
          continue;
        }
      }
    }
    i++;
  }
  if (unbounded > 1) return "В pattern больше одного неограниченного квантификатора (*, +, {n,}) — это может подвесить поиск.";
  return null;
}

/** Long lines are split so a `.*`-style pattern cannot scan a whole minified file. */
function grepChunks(line: string): { text: string; offset: number }[] {
  if (line.length <= GREP_LONG_LINE) return [{ text: line, offset: 0 }];
  const chunks: { text: string; offset: number }[] = [];
  for (let at = 0; at < line.length && chunks.length < 200; at += GREP_LINE_CHUNK) {
    chunks.push({ text: line.slice(at, at + GREP_LINE_CHUNK), offset: at });
  }
  return chunks;
}

/**
 * Literal (default) or regex search across the workspace files. Never throws:
 * a bad pattern comes back as `error`.
 */
export function grepFiles(
  files: Map<string, string> | { name: string; code: string }[],
  opts: GrepOptions,
): { hits: GrepHit[]; truncated: boolean; filesScanned: number; error?: string } {
  const pattern = opts.pattern ?? "";
  const maxResults = Math.min(Math.max(opts.max_results ?? 40, 1), 200);
  const ignoreCase = opts.ignore_case !== false;
  const useRegex = opts.regex === true;

  // Empty pattern means indexOf("") === 0 on every line: 200 hits of nothing and
  // a truncated scan, with no error for the model to learn from. Reject it here.
  if (pattern.trim() === "") {
    return { hits: [], truncated: false, filesScanned: 0, error: "Пустой pattern — укажи подстроку или регулярное выражение." };
  }

  let re: RegExp | null = null;
  let needle = pattern;
  if (useRegex) {
    const problem = screenGrepPattern(pattern);
    if (problem) return { hits: [], truncated: false, filesScanned: 0, error: problem };
    try {
      re = new RegExp(pattern, ignoreCase ? "gi" : "g");
    } catch (err) {
      return { hits: [], truncated: false, filesScanned: 0, error: `Некорректный regex: ${(err as Error).message}` };
    }
  } else if (ignoreCase) {
    needle = pattern.toLowerCase();
  }

  const entries: { name: string; code: string }[] = Array.isArray(files)
    ? files
    : [...files.entries()].map(([name, code]) => ({ name, code }));

  const target = opts.filename
    ? entries.filter((e) => e.name.toLowerCase() === opts.filename!.toLowerCase())
    : entries;

  const hits: GrepHit[] = [];
  let truncated = false;
  const deadline = Date.now() + 150;
  let filesScanned = 0;

  outer: for (const entry of target) {
    filesScanned++;
    const lines = splitLines(entry.code);
    for (let i = 0; i < lines.length; i++) {
      // Slice work is the dominant cost; check the budget often enough.
      if ((i & 255) === 0 && Date.now() > deadline) {
        truncated = true;
        break outer;
      }
      const line = lines[i];
      if (!line) continue;
      for (const chunk of grepChunks(line)) {
        let column = -1;
        if (re) {
          re.lastIndex = 0;
          const m = re.exec(chunk.text);
          if (!m) continue;
          column = chunk.offset + m.index;
        } else {
          const at = ignoreCase ? chunk.text.toLowerCase().indexOf(needle) : chunk.text.indexOf(needle);
          if (at === -1) continue;
          column = chunk.offset + at;
        }
        hits.push({
          file: entry.name,
          line: i + 1,
          column: column + 1,
          text: chunk.text.length > 500 ? `${chunk.text.slice(0, 500)}…` : chunk.text,
        });
        if (hits.length >= maxResults) {
          truncated = true;
          break outer;
        }
      }
    }
  }

  return { hits, truncated, filesScanned };
}

// ---------------------------------------------------------------------------
// cat
// ---------------------------------------------------------------------------

export interface CatOptions {
  filename: string;
  start_line?: number;
  end_line?: number;
  max_lines?: number;
  max_chars?: number;
}

export interface CatResult {
  filename: string;
  lines: number;
  start_line: number;
  end_line: number;
  code: string;
  truncated: boolean;
  next_start_line?: number;
  line_clipped?: boolean;
}

/**
 * Numbered slice of one file, Claude-Code style (`12| code`). The numbering is
 * what makes a later SEARCH exact — and `LINE_NUMBER_PREFIX_RE` exists to
 * catch the model copying those numbers back into a patch.
 */
export function catLines(fileCode: string, opts: CatOptions): CatResult {
  const all = splitLines(fileCode);
  const maxLines = Math.min(Math.max(opts.max_lines ?? 200, 1), 400);
  const maxChars = Math.min(Math.max(opts.max_chars ?? 60000, 1000), 120000);
  const start = Math.min(Math.max(opts.start_line ?? 1, 1), Math.max(all.length, 1));
  const explicitEnd = typeof opts.end_line === "number";
  const requestedEnd = opts.end_line ?? start + maxLines - 1;
  const end = Math.min(Math.max(requestedEnd, start), all.length);

  const out: string[] = [];
  let budget = maxChars;
  let lastLine = start - 1;
  let lineClipped = false;
  for (let n = start; n <= end; n++) {
    const raw = all[n - 1] ?? "";
    const text = raw.length > 1000 ? `${raw.slice(0, 1000)}… [строка ${n} обрезана, всего ${raw.length} знаков]` : raw;
    if (text.length !== raw.length) lineClipped = true;
    const rendered = `${n}| ${text}`;
    if (budget - rendered.length < 0) break;
    budget -= rendered.length + 1;
    out.push(rendered);
    lastLine = n;
  }

  // "There is more file after what you read" — not "the file is longer than
  // your window." An explicit end_line is the caller's own boundary: stopping
  // there is not truncation, but stopping *short* of it (char budget) is.
  // Without one, the implied window is the boundary and stopping inside it is,
  // because the caller never asked for "line 50" — the cap did.
  const moreBelow = lastLine < all.length;
  const truncated = moreBelow && (explicitEnd ? lastLine < requestedEnd : true);
  return {
    filename: opts.filename,
    lines: all.length,
    start_line: start,
    end_line: lastLine,
    code: out.join("\n"),
    truncated,
    ...(truncated ? { next_start_line: lastLine + 1 } : {}),
    ...(lineClipped ? { line_clipped: true } : {}),
  };
}

// ---------------------------------------------------------------------------
// rm / write helpers used by the workspace
// ---------------------------------------------------------------------------

/** All `__B64_N__` indices currently present in a file — used to keep new ones unique. */
export function maxB64Index(code: string): number {
  let max = -1;
  B64_PLACEHOLDER_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = B64_PLACEHOLDER_RE.exec(code)) !== null) {
    const n = Number(m[1]);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return max;
}
