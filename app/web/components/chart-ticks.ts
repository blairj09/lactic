/** Rough width in pixels of an 11px axis label, by character count. */
export const labelWidth = (label: string) => label.length * 6.5;

/**
 * Drops axis ticks whose labels would touch a neighbor, so narrow charts on a phone stay readable.
 * Prefers an even step (every other week, every third...) and falls back to keeping each tick
 * that clears the last kept one, for uneven ticks such as a log scale's.
 */
export function spaceTicks<T>(ticks: T[], position: (t: T) => number, label: (t: T) => string, gap = 8): T[] {
  const clear = (a: T, b: T) => position(b) - position(a) >= (labelWidth(label(a)) + labelWidth(label(b))) / 2 + gap;

  const greedy: T[] = [];
  for (const t of ticks) if (!greedy.length || clear(greedy[greedy.length - 1], t)) greedy.push(t);
  if (greedy.length === ticks.length) return ticks;

  for (let step = 2; step <= ticks.length; step++) {
    const even = ticks.filter((_, i) => i % step === 0);
    if (even.length < greedy.length) break;
    if (even.every((t, i) => i === 0 || clear(even[i - 1], t))) return even;
  }
  return greedy;
}
