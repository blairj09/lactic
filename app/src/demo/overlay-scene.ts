// The website demo's ride overlay. On lactic.fit the demo runs inside an iframe, where Chrome won't
// open a picture-in-picture window, so the overlay is drawn in the page instead: a made-up desktop
// full of made-up windows (a riding game, notes, mail, a terminal, music), with the overlay floating
// on top the way it does in the app. No real app's branding or art; a few jokes for the curious.
// The overlay itself is a same-origin iframe, so the Ride page renders the real overlay into it just
// as it does into the real window.

import { copyStyles } from "@/app/ride/use-pip-window";

/** How wide the overlay sits on the desktop for each of the Ride page's sizes. */
const WIDTH_FOR: Record<number, number> = { 900: 0.5, 1200: 0.62, 1500: 0.76, 1900: 0.9 };

const CSS = `
.lx-scene{position:fixed;inset:0;z-index:2147483000;overflow:hidden;font:400 12px/1.35 system-ui,-apple-system,"Segoe UI",sans-serif;color:#1d1f24;animation:lx-in .25s ease-out;
  background:radial-gradient(120% 90% at 85% 0%,#7aa3ff 0%,transparent 55%),radial-gradient(90% 80% at 0% 100%,#1b2f7a 0%,transparent 60%),linear-gradient(160deg,#3d63db,#1a2a6b)}
@keyframes lx-in{from{opacity:0;transform:scale(1.01)}to{opacity:1;transform:none}}
.lx-menu{position:absolute;inset:0 0 auto 0;height:24px;display:flex;align-items:center;gap:16px;white-space:nowrap;overflow:hidden;padding:0 14px;background:rgba(18,22,40,.35);backdrop-filter:blur(12px);color:#fff;font-size:12px;user-select:none}
.lx-menu b{font-weight:600}
.lx-menu .lx-sp{flex:1}
.lx-w{position:absolute;display:flex;flex-direction:column;border-radius:9px;overflow:hidden;background:#fbfbfc;box-shadow:0 18px 50px rgba(5,10,40,.45),0 0 0 1px rgba(0,0,0,.12)}
.lx-t{display:flex;align-items:center;gap:6px;height:24px;padding:0 9px;background:#e9eaee;border-bottom:1px solid #d6d8de;color:#55595f;font-size:11.5px;flex-shrink:0;user-select:none}
.lx-t i{width:10px;height:10px;border-radius:50%;display:block;flex-shrink:0}
.lx-t i:nth-child(1){background:#ff5f57}.lx-t i:nth-child(2){background:#febc2e}.lx-t i:nth-child(3){background:#28c840}
.lx-t span{flex:1;text-align:center;margin-right:36px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.lx-b{flex:1;min-height:0;overflow:hidden;position:relative}
.lx-dark{background:#15171c;color:#d8dbe2}.lx-dark .lx-t{background:#23262d;border-color:#30333b;color:#9aa0aa}
/* the game */
.lx-game{left:2.5%;top:7%;width:63%;height:64%}
.lx-game svg{position:absolute;inset:0;width:100%;height:100%}
.lx-hud{position:absolute;display:flex;flex-direction:column;gap:2px;padding:6px 9px;border-radius:7px;background:rgba(10,14,24,.55);color:#fff;font-size:11px;backdrop-filter:blur(4px)}
.lx-hud strong{font-size:15px;font-weight:600;letter-spacing:-.01em}
.lx-hud em{font-style:normal;color:#ffd166}
.lx-dash{stroke-dasharray:14 22;animation:lx-road .5s linear infinite}
@keyframes lx-road{to{stroke-dashoffset:-36}}
/* notes */
.lx-notes{right:2.5%;top:8%;width:29%;height:36%}
.lx-notes .lx-b{padding:10px 12px;background:#fffbe6;font:12px/1.55 ui-monospace,SFMono-Regular,Menlo,monospace;color:#3b3626;white-space:pre-wrap}
/* mail */
.lx-mail{right:5%;top:41%;width:31%;height:33%}
.lx-mail ul{list-style:none;margin:0;padding:0}
.lx-mail li{display:flex;flex-direction:column;gap:1px;padding:7px 12px;border-bottom:1px solid #eceef2}
.lx-mail li{position:relative;text-align:left}
.lx-mail li b{font-weight:600;color:#1d1f24;display:flex;gap:8px}
.lx-mail li b small{margin-left:auto}
.lx-mail li b small{font-weight:400;color:#8a8f98}
.lx-mail li span{color:#5c6169;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.lx-mail li.u::before{content:"";position:absolute;left:4px;top:12px;width:6px;height:6px;border-radius:50%;background:#2b55d6}
/* terminal */
.lx-term{left:2%;bottom:3%;width:31%;height:22%}
.lx-term .lx-b{padding:8px 10px;font:11.5px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;color:#c9d1d9;white-space:pre-wrap}
.lx-term .g{color:#7ee787}.lx-term .y{color:#e3b341}
.lx-blink{display:inline-block;width:7px;height:13px;background:#c9d1d9;vertical-align:-2px;animation:lx-blink 1s steps(1) infinite}
@keyframes lx-blink{50%{opacity:0}}
/* music */
.lx-music{right:2%;bottom:5%;width:25%;height:auto}
.lx-music .lx-b{display:flex;gap:10px;align-items:center;padding:10px 12px}
.lx-cover{width:42px;height:42px;border-radius:6px;flex-shrink:0;background:conic-gradient(from 200deg,#ff6b6b,#ffd166,#06d6a0,#2b55d6,#ff6b6b)}
.lx-music .lx-b div{min-width:0;display:flex;flex-direction:column;gap:2px}
.lx-music b{font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.lx-music span{color:#8a8f98;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.lx-music .lx-bar2{height:3px;border-radius:2px;background:#3a3d45;margin-top:3px}.lx-music .lx-bar2 i{display:block;width:62%;height:100%;border-radius:2px;background:#d8dbe2}
/* notification */
.lx-toast{position:absolute;right:1.5%;top:34px;width:min(300px,40%);display:flex;gap:9px;padding:9px 11px;border-radius:11px;background:rgba(246,247,250,.92);backdrop-filter:blur(14px);box-shadow:0 10px 30px rgba(5,10,40,.35);animation:lx-toast .5s 1.2s both ease-out;z-index:3}
@keyframes lx-toast{from{opacity:0;transform:translateX(30px)}to{opacity:1;transform:none}}
.lx-toast i{width:26px;height:26px;border-radius:7px;background:#2b55d6;flex-shrink:0;display:grid;place-items:center;color:#fff;font:700 13px/1 system-ui;font-style:normal}
.lx-toast div{display:flex;flex-direction:column;gap:1px;min-width:0}
.lx-toast b{font-weight:600}
.lx-toast span{color:#5c6169}
/* dock */
.lx-dock{position:absolute;left:50%;bottom:8px;transform:translateX(-50%);display:flex;gap:8px;padding:6px 9px;border-radius:16px;background:rgba(255,255,255,.22);backdrop-filter:blur(14px);box-shadow:0 0 0 1px rgba(255,255,255,.25)}
.lx-dock i{width:34px;height:34px;border-radius:9px;display:grid;place-items:center;color:#fff;font:700 15px/1 system-ui;font-style:normal;box-shadow:inset 0 -2px 0 rgba(0,0,0,.15)}
/* the overlay */
.lx-pip{position:absolute;left:5%;top:13%;z-index:4;border-radius:8px;overflow:hidden;box-shadow:0 18px 50px rgba(0,0,0,.55),0 0 0 1px rgba(255,255,255,.2);background:#1b1f27;display:flex;flex-direction:column;transition:width .15s,height .15s}
.lx-pip .lx-bar{display:flex;align-items:center;gap:6px;height:20px;padding:0 10px;background:#1b1f27;color:#a9b0bd;font-size:11px;flex-shrink:0;user-select:none;cursor:grab}
.lx-pip .lx-bar i{width:8px;height:8px;border-radius:50%;background:#3a3f4a;display:inline-block}
.lx-pip .lx-bar span{margin-left:6px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.lx-pip .lx-view{position:relative;flex:1;overflow:hidden}
.lx-pip iframe{position:absolute;left:0;top:0;border:0;display:block;transform-origin:0 0;background:transparent}
.lx-foot{position:absolute;left:50%;bottom:62px;transform:translateX(-50%);z-index:5;display:flex;align-items:center;gap:12px;padding:7px 8px 7px 16px;border-radius:999px;background:rgba(12,16,32,.78);backdrop-filter:blur(10px);color:#eef1f7;font-size:13px;white-space:nowrap;max-width:calc(100% - 24px)}
.lx-foot span{overflow:hidden;text-overflow:ellipsis}
.lx-foot button{font:inherit;cursor:pointer;border:0;border-radius:999px;padding:6px 13px;background:#fff;color:#111;flex-shrink:0}
.lx-foot button:hover{background:#dfe4ee}
@media (max-width:820px){.lx-mail,.lx-music,.lx-toast,.lx-riders,.lx-wx{display:none}.lx-pip{left:3%}.lx-game{width:95%}.lx-notes{top:auto;bottom:14%;right:4%;width:44%;height:26%}.lx-term{width:46%}.lx-foot span{display:none}.lx-foot{padding-left:8px}}
`;

/** A made-up virtual riding game: layered hills, a road and a HUD. */
const GAME = `
<svg viewBox="0 0 800 450" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
  <defs>
    <linearGradient id="lx-sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ff9a62"/><stop offset=".45" stop-color="#ffc98f"/><stop offset="1" stop-color="#ffe7c4"/></linearGradient>
    <linearGradient id="lx-m1" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8d6fa8"/><stop offset="1" stop-color="#c49aa6"/></linearGradient>
    <linearGradient id="lx-m2" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#5b5a8f"/><stop offset="1" stop-color="#8f7fa0"/></linearGradient>
    <linearGradient id="lx-g1" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3f7d5a"/><stop offset="1" stop-color="#24543d"/></linearGradient>
    <linearGradient id="lx-rd" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#5b5560"/><stop offset="1" stop-color="#2c2a31"/></linearGradient>
  </defs>
  <rect width="800" height="450" fill="url(#lx-sky)"/>
  <circle cx="560" cy="170" r="46" fill="#fff4dc" opacity=".85"/>
  <path d="M0 215 L70 160 L130 190 L220 120 L300 180 L380 135 L470 190 L560 140 L650 185 L720 150 L800 180 V300 H0Z" fill="url(#lx-m1)" opacity=".8"/>
  <path d="M0 250 L90 200 L180 238 L280 185 L370 240 L470 205 L590 250 L690 210 L800 245 V320 H0Z" fill="url(#lx-m2)"/>
  <path d="M0 285 C120 255 230 275 330 262 C420 252 520 270 800 258 V450 H0Z" fill="url(#lx-g1)"/>
  <path d="M388 262 C392 300 330 340 210 450 L620 450 C470 340 410 300 412 262Z" fill="url(#lx-rd)"/>
  <path class="lx-dash" d="M400 264 C401 300 380 360 410 450" stroke="#f4f1e8" stroke-width="4" fill="none" opacity=".85"/>
  <g fill="#1e4532" opacity=".9"><path d="M110 300 l14 -46 l14 46z"/><path d="M80 330 l20 -64 l20 64z"/><path d="M660 296 l14 -44 l14 44z"/><path d="M700 330 l22 -70 l22 70z"/><path d="M600 285 l9 -28 l9 28z"/><path d="M200 282 l9 -28 l9 28z"/></g>
  <g transform="translate(398 360)"><ellipse cx="0" cy="58" rx="40" ry="7" fill="#000" opacity=".25"/><rect x="-5" y="8" width="10" height="46" rx="5" fill="#16161a"/><path d="M-20 -6 Q0 -22 20 -6 L14 26 Q0 34 -14 26Z" fill="#2b55d6"/><circle cx="0" cy="-20" r="11" fill="#f2f2f2"/><path d="M-11 -22 Q0 -36 11 -22Z" fill="#ff6b6b"/><rect x="-24" y="2" width="48" height="5" rx="2.5" fill="#16161a"/></g>
</svg>
<div class="lx-hud" style="left:10px;bottom:10px"><span>Speed</span><strong>34.2 km/h</strong></div>
<div class="lx-hud" style="right:10px;bottom:10px;text-align:right"><span>Next climb</span><strong>The Wall of Regret</strong><em>14% · 600 m</em></div>
<div class="lx-hud lx-riders" style="right:10px;top:10px;text-align:right;max-width:20%"><span>Riders nearby: 4</span><em>all of them named Dave</em></div>`;

const NOTES = `TODO before Saturday
- [x] pump tyres
- [x] find the other shoe
- [ ] FTP test (moved to next week)
- [ ] FTP test (moved to next week)
- [ ] FTP test (moved to next w

Reasons I stopped early
1. too windy (I ride indoors)
2. cat sat on the power meter
3. the Wall of Regret`;

const MAIL = `
<ul>
  <li class="u"><b>Your legs <small>7:02</small></b><span>We need to talk about yesterday.</span></li>
  <li class="u"><b>Bike shop <small>Thu</small></b><span>Your new chainring has shipped (from 2019)</span></li>
  <li class="u"><b>Coach <small>Wed</small></b><span>Re: zone 2 — it means zone 2</span></li>
  <li><b>Group ride <small>Tue</small></b><span>"No drop, conversational pace" (it was not)</span></li>
  <li><b>Partner <small>Mon</small></b><span>Why is there a fan pointed at the bike?</span></li>
</ul>`;

const TERM = `<span class="g">rider@desk</span> ~ % sudo ftp --increase
<span class="y">ftp: permission denied.</span> Try: train --consistently
<span class="g">rider@desk</span> ~ % git blame legs.txt
a1b2c3d (yesterday) "it was the sprint"
<span class="g">rider@desk</span> ~ % <i class="lx-blink"></i>`;

const DOCK = ["#2b55d6:L", "#ff6b6b:♫", "#f4a259:✎", "#3fb68b:✉", "#1f2329:›_", "#8e6fd8:⛰", "#5f6b7a:⚙"]
  .map((d) => {
    const [bg, t] = d.split(":");
    return `<i style="background:${bg}">${t}</i>`;
  })
  .join("");

const DESKTOP = `
  <div class="lx-menu" aria-hidden="true"><b>Desktop</b><span>File</span><span>Edit</span><span>View</span><span>Window</span><span class="lx-sp"></span><span class="lx-wx">☁ 3° and sideways rain</span><span>Sat 7:02</span></div>
  <div class="lx-w lx-dark lx-game" aria-hidden="true"><div class="lx-t"><i></i><i></i><i></i><span>Endless Valley · virtual ride</span></div><div class="lx-b">${GAME}</div></div>
  <div class="lx-w lx-notes" aria-hidden="true"><div class="lx-t"><i></i><i></i><i></i><span>saturday.txt</span></div><div class="lx-b">${NOTES}</div></div>
  <div class="lx-w lx-mail" aria-hidden="true"><div class="lx-t"><i></i><i></i><i></i><span>Inbox · 3 unread</span></div><div class="lx-b">${MAIL}</div></div>
  <div class="lx-w lx-dark lx-term" aria-hidden="true"><div class="lx-t"><i></i><i></i><i></i><span>Terminal</span></div><div class="lx-b">${TERM}</div></div>
  <div class="lx-w lx-dark lx-music" aria-hidden="true"><div class="lx-t"><i></i><i></i><i></i><span>Music</span></div><div class="lx-b"><span class="lx-cover"></span><div><b>Lactate Threshold</b><span>The Watt Bombs · Songs at 92 rpm</span><span class="lx-bar2"><i></i></span></div></div></div>
  <div class="lx-toast" aria-hidden="true"><i>T</i><div><b>Smart trainer</b><span>I'm not mad. I'm just holding 250 W.</span></div></div>
  <div class="lx-dock" aria-hidden="true">${DOCK}</div>`;

/** Opens the scene and returns the overlay's window, for the Ride page to render into. */
export async function openOverlayScene(width: number, height: number, onClose: () => void): Promise<Window> {
  const doc = document;
  const style = doc.createElement("style");
  style.textContent = CSS;
  const scene = doc.createElement("div");
  scene.className = "lx-scene";
  scene.setAttribute("role", "dialog");
  scene.setAttribute("aria-label", "The ride overlay on top of another app");
  scene.innerHTML = `${DESKTOP}
    <div class="lx-pip"><div class="lx-bar"><i></i><i></i><i></i><span>Lactic overlay · stays on top</span></div><div class="lx-view"><iframe title="Lactic ride overlay"></iframe></div></div>
    <div class="lx-foot"><span>Drag the overlay anywhere.</span><button type="button">Back to Lactic</button></div>`;
  scene.prepend(style);
  doc.body.appendChild(scene);

  const desk = scene;
  const pipBox = scene.querySelector<HTMLElement>(".lx-pip")!;
  const frame = scene.querySelector("iframe")!;
  // The overlay renders at its real size and is scaled to fit, so it looks as it does in the app.
  const size = (w: number, h: number) => {
    // On a phone-sized demo the overlay takes the width, so its numbers stay readable.
    const frac = desk.clientWidth < 820 ? 0.94 : (WIDTH_FOR[w] ?? 0.7);
    const boxW = Math.round(desk.clientWidth * frac);
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

  // Drag the overlay around by its title bar, within the desktop.
  const bar = pipBox.querySelector<HTMLElement>(".lx-bar")!;
  bar.addEventListener("pointerdown", (e) => {
    bar.setPointerCapture(e.pointerId);
    const start = { x: e.clientX, y: e.clientY, left: pipBox.offsetLeft, top: pipBox.offsetTop };
    const move = (ev: PointerEvent) => {
      const left = Math.max(0, Math.min(desk.clientWidth - pipBox.offsetWidth, start.left + ev.clientX - start.x));
      const top = Math.max(24, Math.min(desk.clientHeight - pipBox.offsetHeight, start.top + ev.clientY - start.y));
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
  (win as Window & { lxRemove?: () => void }).lxRemove = remove;
  return win;
}

/** Takes the scene down (the Ride page has stopped rendering into it). */
export function closeOverlayScene(win: Window | null) {
  (win as (Window & { lxRemove?: () => void }) | null)?.lxRemove?.();
}
