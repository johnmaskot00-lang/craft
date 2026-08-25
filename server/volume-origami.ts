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

/** Baseline CSS so stacks keep depth even if agent media-queries flatten them. */
export const VOLUME_BASE_CSS = `<style id="craft-volume-css">
[data-craft-volume-stack]{position:relative;isolation:isolate;overflow-x:clip;overflow-y:visible}
[data-craft-volume-stack] [data-craft-volume-layer]{
  position:absolute!important;display:block!important;float:none!important;
  height:auto;object-fit:contain;background:transparent;pointer-events:none;will-change:transform;
}
@media (max-width:768px){
  [data-craft-volume-stack]{min-height:min(88svh,680px)!important;width:100%}
  /* NEVER flatten origami into a vertical document flow on phones */
  [data-craft-volume-stack] [data-craft-volume-layer]{
    position:absolute!important;margin:0!important;float:none!important;
    max-width:min(78vw,340px);
  }
}
</style>`;

/** Vanilla runtime: parallax/hover on live origami layers + mobile overlap heal. */
export const VOLUME_RUNTIME_SCRIPT = `<script>(function(){if(window.__craftVolume)return;window.__craftVolume=1;
function ready(){try{window.__craftAnimReady=true;window.dispatchEvent(new Event('craft:anim-ready'));window.dispatchEvent(new Event('craft:frames-ready'));}catch(e){}}
function isMobile(){return window.matchMedia('(max-width:768px)').matches;}
function healStack(stack){var layers=[].slice.call(stack.querySelectorAll('[data-craft-volume-layer]'));if(layers.length<2)return;
layers.forEach(function(el){el.style.setProperty('position','absolute','important');el.style.setProperty('display','block','important');el.style.setProperty('float','none','important');el.style.setProperty('margin','0','important');});
if(!isMobile())return;
var rects=layers.map(function(el){return el.getBoundingClientRect();});
var tops=rects.map(function(r){return r.top;});
var span=Math.max.apply(null,tops)-Math.min.apply(null,tops);
var avgH=rects.reduce(function(s,r){return s+r.height;},0)/Math.max(1,rects.length);
/* Flattened = layers sit far apart vertically like a gallery */
if(span>Math.max(avgH*0.85,window.innerHeight*0.32)){
  if(!stack.style.minHeight||parseFloat(stack.style.minHeight)<200)stack.style.minHeight=Math.min(window.innerHeight*0.88,680)+'px';
  layers.forEach(function(el,i){var n=layers.length;var pct=n<=1?0:i/(n-1);
  el.style.left=(6+pct*28).toFixed(1)+'%';
  el.style.top=(10+pct*26).toFixed(1)+'%';
  el.style.right='auto';el.style.bottom='auto';
  el.style.width=(72-pct*14).toFixed(1)+'%';
  el.style.maxWidth='320px';el.style.zIndex=String(i+1);
  if(!el.getAttribute('data-rot'))el.setAttribute('data-rot',String(((i%2)?1:-1)*(2+i*1.5)));
  if(!el.getAttribute('data-depth'))el.setAttribute('data-depth',String((0.4+pct*1.1).toFixed(2)));});
}}
function bindStack(stack){healStack(stack);var layers=[].slice.call(stack.querySelectorAll('[data-craft-volume-layer]'));if(!layers.length)return;
var live=stack.querySelector('[data-craft-volume-live]')||layers[layers.length-1];
var reduce=window.matchMedia('(prefers-reduced-motion: reduce)').matches;
var tx=0,ty=0,cx=0,cy=0,raf=0;
function tick(){raf=0;cx+=(tx-cx)*0.12;cy+=(ty-cy)*0.12;
layers.forEach(function(el,i){var depth=parseFloat(el.getAttribute('data-depth')||String((i+1)*0.35));
var isLive=el===live;var mx=isLive?cx:cx*0.35;var my=isLive?cy:cy*0.35;
var rot=el.getAttribute('data-rot')||'0';
el.style.transform='translate3d('+ (mx*depth).toFixed(2)+'px,'+(my*depth).toFixed(2)+'px,0) rotate('+rot+'deg)';});
if(Math.abs(tx-cx)>0.2||Math.abs(ty-cy)>0.2)raf=requestAnimationFrame(tick);}
function onMove(e){if(reduce)return;var r=stack.getBoundingClientRect();
var x=((e.clientX-r.left)/Math.max(1,r.width)-0.5)*(isMobile()?18:28);
var y=((e.clientY-r.top)/Math.max(1,r.height)-0.5)*(isMobile()?12:18);
tx=x;ty=y;if(!raf)raf=requestAnimationFrame(tick);}
function onScroll(){if(reduce)return;var r=stack.getBoundingClientRect();
var p=1-(r.top+r.height)/(window.innerHeight+r.height);
/* Stronger scroll parallax on phones (no hover) */
ty=(p-0.5)*(isMobile()?36:22);tx=isMobile()?(p-0.5)*10:tx;if(!raf)raf=requestAnimationFrame(tick);}
stack.addEventListener('pointermove',onMove,{passive:true});
stack.addEventListener('pointerleave',function(){if(isMobile())return;tx=0;ty=0;if(!raf)raf=requestAnimationFrame(tick);});
window.addEventListener('scroll',onScroll,{passive:true});
window.addEventListener('resize',function(){healStack(stack);onScroll();},{passive:true});
onScroll();}
function init(){document.querySelectorAll('[data-craft-volume-stack]').forEach(bindStack);
var imgs=[].slice.call(document.querySelectorAll('img'));var left=imgs.length;if(!left){ready();return;}
imgs.forEach(function(img){if(img.complete){if(--left<=0)ready();}else{img.addEventListener('load',function(){if(--left<=0)ready();},{once:true});img.addEventListener('error',function(){if(--left<=0)ready();},{once:true});}});
setTimeout(ready,12000);}
if(document.readyState!=='loading')init();else document.addEventListener('DOMContentLoaded',init);})();</script>`;

/** Ensure CSS + runtime are present once (idempotent). */
export function ensureVolumeRuntime(html: string): string {
  if (!html) return html;
  let out = html;
  if (!out.includes("craft-volume-css") && !out.includes('id="craft-volume-css"')) {
    if (/<\/head>/i.test(out)) out = out.replace(/<\/head>/i, VOLUME_BASE_CSS + "\n</head>");
    else if (/<body[^>]*>/i.test(out)) out = out.replace(/<body[^>]*>/i, (m) => `${m}\n${VOLUME_BASE_CSS}`);
    else out = VOLUME_BASE_CSS + "\n" + out;
  }
  if (out.includes("__craftVolume")) return out;
  if (/<\/body>/i.test(out)) return out.replace(/<\/body>/i, VOLUME_RUNTIME_SCRIPT + "\n</body>");
  if (/<\/html>/i.test(out)) return out.replace(/<\/html>/i, VOLUME_RUNTIME_SCRIPT + "\n</html>");
  return out + "\n" + VOLUME_RUNTIME_SCRIPT;
}

export const VOLUME_SYSTEM_PROMPT = `Ты — арт-директор режима «ОБЪЁМ». Делаешь сайты в духе Floria / soft-skill Z-Axis Cascade:
глубина через слои; cutout (без фона) — ТОЛЬКО там, где объект «вшит» в композицию и двигается.

═══ ГЛАВНОЕ ═══
НЕТ обязательного видео {{SCROLLANIM}}. Это image-led режим.
НЕТ шаблонного «центр + 2 CTA + stats».
СНАЧАЛА подумай про нишу клиента: какой hero даст максимум объёма (полный многослойный кадр vs один акцент), какая палитра, где cutout уместен, а где нужна обычная фотография со сценой.

═══ ГДЕ CUTOUT, ГДЕ НЕТ (критично) ═══
|CUTOUT| = пайплайн вырезает фон. Используй ТОЛЬКО для слоёв объёмного стека / edge-bleed объектов.

ЗАПРЕЩЕНО |CUTOUT| (всегда обычный {{GENIMG:…|ratio}} БЕЗ CUTOUT):
- карточки услуг / мастер-классов / курсов / кейсов / блога / каталога
- превью в сетках, галереях, тайлах, прайс-листах
- любые img внутри card / article / list-item, где нужна цельная сцена (студия, интерьер, руки с цветком, стол)
- портреты и «журнальные» кадры с атмосферой

РАЗРЕШЕНО |CUTOUT|:
- слои внутри data-craft-volume-stack (hero и mid-page объём)
- крупные bleed-объекты, торчащие за край экрана вне карточек
- промпт cutout описывает ТОЛЬКО объект (без фона/сцены) — фон вырежет пайплайн

Бюджет: до ${VOLUME_MAX_IMAGES} GENIMG всего, из них до ${VOLUME_MAX_CUTOUTS} с |CUTOUT.
В HTML cutout-слой:
<img … style="…;object-fit:contain;background:transparent;filter:drop-shadow(0 28px 48px rgba(0,0,0,.35));">
В карточках — обычные фото: object-fit:cover, прямоугольник, фон сцены сохраняется.

═══ HERO: ПОЛНЫЙ ОБЪЁМ (сам реши под нишу) ═══
Hero — главная сцена объёма. НЕ ограничивайся одним «парящим» предметом.
Предпочтительный вариант: целиком объёмный hero из 3–5 слоёв на весь экран:
- задний слой: атмосфера / архитектура / мягкий градиент / широкий кадр (часто БЕЗ CUTOUT)
- средние: крупные cutout-объекты ниши (цветы, продукт, материалы, силуэты)
- передний live-слой: самый выразительный cutout ближе к зрителю (data-craft-volume-live)
Текст/CTA встраивай в композицию (слева в воздухе, поверх scrim), не ломай стек.

Альтернативы (выбери осознанно под нишу):
A) Full-bleed multi-layer stack на 100svh (по умолчанию для fashion / beauty / floristry / food / product)
B) Асимметрия: типографика слева + глубокий стек справа
C) Реже: один сильный cutout-акцент — только если ниша минималистичная и один объект = бренд

Минимум: один data-craft-volume-stack в hero (желательно на весь hero) + ещё хотя бы один mid-page стек ИЛИ сильный bleed.

═══ ОРИГАМИ-СТЕК (Z-Axis Cascade) ═══
<div data-craft-volume-stack style="position:relative;min-height:70vh; /* hero: 100svh */ …">
  <img data-craft-volume-layer data-depth="0.35" …>   <!-- дальний -->
  <img data-craft-volume-layer data-depth="0.8" data-rot="3" …>
  <img data-craft-volume-layer data-craft-volume-live data-depth="1.4" data-rot="-2" …>
</div>
Правила:
- 3–5 слоёв в hero предпочтительнее, чем 2; mid-page — 2–4
- ВСЕ слои position:absolute внутри relative-стека, overlap обязателен (разные left/top %, width 45–85%)
- лёгкий rotate ±2…8deg; верхний = data-craft-volume-live
- overflow-x:clip на секции (НЕ overflow-x:hidden на html/body)

═══ МОБИЛЬНЫЙ ОБЪЁМ (≤768px) — критично ═══
ЗАПРЕЩЕНО на телефоне:
- складывать слои в колонку (flex-direction:column / position:relative / static / друг под другом)
- position:relative + margin auto на [data-craft-volume-layer]
- превращать стек в «галерею» из отдельных картинок

ОБЯЗАТЕЛЬНО на телефоне:
- тот же origami-стек: position:absolute + overlap + разные left/top
- стек min-height: min(88svh, 680px); слои max-width: 70–78vw
- чуть плотнее кластер (сильнее overlap), rotate ±1…5deg
- parallax от скролла важнее hover (рантайм усилит сам)
- текст/CTA не перекрывай центром стека — сверху или снизу стека, z-index выше

Плохой мобильный hero = провал режима «Объём».

═══ EDGE BLEED ═══
Разрешено вне карточек: cutout за край экрана, mask-image radial-gradient, blend screen/multiply если усиливает объём, drop-shadow на объекте.

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
- Прелоадер #site-preloader + скрипт hide по craft:frames-ready
- SCROLLANIM не обязателен

═══ ФОРМАТ ОТВЕТА ═══
--- FILE: index.html ---
\`\`\`html
<!DOCTYPE html><html lang="ru">…</html>
\`\`\`

ПЕРЕД ОТПРАВКОЙ:
1. Hero содержит объёмный data-craft-volume-stack (желательно multi-layer на весь hero)
2. На 375px слои СТЁКА overlapping (не колонкой) — проверь mental preview
3. Карточки/сетки — фото БЕЗ |CUTOUT|
4. |CUTOUT| только у слоёв стека / bleed
5. Нет кастомного курсора; нет горизонтального скролла
`;
