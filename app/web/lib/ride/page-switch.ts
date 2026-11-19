// Switching ride field pages from a keyboard or a trackpad, kept free of the DOM so it tests anywhere.

/** The keyboard event fields that decide a page switch. */
export interface PageKey {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  defaultPrevented: boolean;
}

/** ← is the page before, → the page after; anything with a modifier is some other shortcut. */
export function pageKeyStep(e: PageKey): 1 | -1 | null {
  if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return null;
  if (e.key === "ArrowRight") return 1;
  if (e.key === "ArrowLeft") return -1;
  return null;
}

/** Elements whose own arrow keys matter more than the page: typing, sliders, open dialogs. */
export const OWNS_ARROWS = "input, textarea, select, [contenteditable], [role=slider], [role=dialog]";

/** How far to swipe sideways on a trackpad (in wheel pixels) to turn a page. */
export const SWIPE_DISTANCE = 60;
/** After a page turns, the rest of that swipe (and its momentum) is ignored this long. */
export const SWIPE_REST_MS = 450;

/**
 * Turns a two-finger sideways swipe into one page step. Feed it every wheel event's deltas and time;
 * it answers 1 (swiped left, next page), -1 (swiped right, page before) or null.
 */
export function swipeTracker() {
  let sum = 0;
  let last = -Infinity;
  let turned = -Infinity;
  return (dx: number, dy: number, now: number): 1 | -1 | null => {
    // Momentum keeps sending events after a turn: wait for them to stop before counting again.
    if (now - turned < SWIPE_REST_MS) {
      turned = now;
      return null;
    }
    if (now - last > 200) sum = 0;
    last = now;
    if (Math.abs(dx) <= Math.abs(dy)) return null;
    sum += dx;
    if (Math.abs(sum) < SWIPE_DISTANCE) return null;
    const step = sum > 0 ? 1 : -1;
    sum = 0;
    turned = now;
    return step;
  };
}

/** The ±1 steps from one page to another, the short way round. */
export function stepsTo(from: number, to: number, count: number): (1 | -1)[] {
  if (count < 2 || from === to) return [];
  const forward = (((to - from) % count) + count) % count;
  const back = count - forward;
  return forward <= back ? Array<1>(forward).fill(1) : Array<-1>(back).fill(-1);
}
