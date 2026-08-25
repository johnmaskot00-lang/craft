---
name: threeui
description: >-
  Build Craft Interactive ThreeUI sites from MengTo/threeui Community patterns —
  WebGL layered heroes, scroll/pointer camera, niche lighting. Use for threeui mode.
---

# ThreeUI Skill (Craft)

Source blueprint: [MengTo/threeui](https://github.com/MengTo/threeui) (Community, MIT) · [threeui.com](https://threeui.com)

Study this skill, then build a **vanilla single-file** site for Craft. Do **not** import React, `@designcodeio/threeui`, npm, or CDN three.

## Craft runtime bridge (non-negotiable)

| Upstream threeui | Craft |
|---|---|
| React components / Vite | One `index.html` |
| npm `three` / embedded bundle | Already injected: `<script src="/three/three.min.js" data-craft-three="1">` → `window.THREE` |
| Local PNG/GLB assets | `{{GENIMG:english\|ratio}}` and `{{GENIMG:…\|1:1\|CUTOUT}}` as textures / layers |
| Pro-only components | Ignore — Community patterns only |

**Must ship**

1. Hero root: `[data-craft-threeui][data-craft-threeui-agent="1"]` + `[data-craft-threeui-canvas]`
2. ≥3 depth planes (far / mid / subject[+accent]) via `Plane`/`Group` + textures
3. `new THREE.WebGLRenderer` + `requestAnimationFrame` loop
4. Scroll + light pointer parallax (damped, not 1:1 jitter)
5. After first successful `renderer.render`: `window.__craftThreeUiAgentLive = true`
6. Fire `craft:anim-ready` / `craft:frames-ready` and set `window.__craftAnimReady = true`
7. Resize updates `camera.aspect` + `renderer.setSize`

**Forbidden**

- Full-bleed CSS `background-image` / body photo as the hero (classic flat landing)
- `{{SCROLLANIM}}` / Kling video
- unpkg / jsdelivr / cdnjs / esm.sh for three
- Stamping `data-craft-threeui-agent="1"` without a real WebGLRenderer loop
- Custom cursor (`cursor:none` + follower)
- Inter / Roboto / Montserrat as display

## Community catalog → pick an archetype

Choose **one** primary hero archetype from Community (adapt to the client niche — do not copy brands):

| Archetype (threeui id) | Visual thesis | Craft recipe |
|---|---|---|
| **Layered depth landing** (Secret Pathways / cutout depth) | Far establishing + mid props + near cutouts; camera dolly on scroll | GENIMG 16:9 far plane; CUTOUT mid/near; z = -4 / -2 / -0.8 |
| **Atmosphere temple** (Kage / temple-night) | Night mood, fog, hemisphere+key light, procedural or textured surfaces | `FogExp2`, `HemisphereLight` + `DirectionalLight`, damp camera |
| **Living world path** (Sylva / landscape) | Journey feel, time-of-day light, organic motion | Soft fog, warm key, slow camera along a curve or dolly |
| **Particle / field** (constellation-field, portal-field, structure-flow) | Points / streaks as mid-atmosphere, not the whole site | Sparse `Points` or thin planes; keep brand copy readable |
| **Liquid / metal accent** (liquid-form, spark-badge energy) | One hero object with rich material; rest restrained | One subject plane/mesh + quiet far plate |

Landings studied from repo HTML (patterns, not copy-paste): `public/landing-pages/kage.html`, `inner-green-3d.html`, Community sync ids in `public/community-sync-report.json`.

## Scene grammar (from Kage / Sylva DNA)

1. **Dark stage** — canvas fills the hero; page chrome (header copy) sits above in HTML, not painted into the texture.
2. **Lights** — Ambient (low) + Hemisphere (sky/ground tint for niche) + one Directional key. Match GENIMG time-of-day.
3. **Fog (optional)** — `FogExp2` or linear fog so far planes fall off; sells depth without more meshes.
4. **Damping** — `lerp` / exp damp toward scroll target and pointer; never raw mouse = camera.
5. **Reduced motion** — if `prefers-reduced-motion: reduce`, keep a static pleasing frame (still WebGL).
6. **Mobile** — fewer particles / lower pixel ratio (`Math.min(devicePixelRatio, 2)`); copy bottom-safe.

## HTML skeleton (required shape)

```html
<section data-craft-threeui data-craft-threeui-agent="1" style="min-height:100svh;position:relative;overflow:hidden;">
  <div data-craft-threeui-canvas></div>
  <img data-craft-threeui-layer data-depth="0.3" src="{{GENIMG:far establishing for niche, wide, coherent light|16:9}}" alt="" hidden>
  <img data-craft-threeui-layer data-depth="0.9" src="{{GENIMG:mid subject|1:1|CUTOUT}}" alt="" hidden>
  <img data-craft-threeui-layer data-depth="1.4" src="{{GENIMG:near accent|1:1|CUTOUT}}" alt="" hidden>
  <div data-craft-threeui-copy>
    <h1>…≤12 words…</h1>
    <a href="#…">CTA</a>
  </div>
</section>
```

Map each `data-craft-threeui-layer` → `TextureLoader` → `MeshStandardMaterial` / `MeshBasicMaterial` on a `PlaneGeometry` at distinct `z`. Hide the `<img>` after load.

## Minimal agent loop (pattern)

```js
const root = document.querySelector("[data-craft-threeui]");
const host = root.querySelector("[data-craft-threeui-canvas]");
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
host.appendChild(renderer.domElement);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
// lights + planes from [data-craft-threeui-layer]…
let scrollT = 0, scrollCur = 0, mx = 0, my = 0;
function tick() {
  requestAnimationFrame(tick);
  scrollCur += (scrollT - scrollCur) * 0.06;
  camera.position.set(mx * 0.35, -my * 0.22, 6 - scrollCur * 1.8);
  camera.lookAt(0, 0, 0);
  renderer.render(scene, camera);
  if (!window.__craftThreeUiAgentLive) {
    window.__craftThreeUiAgentLive = true;
    window.__craftAnimReady = true;
    window.dispatchEvent(new Event("craft:anim-ready"));
    window.dispatchEvent(new Event("craft:frames-ready"));
  }
}
tick();
```

## Rest of the site

After the WebGL hero: ≥4 content sections + header + footer, Russian copy ~1200–2000 words total, niche Google Fonts pair, `#site-preloader` dismissed on `craft:frames-ready`. Card grids below the fold: normal photos **without** `|CUTOUT|`.

## Self-verify before answer

- [ ] WebGLRenderer + animate + `__craftThreeUiAgentLive`
- [ ] ≥3 z-planes; scroll moves camera/layers
- [ ] No CSS photo hero; no CDN three; no SCROLLANIM
- [ ] Mobile readable; preloader clears

If any box fails — fix the HTML in the same reply.
