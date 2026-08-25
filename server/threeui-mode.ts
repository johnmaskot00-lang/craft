/**
 * «ThreeUI» interactive style — Three.js depth heroes inspired by
 * MengTo/threeui Community patterns (layered planes, scroll camera, niche lighting).
 *
 * three.min.js is self-hosted at /three/three.min.js (also bundled into publish assets).
 * Generation runs on Claude V1 (Opus via official Anthropic SDK) — forced in routes.ts.
 */

import fs from "fs";
import path from "path";

export const THREEUI_MAX_IMAGES = 8;
export const THREEUI_IMAGE_PHASE_MS = 900_000;
export const THREEUI_SCRIPT_SRC = "/three/three.min.js";
export const THREEUI_PUBLISH_ASSET = "assets/three.min.js";

/** Absolute path to vendored three.min.js (client/public/three). */
export function threeMinJsPath(): string {
  const candidates = [
    path.join(process.cwd(), "client", "public", "three", "three.min.js"),
    path.join(process.cwd(), "dist", "public", "three", "three.min.js"),
    path.join(process.cwd(), "public", "three", "three.min.js"),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return candidates[0];
}

export function readThreeMinJs(): Buffer | null {
  try {
    const p = threeMinJsPath();
    if (!fs.existsSync(p)) return null;
    return fs.readFileSync(p);
  } catch {
    return null;
  }
}

export function hasCraftThreeUi(html: string): boolean {
  return /data-craft-threeui\b/i.test(html || "") || /__craftThreeUi\b/.test(html || "");
}

/** True if the agent actually wrote a WebGL scene (not just attributes + CSS photo). */
export function agentWroteThreeUiScene(html: string): boolean {
  if (!html) return false;
  const withoutBoot = html.replace(/<script[^>]*data-craft-threeui-boot[\s\S]*?<\/script>/gi, "");
  return (
    /__craftThreeUiAgentLive\s*=\s*!?\s*0*\s*true/i.test(withoutBoot) ||
    /new\s+THREE\s*\.\s*WebGLRenderer/i.test(withoutBoot) ||
    /THREE\s*\.\s*WebGLRenderer\s*\(/i.test(withoutBoot)
  );
}

export function buildThreeUiNicheAddon(userPrompt: string, projectTitle?: string): string {
  const brief = [projectTitle, userPrompt]
    .filter(Boolean)
    .join(" — ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 500);
  if (!brief) return "";
  return `\n\n═══ НИША ЭТОГО КЛИЕНТА ═══
Запрос: ${brief}
Собери Three.js сцену под ЭТУ нишу: палитра света, формы/текстуры планов, движение камеры.
Промпты GENIMG (если нужны текстуры/cutout) — один мир со сценой. Шрифты — под нишу.
═══ КОНЕЦ НИШИ ═══\n`;
}

/**
 * Rewrite editor `/three/three.min.js` → publish-relative asset path.
 * Caller must also push three.min.js into the publish files list.
 */
export function rewriteThreeUiScriptForPublish(html: string): string {
  if (!html) return html;
  return html
    .replace(
      /(<script[^>]*\bsrc=["'])\/three\/three\.min\.js(["'][^>]*>)/gi,
      `$1${THREEUI_PUBLISH_ASSET}$2`,
    )
    .replace(
      /(<script[^>]*\bsrc=["'])https?:\/\/[^"']+\/three\/three\.min\.js(["'][^>]*>)/gi,
      `$1${THREEUI_PUBLISH_ASSET}$2`,
    );
}

/** Baseline CSS for the ThreeUI hero stage. */
export const THREEUI_BASE_CSS = `<style id="craft-threeui-css">
html.craft-threeui-page,body.craft-threeui-page{background:#07090e!important;background-image:none!important}
[data-craft-threeui]{position:relative;width:100%;min-height:100svh;isolation:isolate;overflow:hidden;background:#07090e!important;background-image:none!important}
[data-craft-threeui-canvas]{position:absolute;inset:0;width:100%;height:100%;display:block;z-index:1;pointer-events:none}
[data-craft-threeui-copy]{position:absolute;z-index:5;pointer-events:none;max-width:min(42vw,520px);left:6%;top:26%}
[data-craft-threeui-copy] a,[data-craft-threeui-copy] button{pointer-events:auto}
header{position:relative;z-index:20}
@media (max-width:768px){
  [data-craft-threeui]{min-height:100svh}
  [data-craft-threeui-copy]{max-width:min(92vw,420px);left:4vw;right:4vw;top:auto;bottom:10%}
}
</style>`;

/**
 * Soft fallback if the agent forgot a working animate loop:
 * builds a simple multi-plane parallax from [data-craft-threeui-layer] images.
 *
 * Do NOT trust data-craft-threeui-agent="1" alone — agents often stamp it and
 * leave a CSS background photo (classic master-prompt hero) with a hollow canvas.
 * Only skip when the agent sets window.__craftThreeUiAgentLive after a real render,
 * or data-craft-threeui-ready is already set.
 */
export const THREEUI_BOOTSTRAP_SCRIPT = `<script data-craft-threeui-boot="1">(function(){
if(window.__craftThreeUiBoot)return;window.__craftThreeUiBoot=1;
function ready(){try{window.__craftAnimReady=true;window.dispatchEvent(new Event('craft:anim-ready'));window.dispatchEvent(new Event('craft:frames-ready'));}catch(e){}}
function bootRoot(root){
  if(root.getAttribute('data-craft-threeui-ready')==='1')return;
  if(window.__craftThreeUiAgentLive){root.setAttribute('data-craft-threeui-ready','1');return;}
  // Agent shipped real WebGL code — never steal the scene (even if live flag forgotten).
  if(root.getAttribute('data-craft-threeui-has-code')==='1'){
    root.setAttribute('data-craft-threeui-ready','1');
    return;
  }
  root.removeAttribute('data-craft-threeui-agent');
  var canvasHost=root.querySelector('[data-craft-threeui-canvas]')||root;
  // Drop hollow agent canvases so we don't stack two WebGL views.
  [].slice.call(canvasHost.querySelectorAll('canvas')).forEach(function(c){try{c.remove();}catch(e){}});
  var layers=[].slice.call(root.querySelectorAll('[data-craft-threeui-layer]'));
  if(!layers.length){
    layers=[].slice.call(document.querySelectorAll('img[src]')).filter(function(img){
      if(img.closest('[data-craft-threeui-copy]'))return false;
      var s=img.getAttribute('src')||'';return s&&s.indexOf('data:image/svg')!==0;
    }).slice(0,5);
  }
  var w=root.clientWidth||window.innerWidth,h=root.clientHeight||window.innerHeight;
  var renderer=new THREE.WebGLRenderer({antialias:true,alpha:true,powerPreference:'high-performance'});
  renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,2));
  renderer.setSize(w,h,false);
  renderer.domElement.style.cssText='position:absolute;inset:0;width:100%;height:100%;display:block;z-index:1';
  canvasHost.appendChild(renderer.domElement);
  var scene=new THREE.Scene();
  var camera=new THREE.PerspectiveCamera(42,w/Math.max(1,h),0.1,100);
  camera.position.set(0,0,6);
  scene.add(new THREE.AmbientLight(0xffffff,0.55));
  var key=new THREE.DirectionalLight(0xffe6d0,1.15);key.position.set(2.5,3,4);scene.add(key);
  var meshes=[];
  function addPlane(url,z,scale,y){
    var loader=new THREE.TextureLoader();
    loader.load(url,function(tex){
      tex.colorSpace=THREE.SRGBColorSpace||tex.encoding;
      var aspect=(tex.image&&tex.image.width&&tex.image.height)?(tex.image.width/tex.image.height):1.2;
      var geo=new THREE.PlaneGeometry(scale*aspect,scale);
      var mat=new THREE.MeshStandardMaterial({map:tex,transparent:true,depthWrite:false,side:THREE.DoubleSide});
      var mesh=new THREE.Mesh(geo,mat);mesh.position.set(0,y||0,z);scene.add(mesh);meshes.push({mesh:mesh,z:z,baseY:y||0});
    },undefined,function(){});
  }
  if(layers.length){
    layers.forEach(function(img,i){
      var src=img.getAttribute('src')||img.currentSrc;if(!src)return;
      var depth=parseFloat(img.getAttribute('data-depth')||String(0.3+i*0.45));
      addPlane(src,-depth*2.2,3.2+depth*0.6,(i%2?0.15:-0.1)*depth);
      if(img.hasAttribute&&img.hasAttribute('data-craft-threeui-layer'))img.style.display='none';
    });
  }else{
    var geo=new THREE.PlaneGeometry(8,5);
    var mat=new THREE.MeshStandardMaterial({color:0x1a2230,roughness:0.85,metalness:0.05});
    var mesh=new THREE.Mesh(geo,mat);mesh.position.z=-4;scene.add(mesh);meshes.push({mesh:mesh,z:-4,baseY:0});
  }
  var target=0,cur=0,mx=0,my=0;
  function onScroll(){
    var r=root.getBoundingClientRect();
    var p=1-(r.top+r.height)/(window.innerHeight+r.height);
    target=Math.max(0,Math.min(1,p));
  }
  function onMove(e){
    var r=root.getBoundingClientRect();
    mx=((e.clientX-r.left)/Math.max(1,r.width)-0.5)*2;
    my=((e.clientY-r.top)/Math.max(1,r.height)-0.5)*2;
  }
  window.addEventListener('scroll',onScroll,{passive:true});
  root.addEventListener('pointermove',onMove,{passive:true});
  onScroll();
  function resize(){
    w=root.clientWidth||window.innerWidth;h=root.clientHeight||window.innerHeight;
    camera.aspect=w/Math.max(1,h);camera.updateProjectionMatrix();renderer.setSize(w,h,false);
  }
  window.addEventListener('resize',resize,{passive:true});
  function tick(){
    requestAnimationFrame(tick);
    cur+=(target-cur)*0.06;
    camera.position.x=mx*0.35;camera.position.y=-my*0.22;camera.position.z=6-cur*1.8;
    camera.lookAt(0,0,0);
    meshes.forEach(function(item,i){
      item.mesh.position.z=item.z+cur*(0.4+i*0.25);
      item.mesh.position.y=item.baseY+Math.sin(cur*Math.PI+i)*0.05;
    });
    renderer.render(scene,camera);
  }
  tick();
  root.setAttribute('data-craft-threeui-ready','1');
}
function boot(){
  if(typeof THREE==='undefined'){setTimeout(boot,40);return;}
  var roots=[].slice.call(document.querySelectorAll('[data-craft-threeui]'));
  if(!roots.length){ready();return;}
  var pending=roots.filter(function(root){
    return root.getAttribute('data-craft-threeui-agent')==='1' && !window.__craftThreeUiAgentLive;
  });
  function runAll(){
    roots.forEach(bootRoot);
    ready();
  }
  if(pending.length){
    var n=0;
    (function waitAgent(){
      if(window.__craftThreeUiAgentLive){runAll();return;}
      if(++n<30){setTimeout(waitAgent,50);return;}
      runAll();
    })();
  }else runAll();
}
if(document.readyState!=='loading')boot();else document.addEventListener('DOMContentLoaded',boot);
})();</script>`;

/** Pull likely hero image URLs from flat CSS/photo landings the agent may have emitted. */
function collectSalvageImageUrls(html: string): string[] {
  const urls: string[] = [];
  const seen = new Set<string>();
  const push = (u: string) => {
    const url = (u || "").trim();
    if (!url || seen.has(url)) return;
    if (/^data:image\/svg/i.test(url)) return;
    if (/site-preloader|favicon|logo\.svg/i.test(url)) return;
    seen.add(url);
    urls.push(url);
  };
  for (const m of html.matchAll(/\burl\(\s*['"]?([^)'"]+)['"]?\s*\)/gi)) push(m[1]);
  for (const m of html.matchAll(/<img\b[^>]*\bsrc=["']([^"']+)["']/gi)) push(m[1]);
  return urls.slice(0, 5);
}

function buildLayerImgs(urls: string[]): string {
  return urls
    .map((url, i) => {
      const depth = (0.35 + i * 0.45).toFixed(2);
      return `<img data-craft-threeui-layer data-depth="${depth}" src="${url}" alt="" hidden>`;
    })
    .join("\n  ");
}

/** Ensure Three library + CSS + bootstrap are present (idempotent / upgradeable). */
export function ensureThreeUiRuntime(html: string): string {
  if (!html) return html;
  let out = html;

  // Mark document so CSS can kill competing full-bleed photo backgrounds.
  if (/<html\b/i.test(out) && !/\bclass=["'][^"']*\bcraft-threeui-page\b/i.test(out)) {
    out = out.replace(/<html\b([^>]*)>/i, (_m, attrs: string) => {
      if (/\bclass=/i.test(attrs)) {
        return `<html${attrs.replace(/\bclass=(["'])/i, "class=$1craft-threeui-page ")}>`;
      }
      return `<html class="craft-threeui-page"${attrs}>`;
    });
  }
  if (/<body\b/i.test(out) && !/<body\b[^>]*\bcraft-threeui-page\b/i.test(out)) {
    out = out.replace(/<body\b([^>]*)>/i, (_m, attrs: string) => {
      if (/\bclass=/i.test(attrs)) {
        return `<body${attrs.replace(/\bclass=(["'])/i, "class=$1craft-threeui-page ")}>`;
      }
      return `<body class="craft-threeui-page"${attrs}>`;
    });
  }

  const hasAgentCode = agentWroteThreeUiScene(out);
  // Hollow "I own the scene" stamps without WebGLRenderer → let bootstrap take over.
  if (/data-craft-threeui-agent\s*=\s*["']1["']/i.test(out) && !hasAgentCode) {
    out = out.replace(/\s*data-craft-threeui-agent\s*=\s*["']1["']/gi, "");
    console.warn("[ThreeUI] stripped hollow data-craft-threeui-agent (no WebGLRenderer in HTML)");
  } else if (
    hasAgentCode &&
    /data-craft-threeui(?![\w-])/i.test(out) &&
    !/data-craft-threeui-has-code\s*=/i.test(out)
  ) {
    // Match standalone data-craft-threeui only — NOT inside data-craft-threeui-agent
    // (old regex used \b before "-agent" and produced has-code="1"-agent="1").
    out = out.replace(
      /(<[a-z][\w-]*\b[^>]*?\bdata-craft-threeui(?![\w-])[^>]*)(>)/i,
      `$1 data-craft-threeui-has-code="1"$2`,
    );
  }

  out = out.replace(/<style[^>]*id=["']craft-threeui-css["'][^>]*>[\s\S]*?<\/style>/gi, "");
  if (/<\/head>/i.test(out)) out = out.replace(/<\/head>/i, THREEUI_BASE_CSS + "\n</head>");
  else if (/<body[^>]*>/i.test(out)) out = out.replace(/<body[^>]*>/i, (m) => `${m}\n${THREEUI_BASE_CSS}`);
  else out = THREEUI_BASE_CSS + "\n" + out;

  // Library — always our self-hosted copy (never unpkg/jsdelivr).
  out = out.replace(/<script[^>]*data-craft-three=["']1["'][^>]*>\s*<\/script>/gi, "");
  out = out.replace(/<script[^>]*src=["'][^"']*three(?:\.min)?\.js["'][^>]*>\s*<\/script>/gi, (tag) => {
    // Keep only if already our self-hosted path
    if (/\/three\/three\.min\.js|assets\/three\.min\.js/i.test(tag) && /data-craft-three/i.test(tag)) return tag;
    return "";
  });
  if (!/data-craft-three=["']1["']/i.test(out)) {
    const lib = `<script src="${THREEUI_SCRIPT_SRC}" data-craft-three="1"></script>`;
    if (/<\/head>/i.test(out)) out = out.replace(/<\/head>/i, lib + "\n</head>");
    else if (/<body[^>]*>/i.test(out)) out = out.replace(/<body[^>]*>/i, (m) => `${m}\n${lib}`);
    else out = lib + "\n" + out;
  }

  // Ensure root + layers exist (salvage flat CSS-photo landings).
  const salvage = collectSalvageImageUrls(out);
  if (!/data-craft-threeui\b/i.test(out) && /__craftThreeUi\b/.test(out) === false) {
    const layers = buildLayerImgs(salvage);
    const shell = `<section data-craft-threeui style="min-height:100svh;position:relative;overflow:hidden;">
  <div data-craft-threeui-canvas></div>
  ${layers}
</section>`;
    if (/<\/body>/i.test(out)) out = out.replace(/<\/body>/i, shell + "\n</body>");
    else out = out + "\n" + shell;
    console.warn("[ThreeUI] injected missing data-craft-threeui shell (+ salvage layers:", salvage.length, ")");
  } else if (!/data-craft-threeui-layer\b/i.test(out) && salvage.length > 0) {
    const layers = buildLayerImgs(salvage);
    const canvasBit = /data-craft-threeui-canvas\b/i.test(out)
      ? ""
      : `<div data-craft-threeui-canvas></div>\n  `;
    out = out.replace(
      /(<[^>]*\bdata-craft-threeui\b[^>]*>)/i,
      `$1\n  ${canvasBit}${layers}\n`,
    );
    console.warn("[ThreeUI] injected salvage layers into existing root:", salvage.length);
  }
  if (/data-craft-threeui\b/i.test(out) && !/data-craft-threeui-canvas\b/i.test(out)) {
    out = out.replace(
      /(<[^>]*\bdata-craft-threeui\b[^>]*>)/i,
      `$1\n  <div data-craft-threeui-canvas></div>\n`,
    );
  }

  out = out.replace(/<script[^>]*data-craft-threeui-boot[^>]*>[\s\S]*?<\/script>/gi, "");
  if (/<\/body>/i.test(out)) out = out.replace(/<\/body>/i, THREEUI_BOOTSTRAP_SCRIPT + "\n</body>");
  else if (/<\/html>/i.test(out)) out = out.replace(/<\/html>/i, THREEUI_BOOTSTRAP_SCRIPT + "\n</html>");
  else out = out + "\n" + THREEUI_BOOTSTRAP_SCRIPT;

  return out;
}

export const THREEUI_SYSTEM_PROMPT = `Ты — арт-директор режима «ThreeUI». Делаешь сайты с настоящим WebGL-объёмом на Three.js.

═══ SOURCE BLUEPRINT + SKILL ═══
Канон: https://github.com/MengTo/threeui (Community) и https://threeui.com
Ниже в этом system-промпте будет блок «THREEUI SKILL» (файл skills/threeui/SKILL.md) —
изучи его как учебник паттернов, затем собери сайт. Не игнорируй skill.
НЕ копируй React/npm — ванильный Three.js в один index.html (+ наш /three/three.min.js).
Нишу клиента накладывай поверх archetype из skill (свет, текстуры, объекты).

Сборка идёт на Claude V1 (Opus). Режим: EXTRA EFFORT — не черновик.
Трать «ход мысли» на сцену: свет, z-планы, скролл, мобилка. Избегай AI-slop (Inter, центр+2 CTA+stats, плоский фон).

═══ ГЛАВНОЕ ═══
НЕТ {{SCROLLANIM}} / Kling-видео. Image-led + Three.js.
Скрипт Three.js УЖЕ будет вставлен сервером: <script src="/three/three.min.js" data-craft-three="1">
ЗАПРЕЩЕНО подключать three с unpkg / jsdelivr / cdnjs / esm.sh — только наш self-hosted файл.
Глобал после загрузки: window.THREE (classic build).

═══ ЗАПРЕТ ПЛОСКОГО ФОТО-HERO (как в обычном master-промпте) ═══
Это НЕ режим «красивая фотка на весь экран + логотип в углу».
КАТЕГОРИЧЕСКИ ЗАПРЕЩЕНО:
- background-image / background:url(...) на html, body, header, .hero, section как ГЛАВНЫЙ hero
- Полноэкранный <img> или псевдоэлемент ::before с фото вместо WebGL
- Hero = только CSS + одно GENIMG без Three.js сцены
- Ставить data-craft-threeui-agent="1" БЕЗ рабочего WebGLRenderer + animate loop
Если сделаешь плоский фото-лендинг — ответ НЕВЕРЕН, перепиши.

═══ HERO (обязательно) ═══
Один full-bleed блок — СЦЕНА рисуется ТОЛЬКО на canvas Three.js:
<section data-craft-threeui data-craft-threeui-agent="1" style="min-height:100svh;position:relative;overflow:hidden;">
  <div data-craft-threeui-canvas></div>
  <!-- скрытые текстуры для планов (НЕ как CSS-фон страницы) -->
  <img data-craft-threeui-layer data-depth="0.3" src="{{GENIMG:…|16:9}}" alt="" hidden>
  <img data-craft-threeui-layer data-depth="0.9" src="{{GENIMG:…|1:1|CUTOUT}}" alt="" hidden>
  <img data-craft-threeui-layer data-depth="1.4" src="{{GENIMG:…|1:1|CUTOUT}}" alt="" hidden>
  <div data-craft-threeui-copy>…мало текста…</div>
</section>

Свой <script> (после загрузки THREE) ОБЯЗАН:
1. Найти [data-craft-threeui]
2. Создать Scene + PerspectiveCamera + WebGLRenderer в [data-craft-threeui-canvas]
3. Собрать 3–5 планов глубины (Plane / Group): дальний фон, mid, subject, foreground bleed
4. Свет под нишу (Ambient + Directional / Hemisphere; цвет как у бренда)
5. Анимация requestAnimationFrame: камера/планы реагируют на scroll + лёгкий pointer parallax
6. Resize: обновить size/aspect
7. По готовности текстур: window.__craftAnimReady=true и события craft:anim-ready / craft:frames-ready
8. После ПЕРВОГО успешного renderer.render(...): window.__craftThreeUiAgentLive=true
9. Поставь data-craft-threeui-agent="1" на root ТОЛЬКО если пункты 1–8 реально выполнены

Паттерн «вау» (адаптируй под нишу, как threeui Secret Pathways / At the Horizon):
- Фон = wide establishing (часто БЕЗ CUTOUT) → Texture на дальнем Plane, НЕ CSS background
- Средний/ближний = cutout-объекты ниши (|CUTOUT| в GENIMG)
- Сильно разный scale/z у планов; камера медленно подъезжает при скролле
- Один свет/время суток во всех текстурах

Пример промптов (робототехника):
1. "Martian dusk horizon rocky plain under starfield, wide establishing, no characters"
2. CUTOUT "exploration rover three-quarter view"
3. CUTOUT "soft sun disk with warm corona"
→ planes at z=-4 / -2 / -0.8, camera dolly on scroll

═══ GENIMG ═══
Бюджет: до ${THREEUI_MAX_IMAGES} маркеров. |CUTOUT| только для объектных слоёв сцены (не карточки).
В cutout-промпте НЕ пиши transparent/checkerboard — только объект.
Карточки/сетки ниже fold — обычные фото БЕЗ CUTOUT.
GENIMG для hero — только в data-craft-threeui-layer (или TextureLoader в скрипте), не в CSS.

═══ ТЕКСТ HERO ═══
Мало: headline ≤8–12 слов, 1 CTA. Длинные тексты — ниже.
Типографика: Google Fonts пара под нишу (не Inter/Roboto/Montserrat), weight 400–600, clamp ≤3.6rem.
Шапка может быть поверх сцены (прозрачная), но НЕ заменяет сцену.

═══ ОСТАЛЬНОЙ САЙТ ═══
≥4 смысловых блоков + шапка + футер. Русский текст 1200–2000 слов суммарно.
Адаптив 375px. Без кастомного курсора. CDN только fonts.googleapis.com (+ наш three).
#site-preloader + hide по craft:frames-ready / craft:anim-ready.

═══ SELF-VERIFY (перед ответом — обязательно) ═══
Мысленно (и в коде) проверь сам, пока не «зелёное»:
1. В HTML есть new THREE.WebGLRenderer и animate loop; __craftThreeUiAgentLive=true после render
2. ≥3 плана с разным z; скролл реально двигает камеру/слои (не статичная картинка и не CSS background)
3. Нет CDN three; нет SCROLLANIM; нет кастомного курсора; нет background-image hero на body/section
4. Resize не ломает aspect; на 375px copy читаем, сцена не уезжает
5. __craftAnimReady / craft:frames-ready вызываются (прелоадер снимется)
6. Нет JS-синтаксических дыр, незакрытых строк, обращения к undefined mesh до load
Если что-то из списка слабо — ДОРАБОТАЙ HTML в этом же ответе, не сдавай сырой черновик.

═══ ФОРМАТ ═══
--- FILE: index.html ---
\`\`\`html
<!DOCTYPE html><html lang="ru">…</html>
\`\`\`

ПЕРЕД ОТПРАВКОЙ (чеклист после self-verify):
1. data-craft-threeui + рабочий Three.js цикл + __craftThreeUiAgentLive
2. Только /three/three.min.js
3. ≥3 плана / согласованный свет ниши
4. Мало текста в hero; карточки без |CUTOUT|
5. Мобилка ок; НЕТ плоского CSS-фото hero
`;
