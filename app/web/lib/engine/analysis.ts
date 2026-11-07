// Date ranges and what a range of rides adds up to: best power curve, power distribution and time in
// zones. Two ranges summarized the same way can be compared side by side.

import { addDays } from "./pmc";
import { mergeCurves, POWER_BIN_WATTS, sumHistograms, type PowerCurve } from "./power";
import { POWER_ZONE_LIMITS } from "./workout";

/** Calendar days as YYYY-MM-DD, both ends included. */
export interface DateRange {
  from: string;
  to: string;
}

/** What a ride contributes to a range. `date` is its local calendar day. */
export interface RangeRide {
  date: string;
  durationSeconds: number;
  /** FTP in effect on the ride's day, for time in zones. */
  ftp: number | null;
  powerCurve: PowerCurve | null;
  powerHistogram: number[] | null;
}

export const inRange = (date: string, range: DateRange) => date >= range.from && date <= range.to;

export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

export const rangeLength = (range: DateRange) => daysBetween(range.from, range.to) + 1;

export const RANGE_PRESETS = [
  { key: "4w", label: "4W", days: 28 },
  { key: "3m", label: "3M", days: 91 },
  { key: "6m", label: "6M", days: 182 },
  { key: "1y", label: "1Y", days: 365 },
  { key: "all", label: "All", days: null },
] as const;
export type RangePreset = (typeof RANGE_PRESETS)[number]["key"];

/** The last N days through `today`, or everything from `earliest` for "all". */
export function presetRange(key: RangePreset, today: string, earliest: string): DateRange {
  const preset = RANGE_PRESETS.find((p) => p.key === key)!;
  return { from: preset.days === null ? (earliest < today ? earliest : today) : addDays(today, 1 - preset.days), to: today };
}

/** The preset a range matches exactly, if any. */
export function matchingPreset(range: DateRange, today: string, earliest: string): RangePreset | null {
  return RANGE_PRESETS.find((p) => {
    const r = presetRange(p.key, today, earliest);
    return r.from === range.from && r.to === range.to;
  })?.key ?? null;
}

export type CompareMode = "previous" | "lastYear";

/** The range to compare against: the same length just before, or the same dates a year earlier. */
export function compareRange(range: DateRange, mode: CompareMode): DateRange {
  if (mode === "previous") {
    const length = rangeLength(range);
    return { from: addDays(range.from, -length), to: addDays(range.from, -1) };
  }
  return { from: yearEarlier(range.from), to: yearEarlier(range.to) };
}

function yearEarlier(date: string): string {
  const year = Number(date.slice(0, 4)) - 1;
  const monthDay = date.slice(5) === "02-29" ? "02-28" : date.slice(5);
  return `${year}-${monthDay}`;
}

/**
 * Zooms around the range's middle: a factor below 1 zooms in, above 1 out. The result stays inside
 * `bounds` and is at least `minDays` long.
 */
export function zoomRange(range: DateRange, factor: number, bounds: DateRange, minDays = 7): DateRange {
  const total = rangeLength(bounds);
  const length = Math.min(total, Math.max(minDays, Math.round(rangeLength(range) * factor)));
  const middle = addDays(range.from, Math.floor((rangeLength(range) - 1) / 2));
  let from = addDays(middle, -Math.floor((length - 1) / 2));
  if (from < bounds.from) from = bounds.from;
  let to = addDays(from, length - 1);
  if (to > bounds.to) {
    to = bounds.to;
    from = addDays(to, 1 - length);
  }
  return { from: from < bounds.from ? bounds.from : from, to };
}

/** Clamps a range to `bounds`, keeping its order. */
export function clampRange(range: DateRange, bounds: DateRange): DateRange {
  const clamp = (d: string) => (d < bounds.from ? bounds.from : d > bounds.to ? bounds.to : d);
  const [from, to] = [clamp(range.from), clamp(range.to)].sort();
  return { from, to };
}

export interface RangeSummary {
  range: DateRange;
  rides: number;
  /** Ride time in the range, with or without power. */
  seconds: number;
  /** Best average power per duration across the range's rides. */
  curve: PowerCurve;
  /** Seconds per POWER_BIN_WATTS bin, summed over the range. */
  histogram: number[];
  /** Seconds in Coggan zones 1 to 7, each ride against its own day's FTP. Rides without an FTP are left out. */
  zones: number[];
}

export function summarizeRange(rides: RangeRide[], range: DateRange): RangeSummary {
  const picked = rides.filter((r) => inRange(r.date, range));
  const zones = Array<number>(7).fill(0);
  for (const ride of picked) {
    if (!ride.powerHistogram || !ride.ftp) continue;
    const add = timeInZones(ride.powerHistogram, ride.ftp);
    for (let z = 0; z < 7; z++) zones[z] += add[z];
  }
  return {
    range,
    rides: picked.length,
    seconds: picked.reduce((sum, r) => sum + r.durationSeconds, 0),
    curve: mergeCurves(...picked.flatMap((r) => (r.powerCurve ? [r.powerCurve] : []))),
    histogram: sumHistograms(...picked.flatMap((r) => (r.powerHistogram ? [r.powerHistogram] : []))),
    zones,
  };
}

/**
 * Seconds in zones 1 to 7 from a histogram. A bin that straddles a zone boundary is split in
 * proportion to the watts on each side.
 */
export function timeInZones(histogram: number[], ftp: number, width = POWER_BIN_WATTS): number[] {
  const limits = POWER_ZONE_LIMITS.map((f) => f * ftp);
  const zones = Array<number>(7).fill(0);
  histogram.forEach((seconds, i) => {
    if (!seconds) return;
    const low = i * width;
    const high = low + width;
    let start = low;
    for (let z = 0; z < 7 && start < high; z++) {
      const end = z < 6 ? Math.min(high, Math.max(start, limits[z])) : high;
      zones[z] += (seconds * (end - start)) / width;
      start = end;
    }
  });
  return zones;
}

export interface DistributionBin {
  /** Watts at the bin's low edge; it covers [from, from + width). */
  from: number;
  seconds: number;
  /** Fraction of the counted time, so ranges of different lengths compare. */
  share: number;
}

/**
 * Time per `width`-watt bin (a multiple of the stored bin width). Coasting (under
 * POWER_BIN_WATTS) is left out unless asked for, since it swamps everything else.
 */
export function powerDistribution(histogram: number[], width: number, { includeCoasting = false } = {}): DistributionBin[] {
  const factor = Math.max(1, Math.round(width / POWER_BIN_WATTS));
  const step = factor * POWER_BIN_WATTS;
  const bins: DistributionBin[] = [];
  histogram.forEach((seconds, i) => {
    if (i === 0 && !includeCoasting) return;
    const b = Math.floor(i / factor);
    while (bins.length <= b) bins.push({ from: bins.length * step, seconds: 0, share: 0 });
    bins[b].seconds += seconds;
  });
  const total = bins.reduce((sum, b) => sum + b.seconds, 0);
  for (const b of bins) b.share = total ? b.seconds / total : 0;
  return bins;
}

/**
 * Keeps one ride per real ride (copies left out), filling a kept ride's missing power curve or
 * histogram from one of its copies: an app ride stored before histograms were kept can borrow its
 * Zwift file's.
 */
export function keepersWithCopyData<T extends { id: string; duplicateOf: string | null; powerCurve: PowerCurve | null; powerHistogram: number[] | null }>(
  rides: T[],
): T[] {
  const copies = new Map<string, T[]>();
  for (const r of rides) if (r.duplicateOf) copies.set(r.duplicateOf, [...(copies.get(r.duplicateOf) ?? []), r]);
  return rides
    .filter((r) => !r.duplicateOf)
    .map((r) => {
      const others = copies.get(r.id) ?? [];
      return {
        ...r,
        powerCurve: r.powerCurve ?? others.find((c) => c.powerCurve)?.powerCurve ?? null,
        powerHistogram: r.powerHistogram ?? others.find((c) => c.powerHistogram)?.powerHistogram ?? null,
      };
    });
}
