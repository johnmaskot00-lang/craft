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

/** Appended to cutout GENIMG prompts before KIE. Always reinforce anti-checkerboard. */
export function withVolumeCutoutBooster(prompt: string): string {
  const base = String(prompt || "")
    .trim()
    .replace(/\s+/g, " ")
    // Models often "fake" transparency with a drawn checkerboard — strip those asks.
    .replace(/\btransparent\s+background\b/gi, "solid white background")
    .replace(/\balpha\s+channel\b/gi, "")
    .replace(/\bcheckerboard\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  const lock =
    "isolated subject only on a flat pure solid white #FFFFFF studio void, " +
    "NO transparent background, NO checkerboard, NO gray-white grid, NO Photoshop " +
    "transparency pattern, NO mosaic, NO floor, NO backdrop, NO environment, " +
    "NO drop shadow on the background, subject fully separated, soft studio rim " +
    "light on the subject only, photorealistic, ultra high resolution";
  if (/pure solid white #FFFFFF studio void|NO checkerboard/i.test(base)) {
    return base;
  }
  return `${base}, ${lock}`;
}

/**
 * Remove white / light-gray / checkerboard studio voids via edge flood-fill.
 * Models sometimes paint a literal transparency grid — treat those cells as background.
 */
export async function punchWhiteBackgroundToPng(buf: Buffer): Promise<Buffer> {
  const sharp = (await import("sharp")).default;
  const { data, info } = await sharp(buf)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const w = info.width;
  const h = info.height;
  const n = w * h;
  const bg = new Uint8Array(n); // 1 = background

  const isBg = (r: number, g: number, b: number): boolean => {
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    if (max - min > 32) return false; // saturated → subject
    // White + light gray used by checkerboard / studio void
    return min >= 168;
  };

  const idx = (x: number, y: number) => y * w + x;
  const queue: number[] = [];
  const pushIf = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= w || y >= h) return;
    const p = idx(x, y);
    if (bg[p]) return;
    const o = p * 4;
    if (!isBg(data[o], data[o + 1], data[o + 2])) return;
    bg[p] = 1;
    queue.push(p);
  };

  for (let x = 0; x < w; x++) {
    pushIf(x, 0);
    pushIf(x, h - 1);
  }
  for (let y = 0; y < h; y++) {
    pushIf(0, y);
    pushIf(w - 1, y);
  }

  while (queue.length) {
    const p = queue.pop()!;
    const x = p % w;
    const y = (p / w) | 0;
    pushIf(x + 1, y);
    pushIf(x - 1, y);
    pushIf(x, y + 1);
    pushIf(x, y - 1);
  }

  // Soft edge: partially fade near background
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = idx(x, y);
      const o = p * 4;
      if (bg[p]) {
        data[o + 3] = 0;
        continue;
      }
      let near = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          if (bg[idx(nx, ny)]) near++;
        }
      }
      if (near >= 3) {
        data[o + 3] = Math.min(data[o + 3], Math.round(255 * (1 - near / 10)));
      } else if (isBg(data[o], data[o + 1], data[o + 2]) && near >= 1) {
        // Isolated light speck inside subject edge → punch
        data[o + 3] = 0;
      }
    }
  }

  return sharp(data, {
    raw: { width: w, height: h, channels: 4 },
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
Все cutout-объекты, палитра и пара шрифтов должны узнаваемо отражать ЭТУ нишу.
═══ КОНЕЦ НИШИ ═══\n`;
}

/** Baseline CSS so stacks keep depth even if agent media-queries flatten them. */
export const VOLUME_BASE_CSS = `<style id="craft-volume-css">
[data-craft-volume-stack]{position:relative;isolation:isolate;overflow-x:clip;overflow-y:visible}
[data-craft-volume-stack] [data-craft-volume-layer]{
  position:absolute!important;display:block!important;float:none!important;
  height:auto;object-fit:contain;background:transparent;pointer-events:none;will-change:transform;
}
[data-craft-volume-copy]{position:absolute;z-index:20;pointer-events:none;max-width:min(42vw,520px)}
[data-craft-volume-copy] a,[data-craft-volume-copy] button{pointer-events:auto}
[data-craft-volume-line]{opacity:0;transform:translate3d(0,14px,0);transition:opacity .45s ease,transform .45s ease;position:absolute;inset:0;pointer-events:none}
[data-craft-volume-line].is-on{opacity:1;transform:none;position:relative;pointer-events:auto}
@media (max-width:768px){
  [data-craft-volume-stack]{min-height:min(88svh,680px)!important;width:100%}
  [data-craft-volume-stack] [data-craft-volume-layer]{
    position:absolute!important;margin:0!important;float:none!important;
    max-width:min(78vw,340px);
  }
  [data-craft-volume-copy]{max-width:min(92vw,420px);left:4vw!important;right:4vw;top:auto;bottom:8%}
}
</style>`;

/** Vanilla runtime: parallax/hover + mobile heal + scroll copy lines. */
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
function bindCopy(stack){var copy=stack.querySelector('[data-craft-volume-copy]');if(!copy)return;
var lines=[].slice.call(copy.querySelectorAll('[data-craft-volume-line]'));if(lines.length<2){if(lines[0])lines[0].classList.add('is-on');return;}
var cur=-1;
function setLine(i){if(i===cur)return;cur=i;lines.forEach(function(el,j){if(j===i)el.classList.add('is-on');else el.classList.remove('is-on');});}
function onScroll(){var r=stack.getBoundingClientRect();var mid=window.innerHeight*0.5;
var p=(mid-r.top)/Math.max(1,r.height);p=Math.max(0,Math.min(0.999,p));
setLine(Math.min(lines.length-1,Math.floor(p*lines.length)));}
setLine(0);window.addEventListener('scroll',onScroll,{passive:true});onScroll();}
function bindStack(stack){healStack(stack);bindCopy(stack);var layers=[].slice.call(stack.querySelectorAll('[data-craft-volume-layer]'));if(!layers.length)return;
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
глубина через слои на ВЕСЬ hero; cutout — только для слоёв стека / bleed.

═══ ГЛАВНОЕ ═══
НЕТ обязательного видео {{SCROLLANIM}}. Это image-led режим.
СНАЧАЛА ниша → палитра → пара шрифтов → как устроить ПОЛНОЭКРАННЫЙ объёмный hero (не «текст слева / картинка справа»).

═══ ГДЕ CUTOUT, ГДЕ НЕТ ═══
|CUTOUT| = пайплайн вырезает фон. Только слои стека / bleed.

ЗАПРЕЩЕНО |CUTOUT|: карточки, сетки, галереи, тайлы, превью курсов/услуг, журнальные сцены.
В промпте cutout описывай ТОЛЬКО объект. НИКОГДА не пиши "transparent background" / "checkerboard" —
только объект; пайплайн сам даст белый void и альфу. Сетка прозрачности в кадре = брак.

Бюджет: до ${VOLUME_MAX_IMAGES} GENIMG, до ${VOLUME_MAX_CUTOUTS} с |CUTOUT|.
Cutout HTML: object-fit:contain; background:transparent; filter:drop-shadow(...).
Карточки: обычный GENIMG, object-fit:cover.

═══ HERO = ВЕСЬ БЛОК ОБЪЁМНЫЙ (не только правая колонка) ═══
Hero section (100svh) = ОДИН data-craft-volume-stack на всю ширину и высоту.
Слои распределены по ВСЕМУ кадру (лево/центр/право/края), не свалены в правый угол.

Типичная композиция (адаптируй под нишу):
1. Дальний фон-слой (часто БЕЗ CUTOUT) — атмосфера на 100% ширины
2–3. Средние cutout-слои — объекты ниши слева И справа, разный scale/depth
4. Передний data-craft-volume-live — главный объект ближе к зрителю
5. Текст — ВНУТРИ стека как [data-craft-volume-copy], не отдельная плоская колонка вне объёма

ЗАПРЕЩЕНО как дефолт:
- классический split «много текста слева + один робот/товар справа»
- длинный абзац + stats strip + 2 CTA в первом экране

═══ МАЛО ТЕКСТА В HERO + СМЕНА ПРИ СКРОЛЛЕ ═══
В первом экране максимум:
- 1 короткий headline (до ~8–12 слов)
- опционально 1 строка подзаголовка (до ~14 слов)
- 1 CTA

Длинные абзацы, stats, feature lists — НИЖЕ fold.
Чтобы текст «жил» со скроллом hero, внутри copy сделай 2–3 смены:

<div data-craft-volume-copy style="left:6%;top:28%;…">
  <div data-craft-volume-line class="is-on"><h1>…</h1><p>…</p><a>CTA</a></div>
  <div data-craft-volume-line><h1>Другой акцент</h1><p>Короткая строка</p></div>
  <div data-craft-volume-line"><h1>Третий акцент</h1><a>CTA</a></div>
</div>

Рантайм сам переключает .is-on по прогрессу скролла стека.

═══ ШРИФТЫ ПОД НИШУ (обязательно) ═══
Подключи Google Fonts пару, которая ЗВУЧИТ как ниша (не Inter/Roboto/Montserrat/Arial/system):
- robotics / AI / tech → Space Grotesk + IBM Plex Sans (или Syne + Geist-like via Outfit)
- luxury / beauty / floristry → Cormorant Garamond + Manrope
- food / cafe → Fraunces + DM Sans
- sport / energy → Bebas Neue + Archivo
- architecture / interior → Instrument Serif + Figtree
Заголовок = display font ниши; body = читаемый companion. Назови выбор в CSS variables.

═══ ОРИГАМИ-СТЕК ═══
<div data-craft-volume-stack style="position:relative;min-height:100svh;width:100%;…">
  <img data-craft-volume-layer data-depth="0.35" …>
  <img data-craft-volume-layer data-depth="0.8" data-rot="3" …>
  <img data-craft-volume-layer data-craft-volume-live data-depth="1.4" …>
  <div data-craft-volume-copy>…lines…</div>
</div>
- 3–5 слоёв в hero; absolute + overlap по всему кадру
- overflow-x:clip на секции

═══ МОБИЛЬНЫЙ ОБЪЁМ (≤768px) ═══
НЕ колонка/галерея. Тот же absolute overlap, плотнее кластер, copy снизу стека.
Плоский мобильный hero = провал.

═══ СТРУКТУРА ═══
Минимум ${VOLUME_MIN_BLOCKS} блоков + шапка + футер.
Асимметрия, воздух, один акцент цвета. Текст сайта 1200–2000 слов суммарно (не в hero).
Адаптив 375px.

═══ ТЕХНИКА ═══
Один index.html. CDN только fonts.googleapis.com. Без кастомного курсора.
#site-preloader + hide по craft:frames-ready. SCROLLANIM не обязателен.

═══ ФОРМАТ ═══
--- FILE: index.html ---
\`\`\`html
<!DOCTYPE html><html lang="ru">…</html>
\`\`\`

ПЕРЕД ОТПРАВКОЙ:
1. Hero = full-bleed volume stack (слои не только справа)
2. Мало текста в hero + data-craft-volume-line для смены при скролле
3. Шрифты подобраны под нишу
4. Карточки без |CUTOUT|; cutout-промпты без transparent/checkerboard
5. На 375px слои overlapping; нет гориз. скролла
`;
