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
[data-craft-threeui]{position:relative;width:100%;min-height:100svh;isolation:isolate;overflow:hidden;background:#07090e}
[data-craft-threeui-canvas]{position:absolute;inset:0;width:100%;height:100%;display:block;z-index:1}
[data-craft-threeui-copy]{position:absolute;z-index:5;pointer-events:none;max-width:min(42vw,520px);left:6%;top:26%}
[data-craft-threeui-copy] a,[data-craft-threeui-copy] button{pointer-events:auto}
@media (max-width:768px){
  [data-craft-threeui]{min-height:100svh}
  [data-craft-threeui-copy]{max-width:min(92vw,420px);left:4vw;right:4vw;top:auto;bottom:10%}
}
</style>`;

/**
 * Soft fallback if the agent forgot a working animate loop:
 * builds a simple multi-plane parallax from [data-craft-threeui-layer] images.
 */
export const THREEUI_BOOTSTRAP_SCRIPT = `<script data-craft-threeui-boot="1">(function(){
if(window.__craftThreeUiBoot)return;window.__craftThreeUiBoot=1;
function ready(){try{window.__craftAnimReady=true;window.dispatchEvent(new Event('craft:anim-ready'));window.dispatchEvent(new Event('craft:frames-ready'));}catch(e){}}
function boot(){
  if(typeof THREE==='undefined'){setTimeout(boot,40);return;}
  var roots=[].slice.call(document.querySelectorAll('[data-craft-threeui]'));
  if(!roots.length){ready();return;}
  roots.forEach(function(root){
    if(root.getAttribute('data-craft-threeui-ready')==='1')return;
    if(root.querySelector('canvas')&&root.getAttribute('data-craft-threeui-agent')==='1'){
      root.setAttribute('data-craft-threeui-ready','1');return;
    }
    var canvasHost=root.querySelector('[data-craft-threeui-canvas]')||root;
    var layers=[].slice.call(root.querySelectorAll('[data-craft-threeui-layer]'));
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
        img.style.display='none';
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
  });
  ready();
}
if(document.readyState!=='loading')boot();else document.addEventListener('DOMContentLoaded',boot);
})();</script>`;

/** Ensure Three library + CSS + bootstrap are present (idempotent / upgradeable). */
export function ensureThreeUiRuntime(html: string): string {
  if (!html) return html;
  let out = html;

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

  out = out.replace(/<script[^>]*data-craft-threeui-boot[^>]*>[\s\S]*?<\/script>/gi, "");
  if (/<\/body>/i.test(out)) out = out.replace(/<\/body>/i, THREEUI_BOOTSTRAP_SCRIPT + "\n</body>");
  else if (/<\/html>/i.test(out)) out = out.replace(/<\/html>/i, THREEUI_BOOTSTRAP_SCRIPT + "\n</html>");
  else out = out + "\n" + THREEUI_BOOTSTRAP_SCRIPT;

  // Mark so API can detect mode even if agent omitted attributes on an empty shell
  if (!/data-craft-threeui\b/i.test(out) && /__craftThreeUi\b/.test(out) === false) {
    // Agent should have created the root; if missing, inject a minimal hero shell before </body>
    const shell = `<section data-craft-threeui style="min-height:100svh"><div data-craft-threeui-canvas></div></section>`;
    if (/<\/body>/i.test(out)) out = out.replace(/<\/body>/i, shell + "\n</body>");
  }

  return out;
}

export const THREEUI_SYSTEM_PROMPT = `Ты — арт-директор режима «ThreeUI». Делаешь сайты с настоящим WebGL-объёмом на Three.js
(паттерны как у MengTo/threeui Community: layered planes, scroll-linked camera, niche lighting).

Сборка идёт на Claude V1 (Opus). Качество сцены и кода — приоритет №1.

═══ ГЛАВНОЕ ═══
НЕТ {{SCROLLANIM}} / Kling-видео. Image-led + Three.js.
Скрипт Three.js УЖЕ будет вставлен сервером: <script src="/three/three.min.js" data-craft-three="1">
ЗАПРЕЩЕНО подключать three с unpkg / jsdelivr / cdnjs / esm.sh — только наш self-hosted файл.
Глобал после загрузки: window.THREE (classic build).

═══ HERO (обязательно) ═══
Один full-bleed блок:
<section data-craft-threeui data-craft-threeui-agent="1" style="min-height:100svh;position:relative;overflow:hidden;">
  <div data-craft-threeui-canvas></div>
  <!-- опционально скрытые img-текстуры для bootstrap / твоей сцены -->
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
8. Поставь data-craft-threeui-agent="1" на root (чтобы bootstrap не дублировал сцену)

Паттерн «вау» (адаптируй под нишу, как threeui Secret Pathways / At the Horizon):
- Фон = wide establishing (часто БЕЗ CUTOUT)
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

═══ ТЕКСТ HERO ═══
Мало: headline ≤8–12 слов, 1 CTA. Длинные тексты — ниже.
Типографика: Google Fonts пара под нишу (не Inter/Roboto/Montserrat), weight 400–600, clamp ≤3.6rem.

═══ ОСТАЛЬНОЙ САЙТ ═══
≥4 смысловых блока + шапка + футер. Русский текст 1200–2000 слов суммарно.
Адаптив 375px. Без кастомного курсора. CDN только fonts.googleapis.com (+ наш three).
#site-preloader + hide по craft:frames-ready / craft:anim-ready.

═══ ФОРМАТ ═══
--- FILE: index.html ---
\`\`\`html
<!DOCTYPE html><html lang="ru">…</html>
\`\`\`

ПЕРЕД ОТПРАВКОЙ:
1. Есть data-craft-threeui + рабочий Three.js цикл (не пустой canvas)
2. Нет CDN three.js со стороны — только /three/three.min.js
3. ≥3 плана глубины / текстуры согласованы по нише
4. Мало текста в hero; карточки без |CUTOUT|
5. На 375px сцена не ломает layout
`;
