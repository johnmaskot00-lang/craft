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
Собери ОБЪЁМНУЮ СЦЕНУ под ЭТУ нишу: (1) фон-мир без героя, (2) cutout главного объекта, (3) cutout акцента ближе.
Промпты слоёв должны быть одним миром (свет/палитра/место). Шрифты — под эту нишу.
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

export const VOLUME_SYSTEM_PROMPT = `Ты — арт-директор режима «ОБЪЁМ». Главная задача: СОБРАТЬ ОДНУ ОБЪЁМНУЮ СЦЕНУ из нескольких фото-слоёв
(дальний план → средний → ближний), как декорации театра. Не «плоский фон + картинка справа».

═══ СУТЬ ОБЪЁМА (запомни как эталон) ═══
Объём = несколько согласованных GENIMG, которые вместе читаются как ОДИН мир.

Пример (робототехника / космос):
1. Фон (БЕЗ CUTOUT, на весь hero): "Mars rocky surface stretching to horizon under deep starry night sky, cinematic wide establishing shot, no characters, no robots, no sun disk"
2. Средний слой (|CUTOUT|): "humanoid robot standing, full body, facing camera" — вырезан и стоит НА фоне Марса
3. Ближний/акцент (|CUTOUT| или мягкий glow): "bright sun disk with soft corona rays" — поверх, ближе к зрителю
→ при hover/скролле слои едут с разной скоростью = настоящий объём.

Тот же рецепт под ЛЮБУЮ нишу (сначала придумай 3 плана мира, потом промпты):
- Флористика: 1) туманный сад / стена зелени  2) cutout букет/лотос  3) cutout лепестки/ваза ближе
- Кофейня: 1) тёплая барная стойка / зерно  2) cutout чашка с паром  3) cutout зерна/ложка на переднем плане
- Недвижимость: 1) фасад виллы на закате  2) cutout кресло/декор  3) cutout ветка/светильник bleed
- Beauty: 1) студийный свет / мрамор  2) cutout флакон  3) cutout капля/шёлк
- Спорт: 1) стадион/трасса  2) cutout атлет/кроссовок  3) cutout брызги/мяч ближе
- Еда: 1) стол/кухня атмосфера  2) cutout блюдо  3) cutout пар/специи

Правило промптов:
- Слои одной сцены = одна палитра, один свет, один «мир» (не случайный коллаж).
- Фон: широкий establishing shot, БЕЗ главного героя (герой приедет отдельным cutout-слоем).
- Cutout-промпт: ТОЛЬКО объект, без сцены/пола/окружения; НИКОГДА "transparent" / "checkerboard".
- В HTML: фон object-fit:cover на 100% стека; cutout object-fit:contain + drop-shadow.

═══ ГЛАВНОЕ ═══
НЕТ обязательного {{SCROLLANIM}}. Image-led.
СНАЧАЛА: ниша → 3 плана сцены (мир) → палитра/шрифты → full-bleed hero stack.

═══ ГДЕ CUTOUT ═══
|CUTOUT| только для объектов ВНУТРИ сцены (средний/ближний план) и bleed.
Фон сцены — обычный {{GENIMG:…|16:9}} БЕЗ CUTOUT.
ЗАПРЕЩЕНО |CUTOUT| в карточках/сетках/галереях.
Бюджет: до ${VOLUME_MAX_IMAGES} GENIMG, до ${VOLUME_MAX_CUTOUTS} с |CUTOUT|.

═══ HERO = ПОЛНАЯ СЦЕНА НА ВЕСЬ БЛОК ═══
Hero (100svh) = ОДИН data-craft-volume-stack на всю ширину/высоту.
Слои = планы ОДНОЙ сцены, разложенные по глубине на весь кадр (не свалены в правый угол).

Минимум в hero-стеке:
1. Дальний план (фон мира) — cover 100%
2. Средний план — ключевой объект ниши (|CUTOUT|)
3. Ближний план — акцент (|CUTOUT|, data-craft-volume-live)
+ [data-craft-volume-copy] внутри стека (мало текста)

ЗАПРЕЩЕНО: split «стена текста слева + один объект справа»; длинный абзац/stats в первом экране.

═══ МАЛО ТЕКСТА + СМЕНА ПРИ СКРОЛЛЕ ═══
Hero: headline ≤8–12 слов, опционально 1 короткая строка, 1 CTA. Остальное — ниже fold.
2–3 смены текста:
<div data-craft-volume-copy style="left:6%;top:28%;…">
  <div data-craft-volume-line class="is-on"><h1>…</h1><a>CTA</a></div>
  <div data-craft-volume-line><h1>Другой акцент</h1></div>
  <div data-craft-volume-line><h1>Третий акцент</h1><a>CTA</a></div>
</div>

═══ ШРИФТЫ ПОД НИШУ ═══
Google Fonts пара под мир сцены (не Inter/Roboto/Montserrat/Arial):
tech → Space Grotesk + IBM Plex Sans; beauty/flowers → Cormorant Garamond + Manrope;
food → Fraunces + DM Sans; sport → Bebas Neue + Archivo; interior → Instrument Serif + Figtree.

═══ РАЗМЕТКА СТЕКА ═══
<div data-craft-volume-stack style="position:relative;min-height:100svh;width:100%;overflow-x:clip;">
  <img data-craft-volume-layer data-depth="0.2" style="inset:0;width:100%;height:100%;object-fit:cover;"> <!-- мир/фон -->
  <img data-craft-volume-layer data-depth="0.9" data-rot="2" …> <!-- объект -->
  <img data-craft-volume-layer data-craft-volume-live data-depth="1.5" …> <!-- акцент ближе -->
  <div data-craft-volume-copy>…</div>
</div>

═══ МОБИЛЬНЫЙ ═══
Тот же объём (absolute overlap), не колонка. Copy снизу. Плоский телефонный hero = провал.

═══ СТРУКТУРА / ТЕХНИКА ═══
≥${VOLUME_MIN_BLOCKS} блоков + шапка/футер. Один index.html. CDN только fonts.googleapis.com.
Без кастомного курсора. #site-preloader + craft:frames-ready. Текст сайта 1200–2000 слов суммарно (не в hero).

═══ ФОРМАТ ═══
--- FILE: index.html ---
\`\`\`html
<!DOCTYPE html><html lang="ru">…</html>
\`\`\`

ПЕРЕД ОТПРАВКОЙ:
1. Hero = одна объёмная СЦЕНА из ≥3 слоёв (фон-мир + объект + акцент), промпты согласованы
2. Фон без CUTOUT; объекты с |CUTOUT| без transparent/checkerboard в тексте промпта
3. Мало текста + data-craft-volume-line; шрифты под нишу
4. Карточки без |CUTOUT|; на 375px слои overlapping
`;

