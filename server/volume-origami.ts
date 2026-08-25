/**
 * «Объём» (volume) — interactive style: cutout layers stacked like origami
 * (Floria / soft-skill Z-Axis Cascade). No Kling video — image-led depth.
 *
 * Markers: {{GENIMG:prompt|ratio|CUTOUT}} → white-studio isolate + alpha punch.
 */

export const VOLUME_MAX_IMAGES = 10;
export const VOLUME_MAX_CUTOUTS = 7;
export const VOLUME_MIN_BLOCKS = 4;
export const VOLUME_IMAGE_PHASE_MS = 900_000;

/** Appended to cutout GENIMG prompts before KIE. */
export function withVolumeCutoutBooster(prompt: string): string {
  const base = String(prompt || "").trim().replace(/\s+/g, " ");
  const lock =
    "isolated subject cutout on pure solid white #FFFFFF background, no floor, " +
    "no backdrop, no environment, no drop shadow on the background, subject fully " +
    "separated, soft studio rim light on the subject only, photorealistic, ultra high resolution";
  if (/pure solid white|#FFFFFF|transparent background|isolated subject cutout/i.test(base)) {
    return base;
  }
  return `${base}, ${lock}`;
}

/**
 * Near-white → alpha so cutouts layer like Floria PNGs.
 * Softens edges so the punch does not look jagged.
 */
export async function punchWhiteBackgroundToPng(buf: Buffer): Promise<Buffer> {
  const sharp = (await import("sharp")).default;
  const { data, info } = await sharp(buf)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const thrHard = 248;
  const thrSoft = 228;
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const min = Math.min(r, g, b);
    const max = Math.max(r, g, b);
    // Only punch near-neutral whites (avoid bleaching pale product colors).
    if (min >= thrHard && max - min < 18) {
      data[i + 3] = 0;
    } else if (min >= thrSoft && max - min < 28) {
      const t = (min - thrSoft) / (thrHard - thrSoft);
      data[i + 3] = Math.max(0, Math.min(255, Math.round(255 * (1 - t))));
    }
  }
  return sharp(data, {
    raw: { width: info.width, height: info.height, channels: 4 },
  })
    .png()
    .toBuffer();
}

export function buildVolumeNicheAddon(userPrompt: string, projectTitle?: string): string {
  const brief = [projectTitle, userPrompt]
    .filter(Boolean)
    .join(" — ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 500);
  if (!brief) return "";
  return `\n\n═══ НИША ЭТОГО КЛИЕНТА ═══
Запрос: ${brief}
Все cutout-объекты и атмосфера должны узнаваемо отражать ЭТУ нишу.
═══ КОНЕЦ НИШИ ═══\n`;
}

/** Vanilla runtime: parallax/hover on live origami layers. */
export const VOLUME_RUNTIME_SCRIPT = `<script>(function(){if(window.__craftVolume)return;window.__craftVolume=1;
function ready(){try{window.__craftAnimReady=true;window.dispatchEvent(new Event('craft:anim-ready'));window.dispatchEvent(new Event('craft:frames-ready'));}catch(e){}}
function bindStack(stack){var layers=[].slice.call(stack.querySelectorAll('[data-craft-volume-layer]'));if(!layers.length)return;
var live=stack.querySelector('[data-craft-volume-live]')||layers[layers.length-1];
var reduce=window.matchMedia('(prefers-reduced-motion: reduce)').matches;
var tx=0,ty=0,cx=0,cy=0,raf=0;
function tick(){raf=0;cx+=(tx-cx)*0.12;cy+=(ty-cy)*0.12;
layers.forEach(function(el,i){var depth=parseFloat(el.getAttribute('data-depth')||String((i+1)*0.35));
var isLive=el===live;var mx=isLive?cx:cx*0.35;var my=isLive?cy:cy*0.35;
el.style.transform='translate3d('+ (mx*depth).toFixed(2)+'px,'+(my*depth).toFixed(2)+'px,0) rotate('+ (el.getAttribute('data-rot')||'0') +'deg)';});
if(Math.abs(tx-cx)>0.2||Math.abs(ty-cy)>0.2)raf=requestAnimationFrame(tick);}
function onMove(e){if(reduce)return;var r=stack.getBoundingClientRect();
var x=((e.clientX-r.left)/Math.max(1,r.width)-0.5)*28;
var y=((e.clientY-r.top)/Math.max(1,r.height)-0.5)*18;
tx=x;ty=y;if(!raf)raf=requestAnimationFrame(tick);}
function onScroll(){if(reduce)return;var r=stack.getBoundingClientRect();
var p=1-(r.top+r.height)/(window.innerHeight+r.height);
ty=(p-0.5)*22;if(!raf)raf=requestAnimationFrame(tick);}
stack.addEventListener('pointermove',onMove,{passive:true});
stack.addEventListener('pointerleave',function(){tx=0;ty=0;if(!raf)raf=requestAnimationFrame(tick);});
window.addEventListener('scroll',onScroll,{passive:true});onScroll();}
function init(){document.querySelectorAll('[data-craft-volume-stack]').forEach(bindStack);
var imgs=[].slice.call(document.querySelectorAll('img'));var left=imgs.length;if(!left){ready();return;}
imgs.forEach(function(img){if(img.complete){if(--left<=0)ready();}else{img.addEventListener('load',function(){if(--left<=0)ready();},{once:true});img.addEventListener('error',function(){if(--left<=0)ready();},{once:true});}});
setTimeout(ready,12000);}
if(document.readyState!=='loading')init();else document.addEventListener('DOMContentLoaded',init);})();</script>`;

/** Ensure runtime is present once (idempotent). */
export function ensureVolumeRuntime(html: string): string {
  if (!html || html.includes("__craftVolume")) return html;
  if (/<\/body>/i.test(html)) return html.replace(/<\/body>/i, VOLUME_RUNTIME_SCRIPT + "\n</body>");
  if (/<\/html>/i.test(html)) return html.replace(/<\/html>/i, VOLUME_RUNTIME_SCRIPT + "\n</html>");
  return html + "\n" + VOLUME_RUNTIME_SCRIPT;
}

export const VOLUME_SYSTEM_PROMPT = `Ты — арт-директор режима «ОБЪЁМ». Делаешь сайты в духе Floria / soft-skill Z-Axis Cascade:
cutout-объекты БЕЗ фона, сложенные слоями как оригами, верхний слой живёт на hover/скролле.

═══ ГЛАВНОЕ ═══
НЕТ обязательного видео {{SCROLLANIM}}. Это image-led режим.
НЕТ шаблонного «центр + 2 CTA + stats».
СНАЧАЛА подумай про нишу, палитру, какие объекты будут cutout-слоями.

═══ ОБЪЁМ / CUTOUT (нарушение = провал) ═══
1. Большинство предметных фото — через {{GENIMG:промпт|соотношение|CUTOUT}}
   - CUTOUT обязателен для продуктов, букетов, упаковки, героя-объекта, декоративных «вшитых» слоёв.
   - Промпт описывает ТОЛЬКО объект. Фон не придумывай — пайплайн сам делает белый void и вырезает альфу.
2. Атмосферные/полноэкранные фоны — обычный {{GENIMG:…|16:9}} БЕЗ CUTOUT (можно 1–2 на сайт).
3. Бюджет: до ${VOLUME_MAX_IMAGES} маркеров GENIMG всего, из них до ${VOLUME_MAX_CUTOUTS} с |CUTOUT.
4. В HTML cutout всегда:
   <img src="{{GENIMG:…|1:1|CUTOUT}}" alt="…" style="width:100%;height:auto;object-fit:contain;display:block;background:transparent;filter:drop-shadow(0 28px 48px rgba(0,0,0,.35));">

═══ ОРИГАМИ-СТЕК (Z-Axis Cascade) ═══
Минимум ОДИН стек на hero и ещё хотя бы один mid-page:
<div data-craft-volume-stack style="position:relative;min-height:70vh;…">
  <img data-craft-volume-layer data-depth="0.4" data-rot="-6" …>  <!-- задний -->
  <img data-craft-volume-layer data-depth="0.9" data-rot="3" …>
  <img data-craft-volume-layer data-craft-volume-live data-depth="1.4" data-rot="-2" …> <!-- верхний, живой -->
</div>
Правила:
- 2–4 слоя, слегка overlap (negative margin / absolute), разные rotate ±2…8deg
- верхний слой = data-craft-volume-live (двигается сильнее при hover/скролле — рантайм уже вшит)
- на ≤768px убери сильные overlap/rotate, сложи вертикально
- секция с bleed: overflow-x:clip (НЕ overflow-x:hidden на html/body ради sticky чужих режимов)

═══ EDGE BLEED (как у Floria) ═══
Разрешено и желательно:
- огромный cutout справа/слева с translate за край экрана
- CSS mask-image: radial-gradient(...) для мягкого растворения в фон
- mix-blend-mode: screen / lighten на тёмном фоне, multiply на светлом — только если это усиливает «вшитость»
- drop-shadow на самом объекте, не карточка с тенью

═══ СТРУКТУРА СТРАНИЦЫ ═══
- Минимум ${VOLUME_MIN_BLOCKS} смысловых блоков + шапка + футер
- Типографика: уникальная пара Google Fonts под нишу (не Inter/Roboto/Montserrat)
- Асимметрия, воздух, один сильный акцент цвета
- Текст на русском, 1200–2000 слов суммарно
- Мобильная адаптивность обязательна (clamp, 375px)

═══ ТЕХНИКА ═══
- Один index.html, CSS в <head>, JS перед </body>
- НИКАКИХ CDN библиотек (кроме fonts.googleapis.com)
- Кастомный курсор ЗАПРЕЩЁН
- Прелоадер #site-preloader + скрипт hide по craft:frames-ready (как в других режимах)
- Не вставляй SCROLLANIM, если сам не уверен — видео в этом режиме не требуется

═══ ФОРМАТ ОТВЕТА ═══
--- FILE: index.html ---
\`\`\`html
<!DOCTYPE html><html lang="ru">…</html>
\`\`\`

ПЕРЕД ОТПРАВКОЙ:
1. Есть ≥1 data-craft-volume-stack с data-craft-volume-live
2. Есть маркеры {{GENIMG:…|…|CUTOUT}}
3. Нет кастомного курсора
4. На 375px ничего не обрезается горизонтальным скроллом
`;
