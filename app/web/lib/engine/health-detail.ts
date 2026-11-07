// Numbers behind the Health detail views: a series' summary over the window shown, where the window
// starts once data does, and a rolling best for VO2 max.

import { addDays } from "./pmc";

export interface SeriesStats {
  /** The most recent value and its index in the series. */
  latest: number | null;
  latestIndex: number | null;
  mean: number | null;
  min: number | null;
  max: number | null;
  /** Days with a value. */
  count: number;
  /** Latest less the first value in the window, when there are two. */
  change: number | null;
}

/** Summary of a series that lines up with the window's days; nulls are days without a value. */
export function seriesStats(values: (number | null)[]): SeriesStats {
  const present = values.flatMap((v, i) => (v === null || !Number.isFinite(v) ? [] : [{ v, i }]));
  if (!present.length) return { latest: null, latestIndex: null, mean: null, min: null, max: null, count: 0, change: null };
  const nums = present.map((p) => p.v);
  const last = present.at(-1)!;
  return {
    latest: last.v,
    latestIndex: last.i,
    mean: nums.reduce((a, b) => a + b, 0) / nums.length,
    min: Math.min(...nums),
    max: Math.max(...nums),
    count: nums.length,
    change: present.length > 1 ? last.v - present[0].v : null,
  };
}

/** Every day from `days - 1` days before `today` through today, oldest first. */
export function windowDays(today: string, days: number): string[] {
  return Array.from({ length: days }, (_, i) => addDays(today, i - (days - 1)));
}

/**
 * Where a window should start so a long range doesn't open on months of nothing: the first day any
 * series has a value, but never fewer than `minDays` days shown. Returns the index into the window.
 */
export function dataStart(series: (number | null)[][], minDays = 30): number {
  const length = Math.max(0, ...series.map((s) => s.length));
  const first = Math.min(...series.map((s) => s.findIndex((v) => v !== null)).filter((i) => i >= 0), length);
  if (first >= length) return Math.max(0, length - minDays);
  return Math.max(0, Math.min(first, length - minDays));
}

/** For each day, the best value on that day or the `window` days before it (a rolling best), or null. */
export function rollingBest(points: { day: string; value: number }[], days: string[], window: number): (number | null)[] {
  return days.map((day) => {
    const start = addDays(day, -(window - 1));
    let best: number | null = null;
    for (const p of points) if (p.day >= start && p.day <= day && (best === null || p.value > best)) best = p.value;
    return best;
  });
}

/** Change against a normal: a percentage for ratio measures (HRV), else the plain difference. */
export function againstNormal(value: number | null, normal: number | null, as: "percent" | "difference"): number | null {
  if (value === null || normal === null || normal === 0) return null;
  return as === "percent" ? Math.round((value / normal - 1) * 100) : value - normal;
}

/** How many scored mornings fell in each third of the recovery range (the same cut as `recoveryWord`). */
export function recoveryBands(scores: (number | null)[]): { recovered: number; normal: number; under: number } {
  const out = { recovered: 0, normal: 0, under: 0 };
  for (const s of scores) {
    if (s === null) continue;
    if (s >= 67) out.recovered++;
    else if (s >= 34) out.normal++;
    else out.under++;
  }
  return out;
}
