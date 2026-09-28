/**
 * «Тригер» — Hero with a character on the RIGHT, background on the LEFT.
 * ~3s Kling clip: continuous head turn LEFT → CENTER → RIGHT (one smooth sweep).
 * Mouse/touch X maps linearly to that timeline so gaze follows the cursor.
 */

import { gemini } from "./gemini";
import { type SiteTheme, themeOrDefault, themeImport, themeSize, themeHeadingCss, alpha } from "./site-theme";

async function downloadFrameBase64(
  url: string,
): Promise<{ base64: string; mimeType: string } | null> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 20000);
    const resp = await fetch(url, { signal: ctrl.signal });
    clearTimeout(t);
    if (!resp.ok) return null;
    const ct = (resp.headers.get("content-type") || "image/webp").split(";")[0].trim();
    if (!ct.startsWith("image/")) return null;
    const buf = Buffer.from(await resp.arrayBuffer());
    if (!buf.length || buf.length > 12 * 1024 * 1024) return null;
    return { base64: buf.toString("base64"), mimeType: ct };
  } catch (e: any) {
    console.warn("[TRIGGER] frame download failed:", e?.message || e);
    return null;
  }
}

/**
 * Ensure frames run LEFT→RIGHT (viewer POV). If Kling emitted RIGHT→LEFT, reverse.
 */
export async function normalizeTriggerLookFrames(frames: string[]): Promise<string[]> {
  if (!frames || frames.length < 4) return frames || [];
  const first = frames[0];
  const last = frames[frames.length - 1];
  if (!first || !last || first === last) return frames;

  try {
    const [a, b] = await Promise.all([downloadFrameBase64(first), downloadFrameBase64(last)]);
    if (!a || !b) return frames;

    const instruction =
      `You compare TWO frames of the SAME front-facing character/mascot (robot, animal, or stylized hero).\n` +
      `IMAGE 1 = the FIRST frame of a short head-turn clip.\n` +
      `IMAGE 2 = the LAST frame of the same clip.\n` +
      `For each image, judge where the character's HEAD/EYES look from the VIEWER's perspective: LEFT, CENTER, or RIGHT.\n` +
      `Then choose the clip direction:\n` +
      `- LEFT_TO_RIGHT — IMAGE 1 looks more LEFT (or equal) and IMAGE 2 looks more RIGHT\n` +
      `- RIGHT_TO_LEFT — IMAGE 1 looks more RIGHT and IMAGE 2 looks more LEFT\n` +
      `If unsure but IMAGE 1 is clearly more right-facing than IMAGE 2, answer RIGHT_TO_LEFT.\n` +
      `Reply with ONLY one token: LEFT_TO_RIGHT or RIGHT_TO_LEFT`;

    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const callP = gemini.models.generateContent({
      model: "gemini-2.5-flash",
      contents: [{
        role: "user",
        parts: [
          { text: "IMAGE 1 (first frame):" },
          { inlineData: { data: a.base64, mimeType: a.mimeType } },
          { text: "IMAGE 2 (last frame):" },
          { inlineData: { data: b.base64, mimeType: b.mimeType } },
          { text: instruction },
        ],
      }],
      config: { abortSignal: controller.signal },
    });
    const timeoutP = new Promise<null>((resolve) => {
      timer = setTimeout(() => { controller.abort(); resolve(null); }, 20000);
    });
    const result: any = await Promise.race([callP, timeoutP]);
    if (timer) clearTimeout(timer);
    if (!result) {
      console.warn("[TRIGGER] look-order detect timed out — keeping original frame order");
      return frames;
    }
    const text: string =
      result?.text ??
      result?.candidates?.[0]?.content?.parts?.map((p: any) => p.text).filter(Boolean).join("") ??
      "";
    const normalized = String(text).replace(/\s+/g, " ").trim().toUpperCase();
    if (normalized.includes("RIGHT_TO_LEFT")) {
      console.log(`[TRIGGER] reversing ${frames.length} frames (detected RIGHT→LEFT gaze)`);
      return frames.slice().reverse();
    }
    console.log(`[TRIGGER] frame order OK (LEFT→RIGHT), reply="${normalized.slice(0, 40)}"`);
  } catch (e: any) {
    console.warn("[TRIGGER] look-order detect failed:", e?.message || e);
  }
  return frames;
}

export function buildTriggerLookHtml(
  frames: string[],
  texts: Array<{ title: string; sub: string }>,
  navCtl: string,
  esc: (s: string) => string,
  theme?: SiteTheme,
): string {
  const cid = "trg" + Math.random().toString(36).slice(2, 8);
  const th = themeOrDefault(theme, texts);
  // Text sits over a photo/video frame: on dark themes darken the left side and
  // use the theme ink; on light themes wash it with the page background instead.
  const ink = th.ink;
  const veil = th.dark
    ? `linear-gradient(90deg,rgba(0,0,0,.62) 0%,rgba(0,0,0,.28) 38%,rgba(0,0,0,.08) 58%,rgba(0,0,0,.2) 100%),
  radial-gradient(ellipse 55% 70% at 22% 50%,rgba(0,0,0,.35) 0%,transparent 70%)`
    : `linear-gradient(90deg,${alpha(th.bg, 0.9)} 0%,${alpha(th.bg, 0.55)} 38%,${alpha(th.bg, 0.1)} 58%,${alpha(th.bg, 0)} 100%)`;
  const veilMobile = th.dark
    ? "linear-gradient(180deg,rgba(0,0,0,.2) 0%,rgba(0,0,0,.15) 40%,rgba(0,0,0,.72) 100%)"
    : `linear-gradient(180deg,${alpha(th.bg, 0)} 0%,${alpha(th.bg, 0.2)} 40%,${alpha(th.bg, 0.92)} 100%)`;
  const shadow = th.dark ? "0 10px 40px rgba(0,0,0,.55)" : `0 6px 30px ${alpha(th.bg, 0.7)}`;
  const subShadow = th.dark ? "0 2px 16px rgba(0,0,0,.4)" : `0 2px 14px ${alpha(th.bg, 0.6)}`;
  const framesJson = JSON.stringify(frames || []).replace(/</g, "\\u003c");
  const hero = texts[0] || { title: "", sub: "" };
  const title = hero.title ? esc(hero.title) : "";
  const sub = hero.sub ? esc(hero.sub) : "";

  return `
<!--craft-scrollanim-full-->
<section class="${cid}-hero" data-frames='${framesJson}' data-layout="trigger" data-craft-scrollanim="1" data-craft-trigger="1">
  <div class="${cid}-stage">
    <canvas class="${cid}-canvas" aria-hidden="true"></canvas>
    <div class="${cid}-veil"></div>
    <div class="${cid}-copy">
      ${title ? `<h1 class="${cid}-title">${title}</h1>` : ""}
      ${sub ? `<p class="${cid}-sub">${sub}</p>` : ""}
      <p class="${cid}-hint">двигайте мышью · персонаж смотрит за курсором</p>
    </div>
  </div>
</section>
<style>
${themeImport(th)}
.${cid}-hero{position:relative;min-height:100vh;margin:0;padding:0;background:${th.bg};overflow:hidden;}
.${cid}-stage{position:relative;min-height:100vh;width:100%;}
.${cid}-canvas{position:absolute;inset:0;width:100%;height:100%;display:block;}
.${cid}-veil{position:absolute;inset:0;pointer-events:none;background:
  ${veil};}
.${cid}-copy{position:relative;z-index:2;min-height:100vh;display:flex;flex-direction:column;justify-content:center;
  padding:clamp(88px,12vh,140px) clamp(18px,5vw,64px);max-width:min(520px,52vw);box-sizing:border-box;color:${ink};
  pointer-events:none;}
.${cid}-title{margin:0;${themeHeadingCss(th)}font-size:${themeSize(th, "clamp(1.85rem,4.6vw,3.6rem)")};
  line-height:1.04;color:${ink};text-shadow:${shadow};}
.${cid}-sub{margin:.85rem 0 0;max-width:34ch;font-family:${th.body};font-size:clamp(.95rem,1.5vw,1.15rem);
  line-height:1.5;color:${alpha(ink, 0.88)};text-shadow:${subShadow};}
.${cid}-hint{margin-top:1.4rem;font-family:${th.body};font-size:.66rem;letter-spacing:.14em;
  text-transform:uppercase;color:${alpha(th.accent, 0.8)};transition:opacity .45s ease;}
@media (max-width:780px){
  .${cid}-copy{max-width:92vw;justify-content:flex-end;padding-bottom:clamp(28px,8vh,64px);text-align:left;}
  .${cid}-veil{background:
    ${veilMobile};}
}
@media (prefers-reduced-motion:reduce){
  .${cid}-hint{display:none;}
}
</style>
<script>
(function(){
  var roots=document.querySelectorAll('.${cid}-hero');
  roots.forEach(function(root){
    if(root.__trgInit)return; root.__trgInit=true;
    var frames; try{ frames=JSON.parse(root.getAttribute('data-frames')||'[]'); }catch(e){ frames=[]; }
    if(!frames.length) return;
    var canvas=root.querySelector('.${cid}-canvas');
    if(!canvas) return;
    var ctx=canvas.getContext('2d',{ alpha:false });
    var imgs=new Array(frames.length);
    var loaded=0, ready=false;
    var target=0, current=0;
    var reduce=window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    var hint=root.querySelector('.${cid}-hint');
    var lastDraw=-1;
    var lastPtrX=null, lastPtrY=null;
    var lastIdx=Math.max(0, frames.length-1);

    function fitDraw(img){
      if(!img || !img.complete || !img.naturalWidth) return;
      var dpr=Math.min(window.devicePixelRatio||1, 2);
      var w=canvas.clientWidth, h=canvas.clientHeight;
      if(!w || !h) return;
      if(canvas.width!==Math.floor(w*dpr) || canvas.height!==Math.floor(h*dpr)){
        canvas.width=Math.floor(w*dpr); canvas.height=Math.floor(h*dpr);
      }
      ctx.setTransform(dpr,0,0,dpr,0,0);
      ctx.fillStyle='${th.bg}';
      ctx.fillRect(0,0,w,h);
      var s=Math.max(w/img.naturalWidth, h/img.naturalHeight);
      var dw=img.naturalWidth*s, dh=img.naturalHeight*s;
      var dx=(w-dw)/2, dy=(h-dh)/2;
      ctx.drawImage(img, dx, dy, dw, dh);
    }

    function render(){
      var i=Math.max(0, Math.min(lastIdx, Math.round(current)));
      if(i===lastDraw && canvas.width) return;
      var img=imgs[i];
      if(img){ fitDraw(img); lastDraw=i; }
    }

    // Linear follow: cursor left → look LEFT (frame 0), right → look RIGHT (last frame).
    // Frames are LEFT → CENTER → RIGHT. No center→left→right zig-zag scrub.
    function lookFromPointer(clientX){
      var rect=root.getBoundingClientRect();
      var nx=(clientX - rect.left) / Math.max(1, rect.width);
      return Math.max(0, Math.min(1, nx));
    }

    function onPointer(clientX, clientY){
      if(!ready || reduce) return;
      lastPtrX=clientX; lastPtrY=clientY;
      var look=lookFromPointer(clientX);
      target = look * lastIdx;
      if(hint) hint.style.opacity='0';
    }

    function tick(){
      if(ready){
        // Snappy follow so gaze tracks the cursor closely.
        var ease = reduce ? 1 : 0.42;
        current += (target - current) * ease;
        if(Math.abs(target - current) < 0.03) current = target;
        render();
      }
      requestAnimationFrame(tick);
    }

    function onMove(e){ onPointer(e.clientX, e.clientY); }
    function onTouch(e){
      if(e.touches && e.touches[0]) onPointer(e.touches[0].clientX, e.touches[0].clientY);
    }
    window.addEventListener('pointermove', onMove, {passive:true});
    window.addEventListener('touchmove', onTouch, {passive:true});
    // Rest looking CENTER until the user moves.
    target = 0.5 * lastIdx;
    current = target;

    window.addEventListener('resize', function(){
      lastDraw=-1;
      if(lastPtrX!=null) onPointer(lastPtrX, lastPtrY);
      render();
    });

    frames.forEach(function(url, idx){
      var img=new Image();
      img.decoding='async';
      img.onload=function(){
        imgs[idx]=img;
        loaded++;
        if(idx===Math.round(0.5*lastIdx) || idx===0) fitDraw(img);
        if(loaded>=frames.length){
          for(var i=0;i<frames.length;i++){
            if(!imgs[i] || !imgs[i].naturalWidth){
              var prev=null;
              for(var j=i-1;j>=0;j--){ if(imgs[j] && imgs[j].naturalWidth){ prev=imgs[j]; break; } }
              var any=null;
              for(var k=0;k<frames.length;k++){ if(imgs[k] && imgs[k].naturalWidth){ any=imgs[k]; break; } }
              imgs[i]=prev || any || img;
            }
          }
          ready=true;
          try{ window.dispatchEvent(new Event('craft:frames-ready')); }catch(e){}
          render();
        }
      };
      img.onerror=function(){
        loaded++;
        if(loaded>=frames.length){
          for(var i=0;i<frames.length;i++){
            if(!imgs[i] || !imgs[i].naturalWidth){
              var prev=null;
              for(var j=i-1;j>=0;j--){ if(imgs[j] && imgs[j].naturalWidth){ prev=imgs[j]; break; } }
              var any=null;
              for(var k=0;k<frames.length;k++){ if(imgs[k] && imgs[k].naturalWidth){ any=imgs[k]; break; } }
              imgs[i]=prev || any;
            }
          }
          if(imgs.some(function(x){ return x && x.naturalWidth; })){
            ready=true;
            try{ window.dispatchEvent(new Event('craft:frames-ready')); }catch(e){}
            render();
          }
        }
      };
      img.src=url;
    });
    requestAnimationFrame(tick);
  });
})();
</script>
${navCtl}
<!--/craft-scrollanim-full-->
`;
}
