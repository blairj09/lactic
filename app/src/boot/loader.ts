// The startup screen in index.html plays every time Lactic opens. It stays up until the mark has built
// and the name has come in (one full build), then fades into the app. Time spent really loading counts
// toward that, so a slow start never waits longer than it has to.

/** Mark built at ~1.0s, name in at ~1.16s (see the boot-build / boot-name keyframes in index.html). */
export const LOADER_MIN_MS = 1250;
const FADE_MS = 300;

/** How long to keep the loader up once the app is ready, given how long startup already took. */
export function loaderHoldMs(elapsedMs: number, minMs = LOADER_MIN_MS): number {
  return Math.max(0, minMs - elapsedMs);
}

export function hideLoader(): void {
  const el = document.getElementById("boot");
  if (!el) return;
  const fade = () => {
    el.classList.add("boot-out");
    window.setTimeout(() => el.remove(), FADE_MS + 50);
  };
  // Let the app paint underneath first, so the fade reveals it rather than a blank page.
  requestAnimationFrame(() => requestAnimationFrame(() => window.setTimeout(fade, loaderHoldMs(performance.now()))));
}
