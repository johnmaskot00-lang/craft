import { randomUUID } from "node:crypto";
import { parseHTML } from "linkedom";

export const EDIT_IMAGE_LIMIT = 6;
const RATIOS = new Set(["16:9", "9:16", "1:1", "4:3", "3:4"]);
const COUNT_WORDS: Record<string, number> = {
  один: 1, одна: 1, одно: 1, одну: 1, два: 2, две: 2, три: 3, четыре: 4, пять: 5, шесть: 6,
  семь: 7, восемь: 8, девять: 9, десять: 10, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6,
  seven: 7, eight: 8, nine: 9, ten: 10, несколько: 2, several: 2,
};
const IMAGE_NOUN = "(?:изображени[\\p{L}]*|картин(?:к[\\p{L}]*|ок)|фото(?:графи[\\p{L}]*)?|иллюстраци[\\p{L}]*|images?|pictures?|photos?|illustrations?)";
const COUNT = `(?:\\d+|${Object.keys(COUNT_WORDS).join("|")})`;
const RECIPIENT = "(?:(?:мне|me)\\s+)?";
const IMAGE_COUNT = `(?:(?<count>${COUNT})\\s+)?`;
const IMAGE = `${IMAGE_COUNT}(?:(?:a|an|new|нов[а-яё]+)\\s+){0,2}${IMAGE_NOUN}(?![\\p{L}\\p{N}])`;
const DIRECT_VERB = "(?:сгенерируй(?:те)?|генерируй(?:те)?|создай(?:те)?|нарисуй(?:те)?|generate|create|draw)";
const INDIRECT_VERB = "(?:(?:можешь|можете|прошу|нужно|надо)\\s+(?:сгенерировать|создать|нарисовать)|(?:can|could|would) you (?:generate|create|draw))";
const GAP = "(?:\\s*,\\s*(?:пожалуйста|please)\\s*,?\\s+|\\s+)";
// «Сделай» alone also describes resize/recolor. Require a new asset explicitly.
const MAKE_NEW = `сделай(?:те)?${GAP}(?=${RECIPIENT}(?:${COUNT}\\s+)?нов[а-яё]+\\s+)`;
const REQUEST = new RegExp(`(?<![\\p{L}\\p{N}_])(?:(?:(?<indirect>${INDIRECT_VERB})|${DIRECT_VERB})${GAP}|${MAKE_NEW})${RECIPIENT}${IMAGE}`, "gu");
const COMMAND_START = /^[\s*•–—-]*(?:(?:пожалуйста|please)[,\s]+)?$/u;
const EDIT_COMMAND = /^\s*(?:добавь(?:те)?|придумай(?:те)?|обнови(?:те)?|переделай(?:те)?|сделай(?:те)?|add|update|build|design)\s+/u;
const COORDINATED_COMMAND = /(?:^|[^\p{L}\p{N}])(?:и|затем|потом|также|заодно|and|then|also)\s+(?:(?:пожалуйста|please)[,\s]+)?$/u;
const EXPLANATION_OR_CONDITION = /(?:^|[^\p{L}])(?:как|how|если|if)(?![\p{L}])/u;
const EXISTING_IMAGE_EDIT = /^\s+(?:(?:немного|чуть|much|slightly|a bit)\s+)?(?:крупнее|больше|меньше|шире|уже|выше|ниже|темнее|светлее|ярче|ч[её]тче|bigger|larger|smaller|darker|brighter|lighter|wider|narrower)(?![\p{L}\p{N}])/u;
const IMAGE_UI_COMPONENT = /^[\s–—-]+(?:заглушк[\p{L}]*|galler(?:y|ies)|placeholders?|carousels?|sliders?|sections?|grids?|components?|containers?|cards?|blocks?|frames?)(?![\p{L}\p{N}])/u;
const NEGATED_REQUEST = /(?:^|[^\p{L}])(?:не\s+(?:(?:надо|нужно)\s+)?(?:созда|сгенерир|генерир|рису|нарис|с?дела)|без\s+(?:новых\s+)?(?:изображ|картин|фото)|(?:do not|don't|never|without)\s+(?:generate|create|draw|images|pictures))/u;

/** Paid slots must come from the current instruction, outside quoted copy or selected HTML. */
export function requestedEditorImageCount(rawPrompt: string): number | undefined {
  const prompt = rawPrompt.trimStart()
    .replace(/^\[Выбранный элемент:[\s\S]*?\r?\nHTML_END\r?\n\]\s*/i, " ")
    .replace(/```[\s\S]*?(?:```|$)|`[^`\r\n]*`|«[^»]*»|“[^”]*”|„[^“”]*[“”]|"[^"\r\n]*"|(?<![\p{L}\p{N}])'[^'\r\n]*'/gu, "\u0000")
    .toLowerCase();
  if (NEGATED_REQUEST.test(prompt)) return;
  const requests = prompt.split(/[.!?;…\r\n]+/u).flatMap((clause) => [...clause.matchAll(REQUEST)].filter((request) => {
    const before = clause.slice(0, request.index);
    const after = clause.slice(request.index + request[0].length);
    if (EXISTING_IMAGE_EDIT.test(after) || IMAGE_UI_COMPONENT.test(after)) return false;
    if (COMMAND_START.test(before)) return true;
    if (EXPLANATION_OR_CONDITION.test(before)) return false;
    return COORDINATED_COMMAND.test(before) || (!!request.groups?.indirect && EDIT_COMMAND.test(before));
  }));
  if (!requests.length) return;
  return requests.reduce((total, request) => {
    const count = request.groups?.count;
    return total + (count === undefined ? 1 : COUNT_WORDS[count] ?? Number(count));
  }, 0);
}

const MARKER = /\{\{GENIMG:([^{}]+)\}\}/g;
const EXACT_MARKER = /^\{\{GENIMG:([^{}]+)\}\}$/;
const UNRESOLVED_MEDIA = /\{\{\s*(?:GENIMG|SCROLLANIM|ANIMATIONAL|IMG)\s*:[\s\S]*?(?:\}\}|$)|IMGPENDING:[\w+/=]*/gi;
const INACTIVE_IMAGE = "head, title, template, noscript, textarea, svg, math, [hidden]";
const INVALID_IMAGE_POSITION = "Маркер нового изображения должен быть в src активного тега <img>. Видео в этой правке не поддерживается.";

export type EditorImageSlot = { prompt: string; ratio: string; markers: Set<string> };

/** Plan each unique image once. Only a new marker in an active image src can start a paid job. */
export function planEditorImageSlots(changes: readonly { filename: string; before: string; after: string }[]): EditorImageSlot[] {
  const slots = new Map<string, EditorImageSlot>();
  for (const { filename, before, after } of changes) {
    const oldMarkers = new Set(before.match(UNRESOLVED_MEDIA) ?? []);
    const candidates = new Map<string, string>();
    const prefix = `craft-image-${randomUUID()}`;
    // Replace markers only in the parse copy, so HTML entity decoding cannot
    // change the original prompts and each occurrence is validated separately.
    const html = after.replace(UNRESOLVED_MEDIA, (marker) => {
      if (oldMarkers.has(marker)) return marker;
      const token = `${prefix}-${candidates.size}`;
      candidates.set(token, marker);
      return token;
    });
    if (!candidates.size) continue;
    if (!filename.toLowerCase().endsWith(".html")) throw new Error(INVALID_IMAGE_POSITION);

    const { document } = parseHTML(html);
    for (const img of document.querySelectorAll("img")) {
      const token = img.getAttribute("src")?.trim();
      if (!token || img.closest(INACTIVE_IMAGE)) continue;
      const marker = candidates.get(token);
      if (!marker) continue;
      const match = marker.match(EXACT_MARKER);
      if (!match) throw new Error(INVALID_IMAGE_POSITION);
      const parts = match[1].split("|").map((part) => part.trim().replace(/\s+/g, " "));
      const [prompt, ratio = "16:9"] = parts;
      if (!prompt || prompt.length > 900 || parts.length > 2 || !RATIOS.has(ratio)) {
        throw new Error("Некорректное описание или формат нового изображения.");
      }
      candidates.delete(token);
      const key = `${prompt}|${ratio}`;
      const slot = slots.get(key) ?? { prompt, ratio, markers: new Set<string>() };
      slot.markers.add(marker);
      slots.set(key, slot);
    }
    if (candidates.size) throw new Error(INVALID_IMAGE_POSITION);
  }
  return [...slots.values()];
}

export function replaceEditorImageSlots(code: string, urls: ReadonlyMap<string, string>): string {
  return code.replace(MARKER, (marker) => urls.get(marker) ?? marker);
}
