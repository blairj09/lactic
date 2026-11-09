// The website demo's ride overlay. On lactic.fit the demo runs inside an iframe, where Chrome won't
// open a picture-in-picture window, so the overlay is drawn in the page instead: a mock desktop with
// a riding game window (plain drawn scenery, no one's real art) and the overlay floating on top,
// the way it sits over Zwift, a video or a browser in the app. The overlay itself is a same-origin
// iframe, so the Ride page renders the real overlay into it just as it does into the real window.

import { copyStyles } from "@/app/ride/use-pip-window";

/** How wide the overlay sits on the game window for each of the Ride page's sizes. */
const WIDTH_FOR: Record<number, number> = { 900: 0.62, 1200: 0.74, 1500: 0.86, 1900: 0.96 };

const CSS = `
.lx-scene{position:fixed;inset:0;z-index:2147483000;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;padding:3% 4%;background:rgba(8,10,16,.55);backdrop-filter:blur(2px);font:500 13px/1.3 system-ui,-apple-system,sans-serif;animation:lx-in .2s ease-out}
@keyframes lx-in{from{opacity:0}to{opacity:1}}
.lx-game{position:relative;width:100%;flex:1;min-height:0;max-height:78vh;border-radius:10px;overflow:hidden;box-shadow:0 20px 60px rgba(0,0,0,.5);border:1px solid rgba(255,255,255,.12);display:flex;flex-direction:column;background:#0d1320}
.lx-bar{display:flex;align-items:center;gap:6px;height:26px;padding:0 10px;background:#1b1f27;color:#a9b0bd;font-size:12px;flex-shrink:0;user-select:none}
.lx-bar i{width:10px;height:10px;border-radius:50%;background:#3a3f4a;display:inline-block}
.lx-bar span{margin-left:8px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.lx-game svg{flex:1;min-height:0;width:100%;display:block}
.lx-dash{stroke-dasharray:6 10;animation:lx-road .6s linear infinite}
@keyframes lx-road{to{stroke-dashoffset:-16}}
.lx-pip{position:absolute;left:50%;top:44px;transform:translateX(-50%);border-radius:8px;overflow:hidden;box-shadow:0 14px 40px rgba(0,0,0,.55);border:1px solid rgba(255,255,255,.18);background:#1b1f27;display:flex;flex-direction:column;transition:width .15s,height .15s}
.lx-pip .lx-bar{height:20px;cursor:grab;font-size:11px}
.lx-pip .lx-bar i{width:8px;height:8px}
.lx-pip .lx-view{position:relative;flex:1;overflow:hidden}
.lx-pip iframe{position:absolute;left:0;top:0;border:0;display:block;transform-origin:0 0;background:transparent}
.lx-foot{display:flex;flex-wrap:wrap;align-items:center;justify-content:center;gap:10px 14px;color:#e8ebf1;text-align:center;max-width:720px}
.lx-foot button{font:inherit;cursor:pointer;border:0;border-radius:999px;padding:7px 14px;background:#fff;color:#111}
.lx-foot button:hover{background:#dfe4ee}
`;

/** Plain drawn scenery: sky, hills and a road with moving lane marks. */
const GAME_ART = `<svg viewBox="0 0 800 450" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
<defs><linearGradient id="lx-sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#7fb4e6"/><stop offset="1" stop-color="#d9ecf7"/></linearGradient>
<linearGradient id="lx-grass" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#7cb35a"/><stop offset="1" stop-color="#4f8a3a"/></linearGradient></defs>
<rect width="800" height="450" fill="url(#lx-sky)"/>
<circle cx="640" cy="90" r="34" fill="#fff6c9" opacity=".9"/>
<path d="M0 230 L90 170 L170 215 L260 150 L360 210 L450 160 L560 220 L660 165 L800 225 V260 H0Z" fill="#9db6c9"/>
<path d="M0 250 Q120 205 240 240 T480 235 T800 245 V300 H0Z" fill="#8fbf6a"/>
<rect y="245" width="800" height="205" fill="url(#lx-grass)"/>
<path d="M392 245 L408 245 L620 450 L180 450Z" fill="#54575e"/>
<path d="M392 245 L180 450 M408 245 L620 450" stroke="#e9e6dc" stroke-width="3"/>
<path class="lx-dash" d="M400 248 L400 450" stroke="#f3d34a" stroke-width="5" transform="matrix(1 0 0 1 0 0)"/>
<g fill="#2f6b34"><path d="M120 300 l18 -48 l18 48z"/><path d="M80 330 l22 -60 l22 60z"/><path d="M660 305 l18 -50 l18 50z"/><path d="M700 340 l24 -64 l24 64z"/><path d="M560 270 l10 -28 l10 28z"/><path d="M230 270 l10 -28 l10 28z"/></g>
</svg>`;

/** Opens the scene and returns the overlay's window, for the Ride page to render into. */
export async function openOverlayScene(width: number, height: number, onClose: () => void): Promise<Window> {
  const doc = document;
  const style = doc.createElement("style");
  style.textContent = CSS;
  const scene = doc.createElement("div");
  scene.className = "lx-scene";
  scene.setAttribute("role", "dialog");
  scene.setAttribute("aria-label", "The ride overlay on top of another app");
  scene.innerHTML = `
    <div class="lx-game">
      <div class="lx-bar"><i></i><i></i><i></i><span>Your riding app: Zwift, a video, a browser</span></div>
      ${GAME_ART}
      <div class="lx-pip"><div class="lx-bar"><i></i><i></i><i></i><span>Lactic overlay · stays on top</span></div><div class="lx-view"><iframe title="Lactic ride overlay"></iframe></div></div>
    </div>
    <div class="lx-foot"><span>In the app, this overlay stays on top of whatever you ride with. Drag it, resize it, or use its controls.</span><button type="button">Back to Lactic</button></div>`;
  scene.prepend(style);
  doc.body.appendChild(scene);

  const game = scene.querySelector<HTMLElement>(".lx-game")!;
  const pipBox = scene.querySelector<HTMLElement>(".lx-pip")!;
  const frame = scene.querySelector("iframe")!;
  // The overlay renders at its real size and is scaled to fit, so it looks as it does in the app.
  const size = (w: number, h: number) => {
    const frac = WIDTH_FOR[w] ?? 0.7;
    const boxW = Math.round(game.clientWidth * frac);
    const scale = boxW / w;
    pipBox.style.width = `${boxW}px`;
    pipBox.style.height = `${Math.round(h * scale) + 20}px`;
    frame.style.width = `${w}px`;
    frame.style.height = `${h}px`;
    frame.style.transform = `scale(${scale})`;
  };
  let current = [width, height] as const;
  size(...current);
  const onWindowResize = () => size(...current);
  window.addEventListener("resize", onWindowResize);

  // Drag the overlay around by its title bar, within the game window.
  const bar = pipBox.querySelector<HTMLElement>(".lx-bar")!;
  bar.addEventListener("pointerdown", (e) => {
    bar.setPointerCapture(e.pointerId);
    const start = { x: e.clientX, y: e.clientY, left: pipBox.offsetLeft, top: pipBox.offsetTop };
    const move = (ev: PointerEvent) => {
      const left = Math.max(0, Math.min(game.clientWidth - pipBox.offsetWidth, start.left + ev.clientX - start.x));
      const top = Math.max(26, Math.min(game.clientHeight - pipBox.offsetHeight, start.top + ev.clientY - start.y));
      pipBox.style.transform = "none";
      pipBox.style.left = `${left}px`;
      pipBox.style.top = `${top}px`;
    };
    const up = () => {
      bar.removeEventListener("pointermove", move);
      bar.removeEventListener("pointerup", up);
    };
    bar.addEventListener("pointermove", move);
    bar.addEventListener("pointerup", up);
  });

  const win = frame.contentWindow!;
  const inner = win.document;
  inner.open();
  inner.write("<!doctype html><html><head></head><body></body></html>");
  inner.close();
  copyStyles(inner);
  const html = inner.documentElement;
  html.className = doc.documentElement.className;
  const syncTheme = () => {
    const theme = doc.documentElement.dataset.theme;
    if (theme) html.dataset.theme = theme;
    else delete html.dataset.theme;
  };
  syncTheme();
  const watch = new MutationObserver(syncTheme);
  watch.observe(doc.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  // The Ride page sizes the overlay with resizeTo; here that resizes the floating box.
  win.resizeTo = (w: number, h: number) => {
    current = [w, h];
    size(w, h);
  };

  const remove = () => {
    watch.disconnect();
    window.removeEventListener("resize", onWindowResize);
    scene.remove();
  };
  scene.querySelector("button")!.addEventListener("click", onClose);
  scene.addEventListener("click", (e) => e.target === scene && onClose());
  (win as Window & { lxRemove?: () => void }).lxRemove = remove;
  return win;
}

/** Takes the scene down (the Ride page has stopped rendering into it). */
export function closeOverlayScene(win: Window | null) {
  (win as (Window & { lxRemove?: () => void }) | null)?.lxRemove?.();
}
