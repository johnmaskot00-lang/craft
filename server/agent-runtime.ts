/**
 * Multipage site agent runtime (Replit-style).
 *
 * - Per-project craft.md — short agent memory (site brief + change log)
 * - Claude (agent V1) function calling via Anthropic SDK → router.cheap (1M context)
 * - Gemini (agent V2) function calling via KIE `tools.functionDeclarations`
 * - Multipage text protocol fallback when tools unavailable
 *
 * Agents can list/read/patch any page, not only the editor's active tab.
 */

import { storage } from "./storage";
import { KieApiError, kieHttpError, nestedErrorCode } from "./kie-errors";
import { routerCheapToolsRound, isRouterCheapConfigured } from "./anthropic";

export const CRAFT_MD_FILENAME = "craft.md";

const KIE_API_KEY = process.env.KIE_API_KEY;
// Gemini V2 still uses KIE; Claude V1 tools go through Anthropic SDK → router.cheap.
const KIE_GEMINI_MODEL = "gemini-3-5-flash";
const KIE_GEMINI_GENERATE_URL = `https://api.kie.ai/gemini/v1/models/${KIE_GEMINI_MODEL}:generateContent`;
/**
 * Never replay the same tool round: after a transport disconnect KIE may still
 * be running the original task. Cross-model fallback is orchestrated by routes
 * only after KIE returned an explicit completed error response.
 */
const KIE_TOOL_ROUND_RETRIES = 1;
/** Hard cap per Gemini tools round — hung sync generateContent must not pin the UI forever. */
const KIE_GEMINI_TOOLS_TIMEOUT_MS = Number(process.env.CRAFT_GEMINI_TOOLS_TIMEOUT_MS) || 4 * 60 * 1000;

export type SitePage = { filename: string; code: string };

export type AgentStatusWriter = (status: string) => void;
export type AgentContentWriter = (chunk: string) => void;

export function isHtmlPage(filename: string): boolean {
  return filename.toLowerCase().endsWith(".html");
}

/** HTML pages + global CSS the multipage/SEO agent may edit. */
export function isEditableSiteFile(filename: string): boolean {
  const f = filename.toLowerCase();
  return f.endsWith(".html") || f.endsWith(".css");
}

export function normalizeSiteFilename(filename: string): string {
  return String(filename || "").trim().replace(/^\/+/, "").toLowerCase();
}

/** Allowed write targets: flat/nested HTML or assets/style.css (SEO). */
export function isValidAgentWriteFilename(filename: string): boolean {
  const f = normalizeSiteFilename(filename);
  if (f === "assets/style.css") return true;
  return /^(?:[a-z0-9][a-z0-9_-]*\/)*[a-z0-9][a-z0-9_-]*\.html$/.test(f);
}

export function stripBase64Images(code: string): { stripped: string; map: Map<string, string> } {
  const map = new Map<string, string>();
  let counter = 0;
  const stripped = code.replace(/data:image\/[^;]+;base64,[A-Za-z0-9+/=]{100,}/g, (match) => {
    const placeholder = `__B64_${counter++}__`;
    map.set(placeholder, match);
    return placeholder;
  });
  return { stripped, map };
}

export function restoreBase64Images(code: string, map: Map<string, string>): string {
  let result = code;
  for (const [placeholder, original] of map) {
    result = result.split(placeholder).join(original);
  }
  return result;
}

function extractPageTitle(code: string): string {
  const title = code.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.replace(/\s+/g, " ").trim();
  if (title) return title.slice(0, 80);
  const h1 = code.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1]?.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
  if (h1) return h1.slice(0, 80);
  return "";
}

function extractSections(code: string): string[] {
  const sections: string[] = [];
  const re = /<(section|header|footer|main|nav)[^>]*(?:id=["']([^"']+)["'])?[^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(code)) !== null && sections.length < 12) {
    const tag = m[1].toLowerCase();
    const id = m[2] || "";
    sections.push(id ? `${tag}#${id}` : tag);
  }
  return sections;
}

export function buildInitialCraftMd(opts: {
  title: string;
  description?: string | null;
  userPrompt?: string;
  pages: SitePage[];
}): string {
  const htmlPages = opts.pages.filter((p) => isHtmlPage(p.filename));
  const pageLines = htmlPages.map((p) => {
    const t = extractPageTitle(p.code);
    const secs = extractSections(p.code);
    return `- \`${p.filename}\`${t ? ` — ${t}` : ""}${secs.length ? ` [${secs.join(", ")}]` : ""}`;
  });

  const brief = (opts.description || opts.userPrompt || opts.title || "Сайт").trim().slice(0, 500);
  const now = new Date().toISOString().slice(0, 19).replace("T", " ");

  return `# craft.md — память агента сайта

> Этот файл читают Claude/Gemini при каждом редактировании. Держи его коротким и точным.

## Сайт
- **Название:** ${opts.title || "Без названия"}
- **Кратко:** ${brief}
- **Создан:** ${now} UTC

## Страницы
${pageLines.length ? pageLines.join("\n") : "- `index.html`"}

## Дизайн и договорённости
- Стек: чистый HTML/CSS/JS без внешних CSS/JS CDN-фреймворков (Google Fonts можно)
- Навбар и футер общие — при правках одной страницы сохраняй навигацию согласованной
- Плейсхолдеры \`__B64_N__\` — встроенные изображения, не трогать

## Журнал изменений
- ${now} — первичная генерация сайта
`;
}

export async function ensureCraftMd(
  projectId: number,
  opts: { title: string; description?: string | null; userPrompt?: string; pages: SitePage[] },
): Promise<string> {
  const existing = await storage.getProjectFile(projectId, CRAFT_MD_FILENAME);
  if (existing?.code?.trim()) return existing.code;

  const md = buildInitialCraftMd(opts);
  await storage.upsertProjectFile({ projectId, filename: CRAFT_MD_FILENAME, code: md });
  return md;
}

export async function refreshCraftMdPages(
  projectId: number,
  pages: SitePage[],
  changeNote?: { userRequest: string; summary: string; changedFiles: string[] },
): Promise<string> {
  const existing = await storage.getProjectFile(projectId, CRAFT_MD_FILENAME);
  let md = existing?.code || "";

  const htmlPages = pages.filter((p) => isHtmlPage(p.filename));
  const pageLines = htmlPages.map((p) => {
    const t = extractPageTitle(p.code);
    const secs = extractSections(p.code);
    return `- \`${p.filename}\`${t ? ` — ${t}` : ""}${secs.length ? ` [${secs.join(", ")}]` : ""}`;
  });

  const pagesBlock = `## Страницы\n${pageLines.length ? pageLines.join("\n") : "- `index.html`"}`;

  if (!md.trim()) {
    md = buildInitialCraftMd({
      title: "Сайт",
      pages,
      userPrompt: changeNote?.userRequest,
    });
  } else if (/## Страницы[\s\S]*?(?=\n## |\n# |$)/.test(md)) {
    md = md.replace(/## Страницы[\s\S]*?(?=\n## |\n# |$)/, pagesBlock + "\n");
  } else {
    md = md.trimEnd() + "\n\n" + pagesBlock + "\n";
  }

  if (changeNote) {
    const now = new Date().toISOString().slice(0, 19).replace("T", " ");
    const files = changeNote.changedFiles.length
      ? changeNote.changedFiles.map((f) => `\`${f}\``).join(", ")
      : "—";
    const req = changeNote.userRequest.replace(/\s+/g, " ").trim().slice(0, 160);
    const sum = changeNote.summary.replace(/\s+/g, " ").trim().slice(0, 220);
    const entry = `- ${now} — ${sum || "правка"} | файлы: ${files}${req ? ` | запрос: «${req}»` : ""}`;

    if (/## Журнал изменений/.test(md)) {
      md = md.replace(/(## Журнал изменений\n)/, `$1${entry}\n`);
      // Keep journal from exploding — max ~40 entries
      const journalMatch = md.match(/## Журнал изменений\n([\s\S]*?)(?=\n## |\n# |$)/);
      if (journalMatch) {
        const lines = journalMatch[1].split("\n").filter((l) => l.startsWith("- "));
        if (lines.length > 40) {
          const kept = lines.slice(0, 40).join("\n");
          md = md.replace(/## Журнал изменений\n[\s\S]*?(?=\n## |\n# |$)/, `## Журнал изменений\n${kept}\n`);
        }
      }
    } else {
      md = md.trimEnd() + `\n\n## Журнал изменений\n${entry}\n`;
    }
  }

  await storage.upsertProjectFile({ projectId, filename: CRAFT_MD_FILENAME, code: md });
  return md;
}

export function buildSiteManifest(pages: SitePage[], craftMd: string): string {
  const htmlPages = pages.filter((p) => isHtmlPage(p.filename));
  const cssPages = pages.filter((p) => p.filename.toLowerCase().endsWith(".css"));
  const lines = [
    ...htmlPages.map((p) => {
      const t = extractPageTitle(p.code);
      const secs = extractSections(p.code);
      return `• ${p.filename} — ${p.code.length} символов${t ? ` — «${t}»` : ""}${secs.length ? ` — секции: ${secs.join(", ")}` : ""}`;
    }),
    ...cssPages.map((p) => `• ${p.filename} — ${p.code.length} символов — глобальные стили сайта`),
  ];

  return `═══ КАРТА САЙТА (все страницы доступны для редактирования) ═══
${lines.join("\n") || "• index.html"}

═══ craft.md (память агента) ═══
${craftMd.slice(0, 6000)}
${craftMd.length > 6000 ? "\n...[craft.md обрезан]" : ""}
`;
}

/** Include full page sources for the agent (with size budget). */
export function buildPagesContext(
  pages: SitePage[],
  activeFile: string,
  maxTotalChars = 110_000,
): { context: string; base64Maps: Map<string, Map<string, string>> } {
  const base64Maps = new Map<string, Map<string, string>>();
  const editable = pages.filter((p) => isEditableSiteFile(p.filename));

  // Prioritize active file, then CSS, then index, then others by size ascending
  const ordered = [...editable].sort((a, b) => {
    if (a.filename === activeFile) return -1;
    if (b.filename === activeFile) return 1;
    if (a.filename === "assets/style.css") return -1;
    if (b.filename === "assets/style.css") return 1;
    if (a.filename === "index.html") return -1;
    if (b.filename === "index.html") return 1;
    return a.code.length - b.code.length;
  });

  let used = 0;
  const parts: string[] = [];

  for (const page of ordered) {
    const { stripped, map } = stripBase64Images(page.code || "");
    base64Maps.set(page.filename, map);

    const header = `\n─── FILE: ${page.filename} ───\n`;
    const remaining = maxTotalChars - used;
    if (remaining < 800) {
      parts.push(`${header}[код не включён — слишком большой контекст; используй инструмент read_page]\n`);
      continue;
    }

    const fence = page.filename.toLowerCase().endsWith(".css") ? "css" : "html";
    if (stripped.length + 200 <= remaining || page.filename === activeFile) {
      const budget = page.filename === activeFile ? Math.min(stripped.length, Math.max(remaining - 200, 20_000)) : Math.min(stripped.length, remaining - 200);
      if (budget >= stripped.length) {
        parts.push(`${header}\`\`\`${fence}\n${stripped}\n\`\`\`\n`);
        used += stripped.length + 200;
      } else {
        parts.push(`${header}\`\`\`${fence}\n${stripped.slice(0, budget)}\n\`\`\`\n...[обрезано ${stripped.length - budget} символов — для полного кода вызови read_page("${page.filename}")]\n`);
        used += budget + 200;
      }
    } else {
      const excerpt = stripped.slice(0, Math.min(1800, remaining - 200));
      parts.push(`${header}(превью ${excerpt.length}/${stripped.length} символов)\n\`\`\`${fence}\n${excerpt}\n\`\`\`\n...[используй read_page для полного файла]\n`);
      used += excerpt.length + 200;
    }
  }

  return { context: parts.join("\n"), base64Maps };
}

/** Extract shared shell (nav + footer) from SEO page HTML for compact agent context. */
export function extractSeoPageShell(code: string): string {
  const nav = code.match(/<nav[\s\S]*?<\/nav>/i)?.[0] || "";
  const footer = code.match(/<footer[\s\S]*?<\/footer>/i)?.[0] || "";
  const bodyCls = code.match(/<body[^>]*class="([^"]*)"/i)?.[1] || "";
  const breadcrumb = code.match(/<div class="breadcrumb"[\s\S]*?<\/div>/i)?.[0]
    || code.match(/<div class="cat-header"[\s\S]*?<\/div>\s*<\/div>/i)?.[0]
    || "";
  return `<!-- body class="${bodyCls}" -->\n${nav}\n${breadcrumb ? `${breadcrumb}\n` : ""}${footer}`.trim();
}

/**
 * SEO sites: full CSS + homepage + compact shells for other pages (nav/footer synced server-side).
 */
export function buildSeoPagesContext(
  pages: SitePage[],
  activeFile: string,
  maxTotalChars = 110_000,
): { context: string; base64Maps: Map<string, Map<string, string>> } {
  const base64Maps = new Map<string, Map<string, string>>();
  const editable = pages.filter((p) => isEditableSiteFile(p.filename));
  const cssPage = editable.find((p) => p.filename.toLowerCase() === "assets/style.css");
  const htmlPages = editable.filter((p) => p.filename.toLowerCase().endsWith(".html"));

  const orderedHtml = [...htmlPages].sort((a, b) => {
    if (a.filename === activeFile) return -1;
    if (b.filename === activeFile) return 1;
    if (a.filename === "index.html") return -1;
    if (b.filename === "index.html") return 1;
    return a.code.length - b.code.length;
  });

  let used = 0;
  const parts: string[] = [
    `Всего HTML-страниц: ${htmlPages.length}. Nav/footer одинаковы — дизайн меню правь в assets/style.css.\n`,
  ];

  if (cssPage) {
    const { stripped, map } = stripBase64Images(cssPage.code || "");
    base64Maps.set(cssPage.filename, map);
    parts.push(`\n─── FILE: assets/style.css (ПОЛНЫЙ — дизайн меню/сетки) ───\n\`\`\`css\n${stripped}\n\`\`\`\n`);
    used += stripped.length + 300;
  }

  for (const page of orderedHtml) {
    const { stripped, map } = stripBase64Images(page.code || "");
    base64Maps.set(page.filename, map);
    const header = `\n─── FILE: ${page.filename} ───\n`;
    const remaining = maxTotalChars - used;
    if (remaining < 600) {
      parts.push(`${header}[не включён — read_page("${page.filename}")]\n`);
      continue;
    }

    const isActive = page.filename === activeFile;
    const isHome = page.filename === "index.html";
    const includeFull = isActive || isHome || stripped.length <= 12_000;

    if (includeFull && stripped.length + 200 <= remaining) {
      parts.push(`${header}\`\`\`html\n${stripped}\n\`\`\`\n`);
      used += stripped.length + 200;
    } else if (includeFull) {
      const budget = isActive ? Math.min(stripped.length, Math.max(remaining - 200, 24_000)) : Math.min(stripped.length, remaining - 200);
      parts.push(`${header}\`\`\`html\n${stripped.slice(0, budget)}\n\`\`\`\n...[обрезано — read_page("${page.filename}")]\n`);
      used += budget + 200;
    } else {
      const shell = extractSeoPageShell(stripped);
      parts.push(`${header}(статья ${stripped.length} симв.; shell nav/footer; текст — read_page)\n\`\`\`html\n${shell}\n\`\`\`\n`);
      used += shell.length + 200;
    }
  }

  return { context: parts.join("\n"), base64Maps };
}

export function buildSeoMultipageEditSystemPrompt(opts: {
  baseSystem: string;
  activeFile: string;
  craftMd: string;
  pages: SitePage[];
  useToolsHint: boolean;
}): string {
  const manifest = buildSiteManifest(opts.pages, opts.craftMd);
  const { context } = buildSeoPagesContext(opts.pages, opts.activeFile);
  const htmlCount = opts.pages.filter((p) => p.filename.toLowerCase().endsWith(".html")).length;

  let prompt = opts.baseSystem;
  prompt += `\n\n${"═".repeat(43)}
РЕЖИМ SEO-САЙТА — MULTIPAGE AGENT (${htmlCount} HTML-страниц)
${"═".repeat(43)}

АРХИТЕКТУРА (КРИТИЧНО):
1. Nav, footer и body class ОДИНАКОВЫ на всех страницах — сервер синхронизирует shell после каждой правки.
2. Дизайн меню и визуальные токены → assets/style.css. Структурные секции главной/категории меняй в HTML только по явной просьбе.
3. НЕ патчи <nav>/<footer> в HTML (кроме явной просьбы изменить текст пункта меню).
4. Правка статьи → только её slug/.../index.html.
5. Сохраняй body-классы structure-v2, family-*, home-*, category-* и article-* — они фиксируют выбранное структурное семейство.
6. Не превращай разные семейства обратно в универсальную hero + одинаковую 3-колоночную сетку. При CSS-правках сохраняй композиционный характер текущего family-*.
7. Не удаляй canonical, Open Graph, JSON-LD, FAQ, key-takeaways, breadcrumbs, внутренние ссылки и логотип из общего shell.
8. Навигация — самостоятельная архитектура конкретного издания: nav-masthead, nav-bar, nav-index, nav-floating, nav-newswire или nav-numbered. Сохраняй её DOM и информационную иерархию; не нормализуй к «логотип слева, ссылки справа».
9. Если пользователь просит новую структуру, сначала определи характер издания и перестрой композицию осмысленно: порядок секций, плотность, ведущий материал, каталог рубрик и режим чтения должны отличаться, а не только цвета/шрифты.
10. ЧИТАЕМОСТЬ НЕПРИКОСНОВЕННА: основной текст 17–19px, line-height 1.65–1.85, ширина 62–76ch; контраст текста не ниже WCAG AA; текст поверх фото только с устойчивым тёмным overlay.
11. Не удаляй маркеры editorial-system-v4 и structural-guard-v5 из assets/style.css. Не делай горизонтальный скролл, микроскопический текст, кислотные фоны или декоративные эффекты, мешающие чтению.

${manifest}

═══ ИСХОДНЫЙ КОД ═══
${context}
`;

  if (opts.useToolsHint) {
    prompt += `
🔧 ИНСТРУМЕНТЫ: apply_patch, write_page, read_page, finish.
Дизайн меню на всех страницах = один патч assets/style.css (nav, .nav-links, .nav-inner).
`;
  }

  return prompt;
}

export const SITE_AGENT_TOOLS = [
  {
    name: "list_pages",
    description: "Список всех HTML-страниц сайта с размерами, title и секциями.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "read_page",
    description: "Прочитать полный код страницы (с плейсхолдерами __B64_N__ вместо base64).",
    input_schema: {
      type: "object",
      properties: {
        filename: { type: "string", description: "Имя файла, например about.html или index.html" },
      },
      required: ["filename"],
      additionalProperties: false,
    },
  },
  {
    name: "apply_patch",
    description:
      "Применить SEARCH/REPLACE патч к любой странице. SEARCH должен точно совпадать с фрагментом кода. Можно вызывать многократно для разных файлов.",
    input_schema: {
      type: "object",
      properties: {
        filename: { type: "string" },
        search: { type: "string", description: "Точный фрагмент существующего кода" },
        replace: { type: "string", description: "Новый код (пустая строка = удалить фрагмент)" },
      },
      required: ["filename", "search", "replace"],
      additionalProperties: false,
    },
  },
  {
    name: "write_page",
    description: "Полностью перезаписать страницу (только если правка затрагивает >50% файла или создаётся новая страница).",
    input_schema: {
      type: "object",
      properties: {
        filename: { type: "string" },
        code: { type: "string", description: "Полный HTML документа" },
      },
      required: ["filename", "code"],
      additionalProperties: false,
    },
  },
  {
    name: "read_craft_md",
    description: "Прочитать craft.md — память агента по этому сайту.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "update_craft_md",
    description: "Обновить раздел «Дизайн и договорённости» или добавить заметку в журнал craft.md.",
    input_schema: {
      type: "object",
      properties: {
        design_notes: { type: "string", description: "Новый текст секции «Дизайн и договорённости» (опционально)" },
        journal_entry: { type: "string", description: "Короткая запись в журнал изменений" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "finish",
    description: "Завершить работу только после всех правок. Итог — нормальный отчёт пользователю в стиле Replit Agent, а не шаблон.",
    input_schema: {
      type: "object",
      properties: {
        summary: { type: "string", description: "2–4 содержательных предложения: что было исправлено, как именно, какие блоки/файлы затронуты и какой результат увидит пользователь. Не повторяй исходный запрос. Не пиши просто «Сайт обновлён», «Готово» или «Выполнил запрос»." },
      },
      required: ["summary"],
      additionalProperties: false,
    },
  },
] as const;

/**
 * Lean tool set for point edits (Replit-style).
 * Pages + craft.md are already in the system prompt — no list/read/craft tools
 * that burn extra KIE rounds. read_page kept only if a file was truncated.
 */
export const SITE_AGENT_EDIT_TOOLS = SITE_AGENT_TOOLS.filter((t) =>
  t.name === "apply_patch" || t.name === "write_page" || t.name === "read_page" || t.name === "finish",
);

export function applySinglePatch(originalCode: string, searchBlock: string, replaceBlock: string): { code: string; ok: boolean; error?: string } {
  if (!searchBlock.trim()) return { code: originalCode, ok: false, error: "empty SEARCH" };

  const exactIdx = originalCode.indexOf(searchBlock);
  if (exactIdx !== -1) {
    const second = originalCode.indexOf(searchBlock, exactIdx + searchBlock.length);
    if (second !== -1) {
      return { code: originalCode, ok: false, error: "SEARCH найден несколько раз — добавь больше контекста" };
    }
    return {
      code: originalCode.slice(0, exactIdx) + replaceBlock + originalCode.slice(exactIdx + searchBlock.length),
      ok: true,
    };
  }

  const pattern = searchBlock
    .trim()
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    .replace(/\s+/g, "\\s+");
  try {
    const re = new RegExp(pattern, "g");
    const matches = [...originalCode.matchAll(re)];
    if (matches.length === 1) {
      const m = matches[0];
      return {
        code: originalCode.slice(0, m.index!) + replaceBlock + originalCode.slice(m.index! + m[0].length),
        ok: true,
      };
    }
    if (matches.length > 1) {
      return { code: originalCode, ok: false, error: "SEARCH (fuzzy) найден несколько раз — добавь больше контекста" };
    }
  } catch { /* ignore */ }

  return { code: originalCode, ok: false, error: "SEARCH не найден" };
}

/** Apply all ```diff SEARCH/REPLACE blocks in a response fragment to one file. */
export function applyDiffPatchesToCode(originalCode: string, responseFragment: string): { code: string; applied: number; total: number } {
  const diffRegex = /```diff\s*\n([\s\S]*?)```/g;
  let patchedCode = originalCode;
  let applied = 0;
  let total = 0;
  let dm: RegExpExecArray | null;
  while ((dm = diffRegex.exec(responseFragment)) !== null) {
    const diffContent = dm[1];
    const searchReplaceRegex = /<{5,}[ \t]*SEARCH[ \t]*\r?\n([\s\S]*?)\r?\n={5,}[ \t]*\r?\n([\s\S]*?)\r?\n>{5,}[ \t]*REPLACE/g;
    let sr: RegExpExecArray | null;
    while ((sr = searchReplaceRegex.exec(diffContent)) !== null) {
      total++;
      const result = applySinglePatch(patchedCode, sr[1], sr[2]);
      if (result.ok) {
        patchedCode = result.code;
        applied++;
      } else {
        console.warn("[AGENT] SEARCH not found. First 80 chars:", sr[1].substring(0, 80));
      }
    }
  }
  // Also accept bare SEARCH/REPLACE without ```diff fence
  if (total === 0 && responseFragment.includes("<<<<<<< SEARCH")) {
    const searchReplaceRegex = /<{5,}[ \t]*SEARCH[ \t]*\r?\n([\s\S]*?)\r?\n={5,}[ \t]*\r?\n([\s\S]*?)\r?\n>{5,}[ \t]*REPLACE/g;
    let sr: RegExpExecArray | null;
    while ((sr = searchReplaceRegex.exec(responseFragment)) !== null) {
      total++;
      const result = applySinglePatch(patchedCode, sr[1], sr[2]);
      if (result.ok) {
        patchedCode = result.code;
        applied++;
      }
    }
  }
  return { code: patchedCode, applied, total };
}

/**
 * Parse multipage edit response:
 * --- FILE: name.html ---
 * ```diff ... ```  and/or ```html ... ```
 */
export function parseMultipageEditResponse(
  fullResponse: string,
  filesMap: Map<string, string>,
  fallbackFile: string,
): { changed: Map<string, string>; applied: number; total: number; aiTextReply: string } {
  const changed = new Map<string, string>();
  let applied = 0;
  let total = 0;

  const firstMarker = fullResponse.search(/---\s*FILE:\s*[^\s\-]+\.html\s*---/i);
  const firstDiff = fullResponse.indexOf("```diff");
  const firstHtml = fullResponse.indexOf("```html");
  const firstCode = [firstDiff, firstHtml].filter((i) => i >= 0).sort((a, b) => a - b)[0] ?? -1;
  let aiTextReply = "";
  if (firstMarker > 0) {
    aiTextReply = fullResponse.substring(0, firstMarker).trim();
  } else if (firstCode > 0) {
    aiTextReply = fullResponse.substring(0, firstCode).trim();
  }

  const fileSectionRegex = /---\s*FILE:\s*([^\s\-]+\.html)\s*---\s*\n?([\s\S]*?)(?=\n---\s*FILE:\s*[^\s\-]+\.html\s*---|$)/gi;
  const sections: { filename: string; body: string }[] = [];
  let fm: RegExpExecArray | null;
  while ((fm = fileSectionRegex.exec(fullResponse)) !== null) {
    sections.push({ filename: fm[1].trim().toLowerCase(), body: fm[2] });
  }

  if (sections.length > 0) {
    for (const sec of sections) {
      const original = filesMap.get(sec.filename) ?? (sec.filename === "index.html" ? filesMap.get("index.html") : undefined) ?? "";
      if (sec.body.includes("<<<<<<< SEARCH") || sec.body.includes("```diff")) {
        const { stripped, map } = stripBase64Images(original);
        const patch = applyDiffPatchesToCode(stripped, sec.body);
        total += patch.total;
        applied += patch.applied;
        if (patch.applied > 0) {
          changed.set(sec.filename, restoreBase64Images(patch.code, map));
        }
      } else {
        const htmlMatch = sec.body.match(/```html\s*\n?([\s\S]*?)```/i);
        let code = htmlMatch?.[1]?.trim() || "";
        if (!code && /<!DOCTYPE\s+html|<html[\s>]/i.test(sec.body)) {
          code = sec.body.replace(/^[\s\S]*?(<!DOCTYPE\s+html|<html[\s>])/i, "$1").trim();
        }
        if (code && code.includes("<") && code.length > 50) {
          total++;
          applied++;
          changed.set(sec.filename, code);
        }
      }
    }
  } else if (fullResponse.includes("<<<<<<< SEARCH") || fullResponse.includes("```diff")) {
    // Legacy: diffs target active/fallback file only
    const original = filesMap.get(fallbackFile) || filesMap.get("index.html") || "";
    const { stripped, map } = stripBase64Images(original);
    const patch = applyDiffPatchesToCode(stripped, fullResponse);
    total = patch.total;
    applied = patch.applied;
    if (patch.applied > 0) {
      changed.set(fallbackFile, restoreBase64Images(patch.code, map));
    }
  }

  return { changed, applied, total, aiTextReply };
}

export function buildMultipageEditSystemPrompt(opts: {
  baseSystem: string;
  activeFile: string;
  craftMd: string;
  pages: SitePage[];
  useToolsHint: boolean;
}): string {
  const manifest = buildSiteManifest(opts.pages, opts.craftMd);
  const { context } = buildPagesContext(opts.pages, opts.activeFile);

  let prompt = opts.baseSystem;
  prompt += `\n\n${"═".repeat(43)}
РЕЖИМ РЕДАКТИРОВАНИЯ САЙТА — MULTIPAGE AGENT
${"═".repeat(43)}
Пользователь сейчас смотрит файл «${opts.activeFile}», но ты видишь ВЕСЬ сайт и можешь менять ЛЮБУЮ страницу (и несколько сразу), если запрос этого требует.

⚠️ ПРАВИЛА:
1. Меняй только то, что просит пользователь; сохраняй nav/footer и ссылки между страницами
2. Если в запросе указан конкретный блок (hero, «Выбранный элемент», section#id, class) — правь ТОЛЬКО его. Не переписывай соседние секции «заодно»
3. Плейсхолдеры __B64_N__ — изображения. НЕ удаляй и НЕ меняй их
4. Если правка затрагивает общий стиль/навигацию — обнови все затронутые страницы
5. Запрещено вызывать finish без реального apply_patch/write_page, который меняет код
6. Запрещены no-op патчи (SEARCH == REPLACE) и патчи «ради галочки»
7. ИНТЕРАКТИВНЫЙ HERO: секции с data-craft-scrollanim / data-frames / data-video / data-base / data-reveal / data-craft-motion и следующие за ними <style>/<script> — НЕ удаляй и НЕ переписывай целиком, если пользователь явно не просит убрать анимацию. Меняй только текст оверлеев. Не подменяй /objects/... на внешние стоки (Vimeo и т.п.)
8. GEO: не выкидывай JSON-LD, FAQ, canonical и ссылку на /llms.txt

${manifest}

═══ ИСХОДНЫЙ КОД СТРАНИЦ ═══
${context}
`;

  if (opts.useToolsHint) {
    prompt += `
🔧 ИНСТРУМЕНТЫ (быстрый Replit-стиль):
Доступны: apply_patch, write_page, read_page (только если файл обрезан), finish.
Код страниц и craft.md УЖЕ в контексте выше — НЕ трать шаги на list_pages / read_craft_md / update_craft_md (журнал обновит сервер).

⚡ ЦЕЛЬ: уложиться в 1–2 шага.
1) Сразу apply_patch (можно несколько патчей параллельно на нужные файлы) — код ДОЛЖЕН реально измениться
2) В том же ответе вызови finish(summary) — 2–4 предложения: проблема → конкретное решение → видимый результат → затронутые файлы. Не повторяй запрос пользователя и не начинай с шаблонного «Готово»
Если не можешь найти точный фрагмент — НЕ вызывай finish с «Сайт обновлён»; верни ошибку через неуспешный патч и уточни.
Не переписывай весь файл через write_page для мелкой правки (центрирование, шрифт, цвет, текст).
Не удаляй текст и секции, которые пользователь не просил убирать.
Не выводи огромный HTML в чат.
`;
  } else {
    prompt += `
🔧 ФОРМАТ ОТВЕТА — MULTIPAGE DIFF (не полный сайт целиком!):
1) 1-3 предложения о изменениях
2) Для КАЖДОГО изменяемого файла блок:

--- FILE: имя.html ---
\`\`\`diff
<<<<<<< SEARCH
точный фрагмент существующего кода
=======
новый код
>>>>>>> REPLACE
\`\`\`

Можно несколько SEARCH/REPLACE внутри одного файла и несколько --- FILE: --- блоков.
Полный \`\`\`html используй только если переписываешь >50% файла или создаёшь новую страницу.
`;
  }

  return prompt;
}

type ClaudeContentBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> };

function toolStatusLabel(name: string, input: Record<string, unknown>): string {
  return name === "read_page" ? `Читаю ${input.filename || "страницу"}…`
    : name === "apply_patch" ? `Патчу ${input.filename || "файл"}…`
    : name === "write_page" ? `Записываю ${input.filename || "файл"}…`
    : name === "list_pages" ? "Смотрю все страницы…"
    : name === "update_craft_md" ? "Обновляю craft.md…"
    : name === "read_craft_md" ? "Читаю craft.md…"
    : name === "finish" ? "Завершаю…"
    : `Инструмент ${name}…`;
}

/** Anthropic tools → Gemini functionDeclarations (KIE Gemini shape). */
function toGeminiFunctionDeclarations(tools: readonly any[]) {
  return tools.map((t) => {
    const props = (t.input_schema as any).properties || {};
    const required = (t.input_schema as any).required as string[] | undefined;
    const parameters: any = {
      type: "object",
      properties: props,
    };
    if (required?.length) parameters.required = required;
    return {
      name: t.name,
      description: t.description,
      parameters,
    };
  });
}

function isTransientKieStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

async function sleep(ms: number) {
  await new Promise((r) => setTimeout(r, ms));
}

async function kieClaudeToolsRound(
  messages: any[],
  systemPrompt: string,
  tools: readonly any[],
): Promise<{ content: ClaudeContentBlock[]; stop_reason: string; toolsSupported: boolean }> {
  if (!isRouterCheapConfigured()) throw new Error("ROUTER_CHEAP_API_KEY missing");

  let lastErr: unknown;
  for (let attempt = 0; attempt < KIE_TOOL_ROUND_RETRIES; attempt++) {
    try {
      const round = await routerCheapToolsRound({
        messages,
        systemPrompt,
        tools,
      });
      return {
        content: round.content as ClaudeContentBlock[],
        stop_reason: round.stop_reason,
        toolsSupported: round.toolsSupported,
      };
    } catch (e) {
      lastErr = e;
      const msg = String((e as any)?.message || e);
      const status = Number((e as any)?.status || (e as any)?.statusCode || 0);
      if ((status === 400 || status === 422 || /tool/i.test(msg)) && !(e as any)?.status) {
        // already handled inside routerCheapToolsRound as toolsSupported:false
      }
      const transient =
        (e as any)?.confirmedKieFailure === true ||
        /fetch failed|network|econnreset|etimedout|socket/i.test(msg);
      if (transient && attempt < KIE_TOOL_ROUND_RETRIES - 1) {
        const delay = (attempt + 1) * 1500;
        console.warn(`[AGENT] Claude router.cheap network error, retry in ${delay}ms:`, msg.slice(0, 160));
        await sleep(delay);
        continue;
      }
      if (/fetch failed|network|econnreset|etimedout|socket/i.test(msg) || nestedErrorCode(e)) {
        const code = nestedErrorCode(e) || "TRANSPORT_ERROR";
        throw new KieApiError(`Claude router.cheap transport error (${code}): ${msg}`, {
          source: "network",
          cause: e,
        });
      }
      if (status >= 400) {
        throw kieHttpError(status, msg, "Claude router.cheap");
      }
      throw e;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

type GeminiToolCall = { name: string; args: Record<string, unknown>; id?: string };

async function kieGeminiToolsRound(
  contents: any[],
  systemPrompt: string,
  tools: readonly any[] = SITE_AGENT_EDIT_TOOLS,
): Promise<{ text: string; functionCalls: GeminiToolCall[]; modelParts: any[]; toolsSupported: boolean }> {
  if (!KIE_API_KEY) throw new Error("KIE_API_KEY missing");

  const body: any = {
    stream: false,
    contents,
    tools: [{ functionDeclarations: toGeminiFunctionDeclarations(tools) }],
    toolConfig: { functionCallingConfig: { mode: "AUTO" } },
  };
  if (systemPrompt) {
    body.systemInstruction = { parts: [{ text: systemPrompt }] };
  }

  let lastErr: unknown;
  for (let attempt = 0; attempt < KIE_TOOL_ROUND_RETRIES; attempt++) {
    const ac = new AbortController();
    const kill = setTimeout(() => ac.abort(), KIE_GEMINI_TOOLS_TIMEOUT_MS);
    kill.unref?.();
    try {
      const resp = await fetch(KIE_GEMINI_GENERATE_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${KIE_API_KEY}`,
        },
        body: JSON.stringify(body),
        signal: ac.signal,
      });

      if (!resp.ok) {
        const err = await resp.text();
        if (resp.status === 400 || resp.status === 422 || /tool|function/i.test(err)) {
          console.warn("[AGENT] Gemini tools rejected by KIE:", resp.status, err.slice(0, 300));
          return { text: "", functionCalls: [], modelParts: [], toolsSupported: false };
        }
        if (isTransientKieStatus(resp.status) && attempt < KIE_TOOL_ROUND_RETRIES - 1) {
          const delay = (attempt + 1) * 1500;
          console.warn(`[AGENT] Gemini KIE ${resp.status}, retry in ${delay}ms (${attempt + 1}/${KIE_TOOL_ROUND_RETRIES})`);
          await sleep(delay);
          continue;
        }
        throw kieHttpError(resp.status, err, "Gemini KIE");
      }

      const data = (await resp.json()) as any;
      // KIE may return HTTP 200 with {code,msg} on auth/quota failures.
      const kieCode = Number(data?.code);
      if (
        Number.isFinite(kieCode) &&
        kieCode !== 200 &&
        kieCode !== 0 &&
        !data?.candidates
      ) {
        const msg = String(data?.msg || data?.message || data?.error || "KIE error").slice(0, 400);
        throw kieHttpError(kieCode >= 400 && kieCode < 600 ? kieCode : 502, msg, "Gemini KIE");
      }
      const parts: any[] = data?.candidates?.[0]?.content?.parts || [];
      let text = "";
      const functionCalls: GeminiToolCall[] = [];
      for (const part of parts) {
        if (part.text) text += part.text;
        if (part.functionCall?.name) {
          let args: Record<string, unknown> = {};
          const raw = part.functionCall.args ?? part.functionCall.arguments;
          if (raw && typeof raw === "object") args = raw as Record<string, unknown>;
          else if (typeof raw === "string") {
            try { args = JSON.parse(raw); } catch { args = {}; }
          }
          functionCalls.push({
            name: part.functionCall.name,
            args,
            id: part.functionCall.id,
          });
        }
      }
      return { text, functionCalls, modelParts: parts, toolsSupported: true };
    } catch (e) {
      lastErr = e;
      const msg = String((e as any)?.message || e);
      const aborted = (e as any)?.name === "AbortError" || /aborted|AbortError/i.test(msg);
      if (aborted) {
        throw new KieApiError(
          `Gemini KIE tools round timed out after ${Math.round(KIE_GEMINI_TOOLS_TIMEOUT_MS / 1000)}s`,
          { source: "network", cause: e },
        );
      }
      const transient =
        (e as any)?.confirmedKieFailure === true ||
        /fetch failed|network|econnreset|etimedout|socket/i.test(msg);
      if (transient && attempt < KIE_TOOL_ROUND_RETRIES - 1) {
        const delay = (attempt + 1) * 1500;
        console.warn(`[AGENT] Gemini KIE network error, retry in ${delay}ms:`, msg.slice(0, 160));
        await sleep(delay);
        continue;
      }
      if (/fetch failed|network|econnreset|etimedout|socket/i.test(msg) || nestedErrorCode(e)) {
        const code = nestedErrorCode(e) || "TRANSPORT_ERROR";
        throw new KieApiError(`Gemini KIE transport error (${code}): ${msg}`, {
          source: "network",
          cause: e,
        });
      }
      throw e;
    } finally {
      clearTimeout(kill);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

class SiteWorkspace {
  files: Map<string, string>;
  craftMd: string;
  changedFiles = new Set<string>();
  /** Successful apply_patch / write_page mutations (excludes no-ops). */
  patchCount = 0;
  private base64Maps = new Map<string, Map<string, string>>();

  constructor(pages: SitePage[], craftMd: string) {
    this.files = new Map();
    for (const p of pages) {
      const fn = normalizeSiteFilename(p.filename);
      if (fn === CRAFT_MD_FILENAME) continue;
      if (!isHtmlPage(fn) && !fn.endsWith(".css")) continue;
      const { stripped, map } = stripBase64Images(p.code || "");
      this.files.set(fn, stripped);
      this.base64Maps.set(fn, map);
    }
    this.craftMd = craftMd;
  }

  getRestoredFiles(): Map<string, string> {
    const out = new Map<string, string>();
    for (const [fn, code] of this.files) {
      out.set(fn, restoreBase64Images(code, this.base64Maps.get(fn) || new Map()));
    }
    return out;
  }

  execute(name: string, input: Record<string, unknown>): { result: unknown; finished?: string } {
    switch (name) {
      case "list_pages": {
        const list = [...this.files.entries()].map(([filename, code]) => ({
          filename,
          chars: code.length,
          title: extractPageTitle(code),
          sections: extractSections(code),
        }));
        return { result: { pages: list } };
      }
      case "read_page": {
        const filename = String(input.filename || "").trim().toLowerCase();
        const code = this.files.get(filename);
        if (code === undefined) return { result: { error: `Файл не найден: ${filename}`, available: [...this.files.keys()] } };
        return { result: { filename, code, chars: code.length } };
      }
      case "apply_patch": {
        const filename = String(input.filename || "").trim().toLowerCase();
        const search = String(input.search ?? "");
        const replace = String(input.replace ?? "");
        if (!this.files.has(filename)) {
          // Allow creating via patch only if file exists; use write_page for new
          return { result: { ok: false, error: `Файл не найден: ${filename}` } };
        }
        const current = this.files.get(filename)!;
        const { code, ok } = applySinglePatch(current, search, replace);
        if (!ok) return { result: { ok: false, error: "SEARCH не найден или неоднозначен. Перечитай read_page и уточни уникальный фрагмент." } };
        if (code === current) {
          return { result: { ok: false, error: "Патч ничего не меняет — SEARCH и REPLACE дают тот же код. Уточни фрагмент." } };
        }
        this.files.set(filename, code);
        this.changedFiles.add(filename);
        this.patchCount += 1;
        return { result: { ok: true, filename, newChars: code.length } };
      }
      case "write_page": {
        const filename = String(input.filename || "").trim().toLowerCase();
        let code = String(input.code ?? "");
        if (!isValidAgentWriteFilename(filename)) {
          return { result: { ok: false, error: "Имя файла: name.html, category/slug/index.html или assets/style.css" } };
        }
        if (filename.endsWith(".css")) {
          if (code.length < 20) return { result: { ok: false, error: "CSS слишком короткий" } };
        } else if (!code.includes("<") || code.length < 50) {
          return { result: { ok: false, error: "code слишком короткий или не HTML" } };
        }
        // Preserve existing base64 map if rewriting known file
        if (!this.base64Maps.has(filename)) this.base64Maps.set(filename, new Map());
        const { stripped, map } = stripBase64Images(code);
        // Merge maps
        const existing = this.base64Maps.get(filename)!;
        for (const [k, v] of map) existing.set(k, v);
        const prev = this.files.get(filename);
        if (prev !== undefined && prev === stripped) {
          return { result: { ok: false, error: "write_page не меняет файл — код совпадает с текущим." } };
        }
        this.files.set(filename, stripped);
        this.changedFiles.add(filename);
        this.patchCount += 1;
        return { result: { ok: true, filename, chars: stripped.length } };
      }
      case "read_craft_md":
        return { result: { craft_md: this.craftMd } };
      case "update_craft_md": {
        const design = typeof input.design_notes === "string" ? input.design_notes.trim() : "";
        const journal = typeof input.journal_entry === "string" ? input.journal_entry.trim() : "";
        if (design) {
          const block = `## Дизайн и договорённости\n${design}\n`;
          if (/## Дизайн и договорённости[\s\S]*?(?=\n## |\n# |$)/.test(this.craftMd)) {
            this.craftMd = this.craftMd.replace(/## Дизайн и договорённости[\s\S]*?(?=\n## |\n# |$)/, block);
          } else {
            this.craftMd = this.craftMd.trimEnd() + "\n\n" + block;
          }
        }
        if (journal) {
          const now = new Date().toISOString().slice(0, 19).replace("T", " ");
          const entry = `- ${now} — ${journal.slice(0, 240)}`;
          if (/## Журнал изменений/.test(this.craftMd)) {
            this.craftMd = this.craftMd.replace(/(## Журнал изменений\n)/, `$1${entry}\n`);
          } else {
            this.craftMd = this.craftMd.trimEnd() + `\n\n## Журнал изменений\n${entry}\n`;
          }
        }
        this.changedFiles.add(CRAFT_MD_FILENAME);
        return { result: { ok: true } };
      }
      case "finish": {
        const summary = String(input.summary || "Готово").trim();
        if (this.patchCount === 0) {
          return {
            result: {
              ok: false,
              error: "Нельзя завершить задачу без реального изменения кода. Сначала вызови apply_patch или write_page.",
            },
          };
        }
        return { result: { ok: true }, finished: summary };
      }
      default:
        return { result: { error: `Неизвестный инструмент: ${name}` } };
    }
  }
}

export type ToolAgentResult = {
  ok: boolean;
  usedTools: boolean;
  toolsSupported: boolean;
  summary: string;
  changedFiles: Map<string, string>;
  craftMd: string;
  streamedText: string;
  /** Number of mutating patches/writes that actually changed code. */
  patchCount?: number;
};

/**
 * Function-calling agent loop (Claude or Gemini via KIE).
 * Returns toolsSupported:false when KIE rejects tools so the caller can fall
 * back to streaming multipage text protocol.
 */
export async function runToolCallingAgent(opts: {
  systemPrompt: string;
  userPrompt: string;
  pages: SitePage[];
  craftMd: string;
  history?: { role: "user" | "assistant"; text: string }[];
  onStatus?: AgentStatusWriter;
  onContent?: AgentContentWriter;
  maxRounds?: number;
  /** Default claude. Gemini uses KIE functionDeclarations. */
  provider?: "claude" | "gemini";
  /** Override tool list (edits use SITE_AGENT_EDIT_TOOLS by default). */
  tools?: readonly any[];
}): Promise<ToolAgentResult> {
  const provider = opts.provider || "claude";
  if (provider === "gemini") {
    return runGeminiToolCallingAgent(opts);
  }
  return runClaudeToolCallingAgent(opts);
}

/**
 * Never stop immediately after the first mutation. The model must receive tool
 * results, verify every part of the request, and call finish with an accountable
 * summary. This is shared by V1 and V2.
 */
function shouldStopAfterEditRound(
  _toolNames: string[],
  changedBefore: number,
  changedAfter: number,
  finished?: string,
): boolean {
  // finish alone (no mutations) must NOT stop as success — caller will treat empty changes as failure.
  if (finished !== undefined) return changedAfter > changedBefore;
  if (changedAfter <= changedBefore) return false;
  return false;
}

async function runClaudeToolCallingAgent(opts: {
  systemPrompt: string;
  userPrompt: string;
  pages: SitePage[];
  craftMd: string;
  history?: { role: "user" | "assistant"; text: string }[];
  onStatus?: AgentStatusWriter;
  onContent?: AgentContentWriter;
  maxRounds?: number;
  tools?: readonly any[];
}): Promise<ToolAgentResult> {
  const workspace = new SiteWorkspace(opts.pages, opts.craftMd);
  const messages: any[] = [];
  const tools = opts.tools || SITE_AGENT_EDIT_TOOLS;

  for (const h of opts.history || []) {
    messages.push({ role: h.role, content: [{ type: "text", text: h.text }] });
  }
  messages.push({ role: "user", content: [{ type: "text", text: opts.userPrompt }] });

  let summary = "";
  let streamedText = "";
  // Point edits should finish in 1–2 KIE calls; hard cap keeps cost predictable.
  const maxRounds = opts.maxRounds ?? 4;

  for (let round = 0; round < maxRounds; round++) {
    opts.onStatus?.(`Агент думает… (шаг ${round + 1}/${maxRounds})`);
    const heartbeat = setInterval(() => {
      opts.onStatus?.(`Агент думает… (шаг ${round + 1}/${maxRounds})`);
    }, 12_000);
    heartbeat.unref?.();
    let roundResult: Awaited<ReturnType<typeof kieClaudeToolsRound>>;
    try {
      roundResult = await kieClaudeToolsRound(messages, opts.systemPrompt, tools);
    } finally {
      clearInterval(heartbeat);
    }

    if (!roundResult.toolsSupported) {
      return {
        ok: false,
        usedTools: false,
        toolsSupported: false,
        summary: "",
        changedFiles: new Map(),
        craftMd: workspace.craftMd,
        streamedText: "",
      };
    }

    messages.push({ role: "assistant", content: roundResult.content });

    const toolUses = roundResult.content.filter((c): c is Extract<ClaudeContentBlock, { type: "tool_use" }> => c.type === "tool_use");
    for (const block of roundResult.content) {
      if (block.type === "text" && block.text) {
        streamedText += block.text;
        opts.onContent?.(block.text);
      }
    }

    if (toolUses.length === 0) {
      summary = streamedText.trim().slice(0, 500);
      break;
    }

    const toolResults: any[] = [];
    let finishedSummary: string | undefined;
    const changedBefore = workspace.changedFiles.size;
    const toolNames: string[] = [];

    for (const tu of toolUses) {
      toolNames.push(tu.name);
      opts.onStatus?.(toolStatusLabel(tu.name, tu.input || {}));
      const { result, finished } = workspace.execute(tu.name, tu.input || {});
      if (finished) finishedSummary = finished;
      toolResults.push({
        type: "tool_result",
        tool_use_id: tu.id,
        content: JSON.stringify(result),
      });
    }

    messages.push({ role: "user", content: toolResults });

    if (finishedSummary !== undefined) {
      summary = finishedSummary;
      opts.onContent?.(finishedSummary.startsWith(streamedText) ? "" : (streamedText ? `\n\n${finishedSummary}` : finishedSummary));
      if (!streamedText.includes(finishedSummary)) streamedText = (streamedText ? streamedText + "\n\n" : "") + finishedSummary;
      break;
    }

    if (shouldStopAfterEditRound(toolNames, changedBefore, workspace.changedFiles.size, finishedSummary)) {
      summary = streamedText.trim().slice(0, 500);
      break;
    }
  }

  return finalizeToolAgentResult(workspace, summary, streamedText);
}

async function runGeminiToolCallingAgent(opts: {
  systemPrompt: string;
  userPrompt: string;
  pages: SitePage[];
  craftMd: string;
  history?: { role: "user" | "assistant"; text: string }[];
  onStatus?: AgentStatusWriter;
  onContent?: AgentContentWriter;
  maxRounds?: number;
  tools?: readonly any[];
}): Promise<ToolAgentResult> {
  const workspace = new SiteWorkspace(opts.pages, opts.craftMd);
  const contents: any[] = [];
  const tools = opts.tools || SITE_AGENT_EDIT_TOOLS;

  for (const h of opts.history || []) {
    contents.push({
      role: h.role === "assistant" ? "model" : "user",
      parts: [{ text: h.text }],
    });
  }
  contents.push({ role: "user", parts: [{ text: opts.userPrompt }] });

  let summary = "";
  let streamedText = "";
  const maxRounds = opts.maxRounds ?? 4;

  for (let round = 0; round < maxRounds; round++) {
    opts.onStatus?.(`Gemini-агент думает… (шаг ${round + 1}/${maxRounds})`);
    // Keep SSE alive while KIE sync generateContent waits (can be minutes).
    const heartbeat = setInterval(() => {
      opts.onStatus?.(`Gemini-агент думает… (шаг ${round + 1}/${maxRounds})`);
    }, 12_000);
    heartbeat.unref?.();
    let roundResult: Awaited<ReturnType<typeof kieGeminiToolsRound>>;
    try {
      roundResult = await kieGeminiToolsRound(contents, opts.systemPrompt, tools);
    } finally {
      clearInterval(heartbeat);
    }

    if (!roundResult.toolsSupported) {
      return {
        ok: false,
        usedTools: false,
        toolsSupported: false,
        summary: "",
        changedFiles: new Map(),
        craftMd: workspace.craftMd,
        streamedText: "",
      };
    }

    if (roundResult.text) {
      streamedText += roundResult.text;
      opts.onContent?.(roundResult.text);
    }

    if (roundResult.functionCalls.length === 0) {
      summary = streamedText.trim().slice(0, 500);
      break;
    }

    // Append model turn (functionCall parts — required for Gemini multi-turn tools)
    contents.push({
      role: "model",
      parts: roundResult.modelParts.length
        ? roundResult.modelParts
        : roundResult.functionCalls.map((fc) => ({ functionCall: { name: fc.name, args: fc.args } })),
    });

    const responseParts: any[] = [];
    let finishedSummary: string | undefined;
    const changedBefore = workspace.changedFiles.size;
    const toolNames: string[] = [];

    for (const fc of roundResult.functionCalls) {
      toolNames.push(fc.name);
      opts.onStatus?.(toolStatusLabel(fc.name, fc.args || {}));
      const { result, finished } = workspace.execute(fc.name, fc.args || {});
      if (finished) finishedSummary = finished;
      // Gemini expects functionResponse.response to be a JSON object (not a string)
      const responseObj =
        result && typeof result === "object" && !Array.isArray(result)
          ? (result as Record<string, unknown>)
          : { result };
      responseParts.push({
        functionResponse: {
          name: fc.name,
          response: responseObj,
        },
      });
    }

    contents.push({ role: "user", parts: responseParts });

    if (finishedSummary !== undefined) {
      summary = finishedSummary;
      opts.onContent?.(finishedSummary.startsWith(streamedText) ? "" : (streamedText ? `\n\n${finishedSummary}` : finishedSummary));
      if (!streamedText.includes(finishedSummary)) streamedText = (streamedText ? streamedText + "\n\n" : "") + finishedSummary;
      break;
    }

    if (shouldStopAfterEditRound(toolNames, changedBefore, workspace.changedFiles.size, finishedSummary)) {
      summary = streamedText.trim().slice(0, 500);
      break;
    }
  }

  return finalizeToolAgentResult(workspace, summary, streamedText);
}

function finalizeToolAgentResult(
  workspace: SiteWorkspace,
  summary: string,
  streamedText: string,
): ToolAgentResult {
  const restored = workspace.getRestoredFiles();
  const changed = new Map<string, string>();
  for (const fn of workspace.changedFiles) {
    if (fn === CRAFT_MD_FILENAME) continue;
    const code = restored.get(fn);
    if (code !== undefined) changed.set(fn, code);
  }

  return {
    ok: changed.size > 0,
    usedTools: true,
    toolsSupported: true,
    summary: summary || streamedText.trim().slice(0, 400),
    changedFiles: changed,
    craftMd: workspace.craftMd,
    streamedText,
    patchCount: workspace.patchCount,
  };
}
