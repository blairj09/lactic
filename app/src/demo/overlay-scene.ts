// The website demo's ride overlay. On lactic.fit the demo runs inside an iframe, where Chrome won't
// open a picture-in-picture window, so the overlay is drawn in the page instead: a mock desktop with
// a browser playing a ride video (generic tabs, no one's real branding) and the overlay floating on
// top, the way it sits over Zwift, a video or a browser in the app. The overlay itself is a same-origin
// iframe, so the Ride page renders the real overlay into it just as it does into the real window.

import { copyStyles } from "@/app/ride/use-pip-window";

/** How wide the overlay sits on the browser window for each of the Ride page's sizes. */
const WIDTH_FOR: Record<number, number> = { 900: 0.62, 1200: 0.74, 1500: 0.86, 1900: 0.96 };

const CSS = `
.lx-scene{position:fixed;inset:0;z-index:2147483000;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;padding:3% 4%;background:rgba(8,10,16,.55);backdrop-filter:blur(2px);font:400 12px/1.3 system-ui,-apple-system,"Segoe UI",sans-serif;animation:lx-in .2s ease-out}
@keyframes lx-in{from{opacity:0}to{opacity:1}}
.lx-browser{position:relative;width:100%;flex:1;min-height:0;max-height:80vh;border-radius:10px;overflow:hidden;box-shadow:0 24px 70px rgba(0,0,0,.55);border:1px solid rgba(255,255,255,.1);display:flex;flex-direction:column;background:#0f0f0f;color:#e8eaed}
.lx-tabs{display:flex;align-items:flex-end;gap:2px;height:34px;padding:0 8px;background:#202124;flex-shrink:0;user-select:none}
.lx-lights{display:flex;gap:7px;align-self:center;margin-right:10px}
.lx-lights i{width:11px;height:11px;border-radius:50%;display:block}
.lx-lights i:nth-child(1){background:#ff5f57}.lx-lights i:nth-child(2){background:#febc2e}.lx-lights i:nth-child(3){background:#28c840}
.lx-tab{display:flex;align-items:center;gap:7px;height:28px;padding:0 12px;min-width:0;flex:0 1 220px;border-radius:8px 8px 0 0;color:#bdc1c6;white-space:nowrap;overflow:hidden}
.lx-tab span{overflow:hidden;text-overflow:ellipsis}
.lx-tab.on{background:#35363a;color:#e8eaed}
.lx-tab b{width:14px;height:14px;border-radius:3px;flex-shrink:0;display:grid;place-items:center;font:700 9px/1 system-ui;color:#fff}
.lx-tool{display:flex;align-items:center;gap:12px;height:36px;padding:0 12px;background:#35363a;flex-shrink:0;color:#9aa0a6}
.lx-tool svg{width:16px;height:16px;flex-shrink:0}
.lx-url{flex:1;min-width:0;height:26px;border-radius:13px;background:#202124;display:flex;align-items:center;gap:8px;padding:0 12px;color:#bdc1c6;white-space:nowrap;overflow:hidden}
.lx-url em{font-style:normal;color:#80868b}
.lx-page{flex:1;min-height:0;display:flex;flex-direction:column;padding:14px 18px 10px;gap:8px}
.lx-video{position:relative;flex:1;min-height:0;border-radius:10px;overflow:hidden;background:#000}
.lx-video video{width:100%;height:100%;object-fit:cover;display:block}
.lx-video .lx-ph{position:absolute;inset:0;background:radial-gradient(120% 90% at 50% 30%,#2a3240,#0a0c10)}
.lx-ctrl{position:absolute;left:0;right:0;bottom:0;padding:22px 14px 9px;background:linear-gradient(transparent,rgba(0,0,0,.7));display:flex;flex-direction:column;gap:7px}
.lx-prog{height:3px;border-radius:2px;background:rgba(255,255,255,.3)}
.lx-prog i{display:block;height:100%;width:38%;border-radius:2px;background:#fff}
.lx-row{display:flex;align-items:center;gap:14px;color:#fff;font-size:12px}
.lx-row svg{width:16px;height:16px}
.lx-row .lx-sp{flex:1}
.lx-meta{flex-shrink:0;display:flex;flex-direction:column;gap:2px}
.lx-meta strong{font-size:15px;font-weight:600;color:#f1f1f1}
.lx-meta span{color:#9aa0a6}
.lx-pip{position:absolute;left:50%;top:84px;transform:translateX(-50%);border-radius:8px;overflow:hidden;box-shadow:0 14px 44px rgba(0,0,0,.6);border:1px solid rgba(255,255,255,.18);background:#1b1f27;display:flex;flex-direction:column;transition:width .15s,height .15s}
.lx-pip .lx-bar{display:flex;align-items:center;gap:6px;height:20px;padding:0 10px;background:#1b1f27;color:#a9b0bd;font-size:11px;flex-shrink:0;user-select:none;cursor:grab}
.lx-pip .lx-bar i{width:8px;height:8px;border-radius:50%;background:#3a3f4a;display:inline-block}
.lx-pip .lx-bar span{margin-left:6px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.lx-pip .lx-view{position:relative;flex:1;overflow:hidden}
.lx-pip iframe{position:absolute;left:0;top:0;border:0;display:block;transform-origin:0 0;background:transparent}
.lx-foot{display:flex;flex-wrap:wrap;align-items:center;justify-content:center;gap:10px 14px;color:#e8ebf1;font-size:13px;text-align:center;max-width:720px}
.lx-foot button{font:inherit;cursor:pointer;border:0;border-radius:999px;padding:7px 14px;background:#fff;color:#111}
.lx-foot button:hover{background:#dfe4ee}
`;

const ICON = (d: string) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${d}"/></svg>`;

/** A ride video, if the site has one (site/demo-media/), playing muted on a loop. */
const VIDEO_SRC = "/demo-media/ride.mp4";

/** A browser window playing a ride video, with a few everyday tabs: no real site's branding. */
const BROWSER = `
  <div class="lx-tabs">
    <div class="lx-lights"><i></i><i></i><i></i></div>
    <div class="lx-tab on"><b style="background:#e8eaed;color:#111">▶</b><span>Alpine pass climb · 4K ride video</span></div>
    <div class="lx-tab"><b style="background:#2b55d6">L</b><span>Lactic</span></div>
    <div class="lx-tab"><b style="background:#f2a93b">☀</b><span>Weekend forecast</span></div>
    <div class="lx-tab"><b style="background:#5f6368">✉</b><span>Inbox (3)</span></div>
  </div>
  <div class="lx-tool">
    ${ICON("M15 18l-6-6 6-6")}${ICON("M9 18l6-6-6-6")}${ICON("M21 12a9 9 0 1 1-3-6.7L21 8M21 3v5h-5")}
    <div class="lx-url">${ICON("M7 11V8a5 5 0 0 1 10 0v3M5 11h14v10H5z")}<span>videos.example.com<em>/watch/alpine-pass-climb</em></span></div>
  </div>
  <div class="lx-page">
    <div class="lx-video">
      <div class="lx-ph"></div>
      <video src="${VIDEO_SRC}" autoplay muted loop playsinline aria-hidden="true"></video>
      <div class="lx-ctrl">
        <div class="lx-prog"><i></i></div>
        <div class="lx-row">${ICON("M6 4h4v16H6zM14 4h4v16h-4z")}${ICON("M11 5L6 9H2v6h4l5 4zM15.5 8.5a5 5 0 0 1 0 7")}<span>17:42 / 46:10</span><span class="lx-sp"></span>${ICON("M4 8V4h4M20 8V4h-4M4 16v4h4M20 16v4h-4")}</div>
      </div>
    </div>
    <div class="lx-meta"><strong>Alpine pass climb · 4K indoor ride video</strong><span>Riding along with a video. The overlay works the same over Zwift or any app.</span></div>
  </div>`;

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
    <div class="lx-browser">
      ${BROWSER}
      <div class="lx-pip"><div class="lx-bar"><i></i><i></i><i></i><span>Lactic overlay · stays on top</span></div><div class="lx-view"><iframe title="Lactic ride overlay"></iframe></div></div>
    </div>
    <div class="lx-foot"><span>In the app, this overlay stays on top of whatever you ride with. Drag it, resize it, or use its controls.</span><button type="button">Back to Lactic</button></div>`;
  // No video on this site yet: keep the dark player.
  scene.querySelector("video")!.addEventListener("error", (e) => ((e.target as HTMLElement).style.display = "none"));
  scene.prepend(style);
  doc.body.appendChild(scene);

  const game = scene.querySelector<HTMLElement>(".lx-browser")!;
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

  // Drag the overlay around by its title bar, within the browser window.
  const bar = pipBox.querySelector<HTMLElement>(".lx-bar")!;
  bar.addEventListener("pointerdown", (e) => {
    bar.setPointerCapture(e.pointerId);
    const start = { x: e.clientX, y: e.clientY, left: pipBox.offsetLeft, top: pipBox.offsetTop };
    const move = (ev: PointerEvent) => {
      const left = Math.max(0, Math.min(game.clientWidth - pipBox.offsetWidth, start.left + ev.clientX - start.x));
      const top = Math.max(70, Math.min(game.clientHeight - pipBox.offsetHeight, start.top + ev.clientY - start.y));
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
