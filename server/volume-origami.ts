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
Собери ОДНУ сцену-сэндвич под ЭТУ нишу:
1) единый фон-мир (без героя),
2) cutout-ПОДЛОЖКА (ваза/стол/пьедестал/упаковка — то, НА чём стоит герой),
3) cutout-ГЕРОЙ, визуально ВЫХОДЯЩИЙ из подложки (тот же свет, тот же ракурс).
Слои 2+3 якорятся в одном месте (центр-низ), не разбрасывай по углам hero.
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
/* Role defaults: one scene sandwich — bg full bleed, base+subject stacked center-bottom */
[data-craft-volume-role="bg"]{
  inset:0!important;width:100%!important;height:100%!important;
  object-fit:cover!important;z-index:1;
}
[data-craft-volume-role="base"]{
  left:50%!important;bottom:6%!important;right:auto!important;top:auto!important;
  width:min(46vw,420px)!important;max-width:88vw!important;height:auto!important;
  object-fit:contain!important;object-position:bottom center!important;
  transform-origin:50% 100%;z-index:3;
  filter:drop-shadow(0 18px 28px rgba(0,0,0,.28));
}
[data-craft-volume-role="subject"]{
  left:50%!important;bottom:18%!important;right:auto!important;top:auto!important;
  width:min(38vw,340px)!important;max-width:72vw!important;height:auto!important;
  object-fit:contain!important;object-position:bottom center!important;
  transform-origin:50% 100%;z-index:4;
  filter:drop-shadow(0 14px 22px rgba(0,0,0,.22));
}
[data-craft-volume-role="accent"]{
  z-index:5;object-fit:contain!important;
  filter:drop-shadow(0 10px 16px rgba(0,0,0,.18));
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
  [data-craft-volume-role="base"]{width:min(70vw,320px)!important;bottom:10%!important}
  [data-craft-volume-role="subject"]{width:min(58vw,260px)!important;bottom:22%!important}
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
export const VOLUME_RUNTIME_SCRIPT = `<script data-craft-volume-runtime="3">(function(){if(window.__craftVolume>=3)return;window.__craftVolume=3;
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
  var live=stack.querySelector('[data-craft-volume-live]')||stack.querySelector('[data-craft-volume-role="subject"]')||layers[layers.length-1];
  var copy=stack.querySelector('[data-craft-volume-copy]');
  var lines=copy?[].slice.call(copy.querySelectorAll('[data-craft-volume-line]')):[];
  var reduce=reduceMotion();
  var px=0,py=0,cx=0,cy=0,sp=0,csp=0,raf=0,line=-1;
  layers.forEach(function(el){
    el.style.setProperty('position','absolute','important');
    el.style.setProperty('animation','none','important');
    var role=(el.getAttribute('data-craft-volume-role')||'').toLowerCase();
    var depth=parseFloat(el.getAttribute('data-depth')||'0.5');
    var isBg=role==='bg'||depth<=0.35||/cover/i.test(el.style.objectFit||'')||el.className.indexOf('backdrop')>=0||el.className.indexOf('bg-layer')>=0||el.className.indexOf('layer-backdrop')>=0;
    if(isBg){el.setAttribute('data-vol-bg','1');el.style.objectFit=el.style.objectFit||'cover';}
    if(role==='base'||role==='subject'){
      // Keep sandwich centered; runtime transform will include translateX(-50%).
      if(!el.style.left||el.style.left==='auto')el.style.left='50%';
      if(!el.style.bottom||el.style.bottom==='auto')el.style.bottom=role==='base'?'6%':'18%';
    }
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
    // Shared offset for base+subject so pot+flower stay locked as one prop.
    var pairScroll=(csp-0.5)*42;
    var pairX=cx*8;
    var pairY=cy*6;
    if(isMobile()){pairScroll*=0.85;pairX*=0.55;pairY*=0.55;}
    if(reduce){pairScroll=0;pairX=0;pairY=0;}
    layers.forEach(function(el,i){
      var role=(el.getAttribute('data-craft-volume-role')||'').toLowerCase();
      var depth=parseFloat(el.getAttribute('data-depth')||String((i+1)*0.4));
      var isBg=el.getAttribute('data-vol-bg')==='1'||role==='bg';
      var isBase=role==='base';
      var isSubject=role==='subject'||el===live;
      var isAccent=role==='accent';
      var x,y,sc,rot;
      var center=(isBase||isSubject)?'translateX(-50%) ':'';
      if(isBg){
        var scrollAmp=14,pointerAmp=3;
        if(isMobile()){scrollAmp*=0.85;pointerAmp*=0.55;}
        if(reduce){scrollAmp=0;pointerAmp=0;}
        y=(csp-0.5)*scrollAmp;
        x=(csp-0.5)*scrollAmp*0.15+cx*pointerAmp*0.04;
        var my=cy*pointerAmp*0.04;
        rot=0;sc=1.04+csp*0.03;
        el.style.transform='translate3d('+x.toFixed(2)+'px,'+(y+my).toFixed(2)+'px,0) scale('+sc.toFixed(3)+')';
        return;
      }
      if(isBase||isSubject){
        // Same motion family — subject only slightly closer (tiny extra).
        var bump=isSubject?1.12:1;
        x=pairX*bump;
        y=pairScroll*bump+pairY*bump;
        // Subject sits a bit higher via CSS bottom; keep rotation tiny and shared.
        rot=(parseFloat(el.getAttribute('data-rot')||'0')||0);
        if(isSubject&&!reduce)rot+=Math.sin(csp*Math.PI)*0.6;
        sc=1+csp*(isSubject?0.035:0.02);
        el.style.transform=center+'translate3d('+x.toFixed(2)+'px,'+y.toFixed(2)+'px,0) rotate('+rot.toFixed(2)+'deg) scale('+sc.toFixed(3)+')';
        return;
      }
      // Accent / legacy layers — still depth-based but milder than before
      var scrollAmp=isAccent?70:48;
      var pointerAmp=isAccent?16:10;
      if(isMobile()){scrollAmp*=0.85;pointerAmp*=0.55;}
      if(reduce){scrollAmp=0;pointerAmp=0;}
      y=(csp-0.5)*scrollAmp*Math.max(0.15,depth);
      x=(csp-0.5)*scrollAmp*0.18*depth+cx*pointerAmp*0.05*depth;
      var my2=cy*pointerAmp*0.05*depth;
      rot=parseFloat(el.getAttribute('data-rot')||'0')||0;
      sc=1+csp*0.03;
      el.style.transform=center+'translate3d('+x.toFixed(2)+'px,'+(y+my2).toFixed(2)+'px,0) rotate('+rot.toFixed(2)+'deg) scale('+sc.toFixed(3)+')';
    });
    if(lines.length>1){
      var idx=Math.min(lines.length-1,Math.floor(csp*lines.length+0.0001));
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

/** Ensure CSS + runtime v3 are present (upgrades older volume runtimes). */
export function ensureVolumeRuntime(html: string): string {
  if (!html) return html;
  let out = html;
  // Always refresh baseline CSS
  out = out.replace(/<style[^>]*id=["']craft-volume-css["'][^>]*>[\s\S]*?<\/style>/gi, "");
  if (/<\/head>/i.test(out)) out = out.replace(/<\/head>/i, VOLUME_BASE_CSS + "\n</head>");
  else if (/<body[^>]*>/i.test(out)) out = out.replace(/<body[^>]*>/i, (m) => `${m}\n${VOLUME_BASE_CSS}`);
  else out = VOLUME_BASE_CSS + "\n" + out;

  // Strip any prior volume runtime, then inject v3
  out = out.replace(/<script[^>]*data-craft-volume-runtime[^>]*>[\s\S]*?<\/script>/gi, "");
  out = out.replace(/<script>\(function\(\)\{if\(window\.__craftVolume\)[\s\S]*?<\/script>/gi, "");
  if (/<\/body>/i.test(out)) return out.replace(/<\/body>/i, VOLUME_RUNTIME_SCRIPT + "\n</body>");
  if (/<\/html>/i.test(out)) return out.replace(/<\/html>/i, VOLUME_RUNTIME_SCRIPT + "\n</html>");
  return out + "\n" + VOLUME_RUNTIME_SCRIPT;
}

export const VOLUME_SYSTEM_PROMPT = `Ты — арт-директор режима «ОБЪЁМ». Hero — это ОДНА собранная сцена-сэндвич:
единый фон → подложка → объект, СТОЯЩИЙ НА подложке. Не разбрасывай картинки по углам.

═══ РЕЦЕПТ СЦЕНЫ (обязателен) ═══
Ровно 3 главных слоя (+ опционально 1 мелкий акцент). Они читаются как ОДИН предмет в мире.

1) ФОН (data-craft-volume-role="bg", БЕЗ |CUTOUT|, data-depth="0.2")
   — единый establishing shot на весь hero (поле, интерьер, студия, пейзаж).
   — БЕЗ главного героя и БЕЗ подложки (горшок/ваза/стол не рисуй на фоне).

2) ПОДЛОЖКА (data-craft-volume-role="base", |CUTOUT|, data-depth="0.85")
   — то, НА ЧЁМ стоит герой: горшок, ваза, пьедестал, стол, коробка, упаковка, платформа.
   — ТОЛЬКО этот объект на белом (cutout). Якорь: центр-низ hero.

3) ГЕРОЙ НА ПОДЛОЖКЕ (data-craft-volume-role="subject", |CUTOUT|, data-craft-volume-live, data-depth="1.2")
   — объект, который визуально ВЫХОДИТ ИЗ / СТОИТ В подложке
     (цветок из горшка, пар из чашки, бутылка на столе, лампа на тумбе, кроссовок на подиуме).
   — ТОТ ЖЕ свет/ракурс, что у подложки. Якорь: тот же центр-низ, чуть выше base (перекрытие).

4) Опционально АКЦЕНТ (data-craft-volume-role="accent", |CUTOUT|, data-depth="1.55")
   — один мелкий bleed у края (лепесток, капля, лист). НЕ второй «летающий» герой.

Эталон (флористика):
1. фон: "endless flower meadow at soft golden hour, wide establishing, no pots, no characters"
2. base CUTOUT: "ceramic flower pot three-quarter view, empty rim visible"
3. subject CUTOUT: "lush bouquet rising upward as if planted in a pot, stems at bottom of frame"
→ в HTML горшок и букет в одном центре низа; букет перекрывает верх горшка.

Другие ниши (тот же сэндвич):
- Кофе: фон бар → base чашка/блюдце → subject пар/croissant над чашкой
- Beauty: фон мрамор/студия → base флакон → subject капля/крышка чуть выше горлышка
- Еда: фон стол/текстиль → base тарелка → subject блюдо/пар на тарелке
- Недвижка: фон фасад/терраса → base кресло/тумба → subject подушка/лампа на ней
- Спорт: фон зал/трасса → base подиум/коробка → subject кроссовок/мяч на подиуме

═══ ЗАПРЕЩЕНО (разброс = провал) ═══
- объекты в разных углах hero (слева горшок, справа цветок, сверху ещё что-то)
- «коллаж стикеров» без общей оси
- фон, на котором уже нарисован герой+горшок (тогда cutout некуда ставить)
- split «текст слева / картинка справа» как вся композиция
- CSS @keyframes на transform слоёв; свой JS parallax
- |CUTOUT| в карточках/сетках ниже fold

═══ ГЛАВНОЕ ═══
НЕТ {{SCROLLANIM}}. Image-led.
СНАЧАЛА: ниша → тройка (фон / подложка / герой-на-ней) → палитра → HTML.

═══ CUTOUT ═══
|CUTOUT| только для base / subject / accent.
Фон — {{GENIMG:…|16:9}} БЕЗ CUTOUT.
В cutout-промпте: ТОЛЬКО объект, без пола/сцены; НИКОГДА transparent/checkerboard.
Бюджет: до ${VOLUME_MAX_IMAGES} GENIMG, до ${VOLUME_MAX_CUTOUTS} с |CUTOUT|.

═══ РАЗМЕТКА (копируй роли) ═══
Рантайм сам сделает sticky-рельс. НЕ пиши свой parallax JS.

<div data-craft-volume-stack>
  <img data-craft-volume-layer data-craft-volume-role="bg" data-depth="0.2"
       src="{{GENIMG:…|16:9}}" alt=""
       style="inset:0;width:100%;height:100%;object-fit:cover;z-index:1;">
  <img data-craft-volume-layer data-craft-volume-role="base" data-depth="0.85"
       src="{{GENIMG:…|1:1|CUTOUT}}" alt=""
       style="left:50%;bottom:6%;width:min(46vw,420px);object-fit:contain;object-position:bottom;z-index:3;">
  <img data-craft-volume-layer data-craft-volume-role="subject" data-craft-volume-live data-depth="1.2"
       src="{{GENIMG:…|1:1|CUTOUT}}" alt=""
       style="left:50%;bottom:18%;width:min(38vw,340px);object-fit:contain;object-position:bottom;z-index:4;">
  <!-- опционально accent у края, мелкий -->
  <div data-craft-volume-copy style="left:6%;top:22%;">…мало текста…</div>
</div>

Подложка и герой ОБЯЗАНЫ делить одну вертикальную ось (left:50%, translateX через рантайм).
Герой перекрывает верх подложки (bottom subject > bottom base).

═══ ТЕКСТ HERO ═══
≤8–12 слов + 1 CTA. 2–3 смены data-craft-volume-line.
Шрифты Google Fonts под нишу (не Inter/Roboto/Montserrat). weight 400–600; clamp ≤3.6rem.

═══ МОБИЛЬНЫЙ ═══
Тот же сэндвич по центру-низу (overlap), не колонка картинок. Copy снизу.

═══ ОСТАЛЬНОЕ ═══
≥${VOLUME_MIN_BLOCKS} блоков + шапка/футер. Один index.html. CDN только fonts.googleapis.com.
Без кастомного курсора. #site-preloader + craft:frames-ready. 1200–2000 слов суммарно (не в hero).

═══ ФОРМАТ ═══
--- FILE: index.html ---
\`\`\`html
<!DOCTYPE html><html lang="ru">…</html>
\`\`\`

ПЕРЕД ОТПРАВКОЙ:
1. Есть role=bg + role=base + role=subject; subject визуально «из» base
2. Нет разброса по углам; одна ось центр-низ
3. Один свет во всех промптах сцены
4. Нет CSS keyframes на transform слоёв
5. Карточки без |CUTOUT|; cutout без transparent/checkerboard
6. На 375px base+subject overlapping
`;

