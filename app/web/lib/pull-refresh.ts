/** How far (px, after resistance) the page must be pulled before letting go refreshes it. */
export const PULL_THRESHOLD = 70;
/** The furthest the indicator travels, however far the finger goes. */
export const PULL_MAX = 110;

/**
 * Turns finger travel into indicator travel: 1:1-ish at first, then it stiffens like the native
 * rubber band, so a long drag never runs off the screen.
 */
export function pullDistance(fingerDy: number): number {
  if (fingerDy <= 0) return 0;
  const eased = PULL_MAX * (1 - Math.exp(-fingerDy / PULL_MAX));
  return Math.round(eased * 10) / 10;
}

/** True once a pull of this (eased) distance would refresh on release. */
export const pullArmed = (distance: number) => distance >= PULL_THRESHOLD;

/** The logo's bars, left to right: each grows in turn as the pull goes from nothing to armed. */
export const LOGO_BARS = 5;

/** How far bar `i` (0 first) has grown, 0 to 1, at `progress` (0 to 1) of the way to armed. */
export function barGrowth(progress: number, i: number): number {
  return Math.max(0, Math.min(1, progress * LOGO_BARS - i));
}

/** What a pull runs before the page refetches (on the iPhone: read Apple Health, sync with the computer). */
let work: (() => Promise<unknown>) | null = null;

/** Sets the work a pull runs; returns a function that takes it off again. */
export function setPullRefreshWork(fn: () => Promise<unknown>): () => void {
  work = fn;
  return () => {
    if (work === fn) work = null;
  };
}

/** Runs the pull's work (failures are the work's own to report), at most `ms`. */
export async function runPullRefreshWork(ms = 30_000): Promise<void> {
  if (!work) return;
  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([work().catch(() => {}), new Promise((r) => (timer = setTimeout(r, ms)))]);
  clearTimeout(timer);
}
