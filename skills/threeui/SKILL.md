---
name: threeui
description: >-
  Build Craft Interactive ThreeUI sites from MengTo/threeui Community patterns —
  living WebGL worlds (Kage-class), not flat photo-plane parallax. Use for threeui mode.
---

# ThreeUI Skill (Craft)

Source: [MengTo/threeui](https://github.com/MengTo/threeui) Community MIT · refs: `public/landing-pages/kage.html`, `inner-green-3d.html`, catalog in `community-sync-report.json`.

Goal: a **living 3D hero** like the Opus + threeui demos (temple / landscape / particles) — **not** four floating JPEGs with mouse parallax.

## Craft runtime bridge

| Upstream | Craft |
|---|---|
| React / Vite / npm three | One `index.html` + injected `/three/three.min.js` → `window.THREE` |
| Local PNG/GLB | Prefer **procedural** CanvasTexture / geometry; optional `{{GENIMG}}` accents only |
| Hours of Claude Code self-verify | One shot — so the first HTML must already be rich |

**Must**

1. `[data-craft-threeui][data-craft-threeui-agent="1"]` + `[data-craft-threeui-canvas]`
2. Real `new THREE.WebGLRenderer` + rAF loop; after first render: `window.__craftThreeUiAgentLive = true`
3. `craft:anim-ready` / `craft:frames-ready` + `__craftAnimReady`
4. Resize: aspect + `setSize` (size to **host** / root, not blindly only `window` if hero is not full window)
5. Damped scroll + pointer; respect `prefers-reduced-motion`

**Forbidden (auto-fail)**

- Hero = only 3–5 `PlaneGeometry` textured with GENIMG/photos + parallax (Lotus-style photo collage)
- Full-bleed CSS `background-image` as the hero
- `{{SCROLLANIM}}`, CDN three, custom cursor, Inter/Roboto/Montserrat display
- Stamping `agent="1"` without a working WebGLRenderer loop

## Quality bar = Kage DNA (study, then adapt to niche)

From `kage.html` (Kyoto temple, after dark) — **everything generated at runtime**:

1. **Procedural surfaces** — 2D canvas → `CanvasTexture` / normal maps (noise, seams, rain streaks), not a stock photo as the whole world
2. **Real meshes** — Groups of boxes/cylinders/planes/instanced foliage forming a place, not a slideshow of images
3. **Atmosphere** — `FogExp2` or soft fog, `HemisphereLight` + key `DirectionalLight` / point accents matching niche time-of-day
4. **Life** — particles, falling elements, subtle idle motion, optional path/dolly on scroll
5. **HTML copy overlays** the canvas — logo/nav/headline outside the texture

Sylva / landscape DNA: journey feel, organic motion, cohesive light — still a **world**, not cards.

## Archetypes (pick one, map to client niche)

| Archetype | Thesis | Build with |
|---|---|---|
| Atmosphere place (Kage / temple-night) | Visitor stands in a designed space | Procedural mats + mesh architecture + fog |
| Living path (Sylva / landscape) | Scroll moves through an environment | Curve/dolly + vegetation instances + soft fog |
| Particle field (constellation / portal / structure-flow) | Energy / tech mood | `Points` / thin ribbons + one solid subject |
| Product shrine | One hero object in volume light | Lathe/box/group subject + dark stage + rim light |

GENIMG / `|CUTOUT|` layers: **optional accents** (one prop, one poster) — never the entire depth stack.

## HTML shell

```html
<section data-craft-threeui data-craft-threeui-agent="1" style="min-height:100svh;position:relative;overflow:hidden;">
  <div data-craft-threeui-canvas></div>
  <!-- optional accent textures only -->
  <div data-craft-threeui-copy>
    <h1>…≤12 words…</h1>
    <a href="#…">CTA</a>
  </div>
</section>
```

## Agent loop checklist

```js
const root = document.querySelector("[data-craft-threeui]");
const host = root.querySelector("[data-craft-threeui-canvas]");
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
host.appendChild(renderer.domElement);
// build WORLD (meshes + lights + fog + particles) here — not only photo planes
function tick() {
  requestAnimationFrame(tick);
  // damp scroll/pointer → camera / groups
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

Size renderer to `root.clientWidth/Height` (fallback window). Pixel ratio `Math.min(devicePixelRatio, 2)`.

## Rest of site

≥4 sections + header + footer, Russian ~1200–2000 words, niche Google Fonts, `#site-preloader` on `craft:frames-ready`. Below-fold cards: normal photos, no `|CUTOUT|`.

## Self-verify

- [ ] Would a stranger say “this is a 3D place”, not “parallax photos”?
- [ ] Procedural or mesh-built world present (not only GENIMG planes)
- [ ] Fog/lights/motion coherent with niche
- [ ] `__craftThreeUiAgentLive`, no CDN three, no CSS photo hero
- [ ] Mobile: still readable; reduce particle count if needed

If the hero is only textured planes — **rewrite before answering**.
