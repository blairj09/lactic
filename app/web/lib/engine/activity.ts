// Turning a recorded ride into the numbers we store, and the bookkeeping across rides.

import { intensityFactor, normalizedPower, powerCurve, powerHistogram, trainingStress, type PowerCurve } from "./power";

/** One reading. `t` is seconds since the ride started; any channel may be missing. */
export interface StreamPoint {
  t: number;
  watts?: number;
  heartRate?: number;
  cadence?: number;
}

/** Channels on a regular 1 second grid, paused time removed. */
export interface Resampled {
  watts: number[];
  heartRate: number[];
  /** Kept for the ride's charts; zero where missing. */
  cadence?: number[];
  hasPower: boolean;
  hasHeartRate: boolean;
}

/**
 * Puts irregular readings (smart recording, dropouts) on a 1 Hz grid. Gaps up to `maxGapSeconds` hold
 * the previous reading; longer gaps are treated as a paused timer and dropped, so they add no time.
 */
export function resampleTo1Hz(points: StreamPoint[], maxGapSeconds = 10): Resampled {
  const sorted = points.filter((p) => Number.isFinite(p.t)).sort((a, b) => a.t - b.t);
  const watts: number[] = [];
  const heartRate: number[] = [];
  const cadence: number[] = [];
  let hasPower = false;
  let hasHeartRate = false;
  for (let i = 0; i < sorted.length; i++) {
    const p = sorted[i];
    const next = sorted[i + 1];
    const gap = next ? Math.round(next.t - p.t) : 1;
    // A reading counts for the seconds until the next one, unless the gap looks like a pause.
    const hold = gap <= 0 ? 0 : gap > maxGapSeconds ? 1 : gap;
    const w = validNumber(p.watts, 3000);
    const hr = validNumber(p.heartRate, 250);
    const rpm = validNumber(p.cadence, 250);
    if (w !== undefined) hasPower = true;
    if (hr !== undefined) hasHeartRate = true;
    for (let s = 0; s < hold; s++) {
      watts.push(w ?? 0);
      heartRate.push(hr ?? 0);
      cadence.push(rpm ?? 0);
    }
  }
  return { watts, heartRate, cadence, hasPower, hasHeartRate };
}

/**
 * Where each reading lands on the 1 Hz grid `resampleTo1Hz` builds (same gap rule), so other
 * channels of the same readings, like GPS, line up with the chart. Returned in the input's order.
 */
export function gridTimes(times: number[], maxGapSeconds = 10): number[] {
  const order = times.map((t, i) => [t, i] as const).filter(([t]) => Number.isFinite(t)).sort((a, b) => a[0] - b[0]);
  const out = times.map(() => 0);
  let at = 0;
  order.forEach(([t, i], k) => {
    out[i] = at;
    const next = order[k + 1];
    const gap = next ? Math.round(next[0] - t) : 1;
    at += gap <= 0 ? 0 : gap > maxGapSeconds ? 1 : gap;
  });
  return out;
}

function validNumber(value: number | undefined, max: number): number | undefined {
  return value !== undefined && Number.isFinite(value) && value >= 0 && value <= max ? value : undefined;
}

/** Ride numbers that don't depend on FTP, so they can be computed wherever the file is read. */
export interface RideSummary {
  durationSeconds: number;
  averagePower: number | null;
  normalizedPower: number | null;
  averageHeartRate: number | null;
  powerCurve: PowerCurve | null;
  /** Seconds per 10 W bin (see `powerHistogram`). */
  powerHistogram: number[] | null;
}

export function summarizeRide(stream: Resampled): RideSummary {
  const nonZeroHr = stream.heartRate.filter((h) => h > 0);
  return {
    durationSeconds: stream.watts.length,
    averagePower: stream.hasPower && stream.watts.length ? mean(stream.watts) : null,
    normalizedPower: stream.hasPower ? normalizedPower(stream.watts) : null,
    averageHeartRate: stream.hasHeartRate && nonZeroHr.length ? mean(nonZeroHr) : null,
    powerCurve: stream.hasPower ? powerCurve(stream.watts) : null,
    powerHistogram: stream.hasPower ? powerHistogram(stream.watts) : null,
  };
}

export interface StressResult {
  trainingStress: number;
  intensityFactor: number;
  method: "power" | "heartRate";
}

/**
 * Training stress for a ride. Power-based when there is power; otherwise heart-rate based
 * (hours x (average HR / threshold HR)^2 x 100), which is rougher but keeps HR-only rides in the
 * fitness chart instead of counting as rest days.
 */
export function rideStressFromSummary(
  summary: Pick<RideSummary, "durationSeconds" | "normalizedPower" | "averageHeartRate">,
  ftp: number | null,
  thresholdHeartRate: number | null,
): StressResult | null {
  if (summary.normalizedPower !== null && ftp && ftp > 0) {
    return {
      trainingStress: trainingStress(summary.durationSeconds, summary.normalizedPower, ftp),
      intensityFactor: intensityFactor(summary.normalizedPower, ftp),
      method: "power",
    };
  }
  if (summary.averageHeartRate !== null && thresholdHeartRate && thresholdHeartRate > 0) {
    const factor = summary.averageHeartRate / thresholdHeartRate;
    return { trainingStress: (summary.durationSeconds / 3600) * factor * factor * 100, intensityFactor: factor, method: "heartRate" };
  }
  return null;
}

export interface FtpChange {
  /** YYYY-MM-DD the value applies from. */
  effectiveDate: string;
  watts: number;
  /** Where it came from: rampTest, manual, criticalPower or twentyMinute (an estimate from rides), synced. */
  method?: string;
}

/** The FTP in effect on `date` (YYYY-MM-DD): the latest change on or before it, else the earliest known. */
export function ftpOn(date: string, history: FtpChange[], fallback: number | null = null): number | null {
  const sorted = [...history].sort((a, b) => a.effectiveDate.localeCompare(b.effectiveDate));
  let current: number | null = null;
  for (const change of sorted) {
    if (change.effectiveDate <= date) current = change.watts;
  }
  return current ?? sorted[0]?.watts ?? fallback;
}

/** Calendar day (YYYY-MM-DD) of an instant in the given IANA time zone. */
export function localDate(instant: Date, timeZone: string): string {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(instant);
}

/** Sums each day's training stress, by local calendar day, for the fitness chart. */
export function dailyStress(rides: { startedAt: Date; trainingStress: number | null }[], timeZone: string): Record<string, number> {
  const days: Record<string, number> = {};
  for (const ride of rides) {
    if (!ride.trainingStress) continue;
    const day = localDate(ride.startedAt, timeZone);
    days[day] = (days[day] ?? 0) + ride.trainingStress;
  }
  return days;
}

/** Where a ride came from, most trusted first. A ride recorded by this app wins over Zwift's or Strava's copy. */
export const SOURCE_PRIORITY = ["app", "karoo_fit", "fit", "zwift_fit", "strava"] as const;
export type ActivitySource = (typeof SOURCE_PRIORITY)[number];

export interface RideWindow {
  id: string;
  source: ActivitySource;
  startedAt: Date;
  durationSeconds: number;
}

/** True when two rides overlap for at least `minimumOverlap` of the shorter one. */
export function sameRide(a: RideWindow, b: RideWindow, minimumOverlap = 0.8): boolean {
  const aStart = a.startedAt.getTime();
  const bStart = b.startedAt.getTime();
  const aEnd = aStart + a.durationSeconds * 1000;
  const bEnd = bStart + b.durationSeconds * 1000;
  const shorter = Math.min(aEnd - aStart, bEnd - bStart);
  return shorter > 0 && (Math.min(aEnd, bEnd) - Math.max(aStart, bStart)) / shorter >= minimumOverlap;
}

/**
 * Sorts out copies of the same ride. Riding ERG here with Zwift open produces two (this app's and
 * Zwift's Strava upload), as does a Karoo ride that also syncs to Strava. Rides are taken most
 * trusted source first, then earliest; each one is either kept or marked a copy of a kept ride it
 * overlaps. Returns ride id -> id of the kept ride (null when the ride is the one kept).
 */
export function assignCopies(rides: RideWindow[]): Map<string, string | null> {
  const ordered = [...rides].sort((a, b) => rank(a.source) - rank(b.source) || a.startedAt.getTime() - b.startedAt.getTime());
  const kept: RideWindow[] = [];
  const result = new Map<string, string | null>();
  for (const ride of ordered) {
    const original = kept.find((k) => sameRide(k, ride));
    if (original) result.set(ride.id, original.id);
    else {
      kept.push(ride);
      result.set(ride.id, null);
    }
  }
  return result;
}

const rank = (source: ActivitySource) => SOURCE_PRIORITY.indexOf(source);
const mean = (values: number[]) => values.reduce((a, b) => a + b, 0) / values.length;
