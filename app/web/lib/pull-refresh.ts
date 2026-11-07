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
