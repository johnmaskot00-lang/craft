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

/** Baseline CSS: sticky rail + smooth layer motion (no layout jumps). */
export const VOLUME_BASE_CSS = `<style id="craft-volume-css">
/* Parent heroes often set height:100svh + overflow:hidden — unlock for the rail */
.hero:has([data-craft-volume-stack]),
.hero-volume-wrapper:has([data-craft-volume-stack]),
section:has([data-craft-volume-stack]),
main:has(>[data-craft-volume-stack]){
  height:auto!important;min-height:0!important;max-height:none!important;overflow:visible!important;
}
[data-craft-volume-rail]{position:relative;width:100%;height:240vh!important;display:block}
[data-craft-volume-stack]{
  position:sticky!important;top:0!important;left:0;width:100%!important;
  height:100svh!important;min-height:100svh!important;max-height:100svh!important;
  isolation:isolate;overflow:hidden!important;z-index:1;
}
[data-craft-volume-stack] [data-craft-volume-layer]{
  position:absolute!important;display:block!important;float:none!important;margin:0!important;
  background:transparent;pointer-events:none;will-change:transform;
  animation:none!important;
}
[data-craft-volume-copy]{position:absolute;z-index:20;pointer-events:none;max-width:min(42vw,520px)}
[data-craft-volume-copy] a,[data-craft-volume-copy] button{pointer-events:auto}
[data-craft-volume-line]{
  opacity:0;transform:translate3d(0,12px,0);
  transition:opacity .55s ease,transform .55s ease;
  position:absolute;inset:0;pointer-events:none;
}
[data-craft-volume-line].is-on{opacity:1;transform:none;position:relative;pointer-events:auto}
@media (max-width:768px){
  [data-craft-volume-rail]{height:200vh!important}
  [data-craft-volume-stack] [data-craft-volume-layer]{max-width:min(82vw,360px)}
  [data-craft-volume-copy]{max-width:min(92vw,420px);left:4vw!important;right:4vw;top:auto!important;bottom:8%}
}
@media (prefers-reduced-motion:reduce){
  [data-craft-volume-rail]{height:100vh!important}
  [data-craft-volume-line]{transition:none}
}
</style>`;

/**
 * Smooth sticky parallax runtime (v2).
 * Tall rail + sticky stage → scroll progress drives depth without layout jumps.
 */
export const VOLUME_RUNTIME_SCRIPT = `<script data-craft-volume-runtime="2">(function(){if(window.__craftVolume>=2)return;window.__craftVolume=2;
function ready(){try{window.__craftAnimReady=true;window.dispatchEvent(new Event('craft:anim-ready'));window.dispatchEvent(new Event('craft:frames-ready'));}catch(e){}}
function isMobile(){return window.matchMedia('(max-width:768px)').matches;}
function reduceMotion(){return window.matchMedia('(prefers-reduced-motion: reduce)').matches;}
function ensureRail(stack){
  if(stack.parentElement&&stack.parentElement.getAttribute('data-craft-volume-rail')==='1')return stack.parentElement;
  var rail=document.createElement('div');
  rail.setAttribute('data-craft-volume-rail','1');
  stack.parentNode.insertBefore(rail,stack);
  rail.appendChild(stack);
  return rail;
}
function railProgress(rail){
  var r=rail.getBoundingClientRect();
  var travel=Math.max(1,r.height-window.innerHeight);
  return Math.max(0,Math.min(1,(-r.top)/travel));
}
function bindStack(stack){
  var rail=ensureRail(stack);
  var layers=[].slice.call(stack.querySelectorAll('[data-craft-volume-layer]'));
  if(!layers.length)return;
  var live=stack.querySelector('[data-craft-volume-live]')||layers[layers.length-1];
  var copy=stack.querySelector('[data-craft-volume-copy]');
  var lines=copy?[].slice.call(copy.querySelectorAll('[data-craft-volume-line]')):[];
  var reduce=reduceMotion();
  var px=0,py=0,cx=0,cy=0,sp=0,csp=0,raf=0,line=-1;
  layers.forEach(function(el){
    el.style.setProperty('position','absolute','important');
    el.style.setProperty('animation','none','important');
    // Full-bleed backgrounds keep cover; don't force contain
    var depth=parseFloat(el.getAttribute('data-depth')||'0.5');
    var isBg=depth<=0.35||/cover/i.test(el.style.objectFit||'')||el.className.indexOf('backdrop')>=0||el.className.indexOf('bg-layer')>=0||el.className.indexOf('layer-backdrop')>=0;
    if(isBg){el.setAttribute('data-vol-bg','1');el.style.objectFit=el.style.objectFit||'cover';}
  });
  function setLine(i){
    if(!lines.length)return;
    i=Math.max(0,Math.min(lines.length-1,i));
    if(i===line)return;line=i;
    lines.forEach(function(el,j){if(j===i)el.classList.add('is-on');else el.classList.remove('is-on');});
  }
  if(lines.length)setLine(0);
  function tick(){
    raf=0;
    csp+=(sp-csp)*0.08;
    cx+=(px-cx)*0.1;cy+=(py-cy)*0.1;
    layers.forEach(function(el,i){
      var depth=parseFloat(el.getAttribute('data-depth')||String((i+1)*0.4));
      var isBg=el.getAttribute('data-vol-bg')==='1';
      var isLive=el===live;
      var scrollAmp=isBg?18:(isLive?90:48);
      var pointerAmp=isBg?4:(isLive?22:12);
      if(isMobile()){scrollAmp*=0.85;pointerAmp*=0.55;}
      if(reduce){scrollAmp=0;pointerAmp=0;}
      var y=(csp-0.5)*scrollAmp*Math.max(0.15,depth);
      var x=(csp-0.5)*scrollAmp*0.22*depth+cx*pointerAmp*0.05*depth;
      var my=cy*pointerAmp*0.05*depth;
      var rot=parseFloat(el.getAttribute('data-rot')||'0')||0;
      if(isLive&&!reduce)rot+=Math.sin(csp*Math.PI)*1.2;
      var sc=isBg?(1.04+csp*0.03):(isLive?(1+csp*0.04):1);
      el.style.transform='translate3d('+x.toFixed(2)+'px,'+(y+my).toFixed(2)+'px,0) rotate('+rot.toFixed(2)+'deg) scale('+sc.toFixed(3)+')';
    });
    if(lines.length>1){
      var idx=Math.min(lines.length-1,Math.floor(csp*lines.length+0.0001));
      // Hysteresis-ish: only advance when clearly in band
      setLine(idx);
    }
    if(Math.abs(sp-csp)>0.001||Math.abs(px-cx)>0.15||Math.abs(py-cy)>0.15)raf=requestAnimationFrame(tick);
  }
  function kick(){if(!raf)raf=requestAnimationFrame(tick);}
  function onScroll(){sp=railProgress(rail);kick();}
  function onMove(e){
    if(reduce)return;
    var r=stack.getBoundingClientRect();
    px=((e.clientX-r.left)/Math.max(1,r.width)-0.5)*2;
    py=((e.clientY-r.top)/Math.max(1,r.height)-0.5)*2;
    kick();
  }
  stack.addEventListener('pointermove',onMove,{passive:true});
  stack.addEventListener('pointerleave',function(){px=0;py=0;kick();});
  window.addEventListener('scroll',onScroll,{passive:true});
  window.addEventListener('resize',onScroll,{passive:true});
  onScroll();kick();
}
function init(){
  document.querySelectorAll('[data-craft-volume-stack]').forEach(bindStack);
  var imgs=[].slice.call(document.querySelectorAll('img'));var left=imgs.length;
  if(!left){ready();return;}
  imgs.forEach(function(img){
    if(img.complete){if(--left<=0)ready();}
    else{img.addEventListener('load',function(){if(--left<=0)ready();},{once:true});
      img.addEventListener('error',function(){if(--left<=0)ready();},{once:true});}
  });
  setTimeout(ready,12000);
}
if(document.readyState!=='loading')init();else document.addEventListener('DOMContentLoaded',init);
})();</script>`;

/** Ensure CSS + runtime v2 are present (upgrades older volume runtimes). */
export function ensureVolumeRuntime(html: string): string {
  if (!html) return html;
  let out = html;
  // Always refresh baseline CSS
  out = out.replace(/<style[^>]*id=["']craft-volume-css["'][^>]*>[\s\S]*?<\/style>/gi, "");
  if (/<\/head>/i.test(out)) out = out.replace(/<\/head>/i, VOLUME_BASE_CSS + "\n</head>");
  else if (/<body[^>]*>/i.test(out)) out = out.replace(/<body[^>]*>/i, (m) => `${m}\n${VOLUME_BASE_CSS}`);
  else out = VOLUME_BASE_CSS + "\n" + out;

  // Strip any prior volume runtime, then inject v2
  out = out.replace(/<script[^>]*data-craft-volume-runtime[^>]*>[\s\S]*?<\/script>/gi, "");
  out = out.replace(/<script>\(function\(\)\{if\(window\.__craftVolume\)[\s\S]*?<\/script>/gi, "");
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
Hero = ОДИН data-craft-volume-stack на всю ширину (высота ~100svh).
Рантайм сам сделает sticky-рельс (длинный скролл → плавный объём) — НЕ добавляй свои
@keyframes на transform слоёв и НЕ пиши JS parallax (конфликт = прыжки).

Слои = планы ОДНОЙ сцены на весь кадр. Минимум 4 слоя для «вау»:
1. Фон-мир (БЕЗ CUTOUT, data-depth="0.15–0.25") — cover 100%, inset 0, БЕЗ героя
2. Дальний/средний антураж (|CUTOUT| или второй wide, depth 0.5–0.7) — скала/дымка/мебель
3. Главный объект ниши (|CUTOUT|, depth 0.9–1.2) — крупный, bottom / object-position:bottom, 45–65% ширины
4. Ближний bleed-акцент (|CUTOUT| + data-craft-volume-live, depth 1.4–1.8) — у края/низа, перекрывает героя частично
+ [data-craft-volume-copy] внутри стека

Масштаб слоёв должен СИЛЬНО отличаться (фон огромный, акцент меньше и ближе).
Один свет/час суток во ВСЕХ промптах (например всё «Martian sunset warm rim light»).

ЗАПРЕЩЕНО:
- split «стена текста слева + один объект справа»
- длинный абзац/stats в первом экране
- CSS animation/keyframes на transform у [data-craft-volume-layer]
- «летающий» акцент у потолка (top < 35%)
- height:90%+ cutout без object-position:bottom
- собственные scroll-listeners на hero

═══ ТИПОГРАФИКА HERO (не вытягивать) ═══
- font-weight: 400–600; line-height: 1.12–1.22; letter-spacing: −0.02em…0.02em
- font-size: clamp(2rem, 4.2vw, 3.6rem); без scaleY / vertical writing-mode
- italic только на 1–3 словах; volume-line-container min-height ≈160–180px

═══ МАЛО ТЕКСТА + СМЕНА ПРИ СКРОЛЛЕ ═══
Hero: ≤8–12 слов headline, опционально 1 строка, 1 CTA. Ниже fold — остальное.
2–3 смены через data-craft-volume-line (рантайм переключит плавно по sticky-скроллу).

═══ ШРИФТЫ ПОД НИШУ ═══
Google Fonts пара под мир сцены (не Inter/Roboto/Montserrat/Arial):
tech → Space Grotesk + IBM Plex Sans; beauty/flowers → Cormorant Garamond + Manrope;
food → Fraunces + DM Sans; sport → Bebas Neue + Archivo; interior → Instrument Serif + Figtree.

═══ РАЗМЕТКА СТЕКА ═══
<div data-craft-volume-stack>
  <img data-craft-volume-layer data-depth="0.2" style="inset:0;width:100%;height:100%;object-fit:cover;">
  <img data-craft-volume-layer data-depth="0.65" …>
  <img data-craft-volume-layer data-depth="1.05" style="bottom:0;right:4%;width:55%;object-fit:contain;object-position:bottom;">
  <img data-craft-volume-layer data-craft-volume-live data-depth="1.55" style="bottom:-4%;left:-2%;width:32%;object-fit:contain;">
  <div data-craft-volume-copy>…lines…</div>
</div>
Не оборачивай стек в tall rail вручную — это делает рантайм.

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
1. ≥4 слоя одной сцены, разный scale/depth, один свет в промптах
2. Нет CSS keyframes на transform слоёв (рантайм сам двигает)
3. Акценты у низа/края; object-position:bottom у главного cutout
4. Заголовок плотный (weight 400–600, clamp ≤3.6rem)
5. Карточки без |CUTOUT|; cutout-промпты без transparent/checkerboard
6. На 375px слои overlapping
`;

