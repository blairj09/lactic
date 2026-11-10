// What a ride page shows: its channels thinned for a chart, each interval's target against what was
// ridden, and the ride against the session planned for it.

import type { Resampled } from "./activity";
import { targetWattsAt, type Segment, type Workout } from "./workout";

/** Seconds per point in a stored chart stream. */
export const CHART_STEP = 5;

/** A ride's channels as stored for its page: means over `step` seconds, null when the channel is missing. */
export interface ChartStream {
  step: number;
  watts: number[] | null;
  heartRate: number[] | null;
  cadence: number[] | null;
  /** Target watts the app was holding; null points are free ride. Only on rides ridden here. */
  target: (number | null)[] | null;
  /** The GPS track, on rides outside. */
  route?: Route | null;
}

/** Thins 1 Hz channels to `step` second means. A channel that never reads above zero is left out. */
export function chartStream(
  channels: { watts?: number[]; heartRate?: number[]; cadence?: number[]; target?: (number | null)[] },
  step = CHART_STEP,
): ChartStream {
  const thin = (values: number[] | undefined, skipZeros: boolean) => {
    if (!values || !values.some((v) => v > 0)) return null;
    const out: number[] = [];
    for (let i = 0; i < values.length; i += step) {
      const chunk = values.slice(i, i + step).filter((v) => !skipZeros || v > 0);
      out.push(chunk.length ? Math.round(chunk.reduce((a, b) => a + b, 0) / chunk.length) : 0);
    }
    return out;
  };
  const target = channels.target;
  let thinTarget: (number | null)[] | null = null;
  if (target && target.some((v) => v !== null && v > 0)) {
    thinTarget = [];
    for (let i = 0; i < target.length; i += step) {
      const chunk = target.slice(i, i + step).filter((v): v is number => v !== null);
      thinTarget.push(chunk.length ? Math.round(chunk.reduce((a, b) => a + b, 0) / chunk.length) : null);
    }
  }
  return {
    step,
    watts: thin(channels.watts, false),
    // A dropped strap or a coast reads zero; leave those out of the mean.
    heartRate: thin(channels.heartRate, true),
    cadence: thin(channels.cadence, false),
    target: thinTarget,
  };
}

/** The chart stream of an imported ride. */
export const streamFromResampled = (stream: Resampled): ChartStream =>
  chartStream({ watts: stream.hasPower ? stream.watts : undefined, heartRate: stream.hasHeartRate ? stream.heartRate : undefined, cadence: stream.cadence });

/** One interval of the workout: what it asked for and what was ridden in it. */
export interface RideInterval {
  index: number;
  kind: Segment["kind"];
  /** Seconds in the workout. */
  planned: number;
  /** Seconds ridden in it: less when skipped or cut short, more when gone back to. */
  ridden: number;
  /** Mean target watts; null for free ride. */
  target: number | null;
  /** Means over the seconds ridden; null with no readings. */
  power: number | null;
  heartRate: number | null;
  cadence: number | null;
  /** Each stretch ridden in it as [first second, second after the last]. Missing on rides saved before laps. */
  spans?: [number, number][];
}

/**
 * Each interval of `workout` with the seconds ridden in it. `interval[i]` is the interval index the
 * workout was in at ride second i (-1 outside it), `target[i]` the watts asked for.
 */
export function rideIntervals(
  workout: Workout,
  perSecond: { interval: number[]; target: (number | null)[]; watts: number[]; heartRate: number[]; cadence: number[] },
): RideInterval[] {
  const mean = (values: number[]) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : null);
  return workout.segments.map((segment, index) => {
    const seconds = perSecond.interval.flatMap((at, i) => (at === index ? [i] : []));
    const targets = seconds.flatMap((i) => (perSecond.target[i] === null || perSecond.target[i] === undefined ? [] : [perSecond.target[i]!]));
    const pick = (values: number[], skipZeros: boolean) => seconds.map((i) => values[i] ?? 0).filter((v) => !skipZeros || v > 0);
    const round = (v: number | null) => (v === null ? null : Math.round(v));
    return {
      index,
      kind: segment.kind,
      planned: segment.duration,
      ridden: seconds.length,
      target: round(mean(targets)),
      power: seconds.length && perSecond.watts.some((w) => w > 0) ? round(mean(pick(perSecond.watts, false))) : null,
      heartRate: round(mean(pick(perSecond.heartRate, true))),
      cadence: seconds.length && perSecond.cadence.some((c) => c > 0) ? round(mean(pick(perSecond.cadence, false))) : null,
      spans: spansOf(seconds),
    };
  });
}

/** Runs of consecutive seconds as [first, last + 1]. */
function spansOf(seconds: number[]): [number, number][] {
  const spans: [number, number][] = [];
  for (const s of seconds) {
    const last = spans.at(-1);
    if (last && last[1] === s) last[1] = s + 1;
    else spans.push([s, s + 1]);
  }
  return spans;
}

/**
 * The ride seconds where a new lap starts, so each workout block is its own lap in an exported
 * file (Strava, intervals.icu and Garmin show them as laps). Time outside the workout, such as
 * riding on after it ends, gets a lap of its own. Rides saved before blocks kept their spans fall
 * back to the blocks' ridden seconds in order. Empty for rides without a workout.
 */
export function lapStarts(intervals: RideInterval[] | null | undefined): number[] {
  if (!intervals?.length) return [];
  const starts = new Set<number>();
  if (intervals.every((i) => Array.isArray(i.spans))) {
    for (const { spans } of intervals) for (const [from, to] of spans!) starts.add(from).add(to);
  } else {
    let at = 0;
    for (const { ridden } of intervals) {
      if (ridden <= 0) continue;
      starts.add(at);
      at += ridden;
      starts.add(at);
    }
  }
  // The last boundary is where the workout ended; a lap starts there only if the ride went on.
  return [...starts].filter((s) => s > 0).sort((a, b) => a - b);
}

export type TargetHit = "on" | "under" | "over";

/** Power against target with the Ride page's colours: within 5% is on target. */
export function targetHit(power: number, target: number): TargetHit {
  const ratio = target > 0 ? power / target : 1;
  return ratio < 0.95 ? "under" : ratio > 1.05 ? "over" : "on";
}

/** How much of a planned session was ridden: by stress when both have it, else by time. */
export function completion(planned: { duration: number; stress: number }, done: { durationSeconds: number; trainingStress: number | null }): number {
  if (planned.stress > 0 && done.trainingStress !== null) return done.trainingStress / planned.stress;
  return planned.duration > 0 ? done.durationSeconds / planned.duration : 0;
}

/** Ridden at least this share of the plan counts as done. */
export const DONE_SHARE = 0.8;

/** The plan's target watts at each point of a stream, lined up with the start of the ride. */
export function plannedTargets(workout: Workout, ftp: number, stream: ChartStream): (number | null)[] {
  const length = Math.max(stream.watts?.length ?? 0, stream.heartRate?.length ?? 0, stream.cadence?.length ?? 0);
  return Array.from({ length }, (_, i) => targetWattsAt(workout, i * stream.step + stream.step / 2, ftp));
}

/** Rides shorter than this (a sensor check, a spin to the shop) don't count as the day's ride. */
export const MIN_DAY_RIDE_SECONDS = 600;

/**
 * The day's ride to show: the one with the most stress (else the longest) of those at least
 * MIN_DAY_RIDE_SECONDS long (or the one `preferred` names, when you linked it to the day), with the others after it,
 * newest first. Null when there's none.
 */
export function dayRides<R extends { id: string; durationSeconds: number; trainingStress: number | null; startedAt: Date }>(
  rides: R[],
  preferred?: string | null,
): { main: R; others: R[] } | null {
  const counted = rides.filter((r) => r.durationSeconds >= MIN_DAY_RIDE_SECONDS || r.id === preferred);
  if (!counted.length) return null;
  const main = counted.find((r) => r.id === preferred) ?? counted.reduce((best, r) => {
    const a = r.trainingStress ?? -1;
    const b = best.trainingStress ?? -1;
    return a > b || (a === b && r.durationSeconds > best.durationSeconds) ? r : best;
  });
  const others = counted.filter((r) => r !== main).sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime());
  return { main, others };
}

/** Means over `every` points, so a small chart reads as a line rather than noise. Nulls are skipped; all-null chunks stay null. */
export function smooth(values: (number | null)[], every: number): (number | null)[] {
  const out: (number | null)[] = [];
  for (let i = 0; i < values.length; i += every) {
    const chunk = values.slice(i, i + every).filter((v): v is number => v !== null);
    out.push(chunk.length ? Math.round(chunk.reduce((a, b) => a + b, 0) / chunk.length) : null);
  }
  return out;
}

/** A ride's GPS track: [lat, lng, ride second] (on the same clock as the chart; older routes have no second). */
export type RoutePoint = [number, number] | [number, number, number];
export type Route = RoutePoint[];

/** Most points a stored route keeps: plenty for a map, a few tens of KB. */
export const MAX_ROUTE_POINTS = 2500;

/**
 * Thins a GPS track for the map: drops points closer than `minMeters` to the last one kept (stops,
 * slow climbs), then evenly to MAX_ROUTE_POINTS, at 5 decimals (about a metre). `t` is the ride
 * second of each point. Null when there's no real track, as on indoor rides.
 */
export function thinRoute(points: { lat?: number; lng?: number; t?: number }[], minMeters = 10): Route | null {
  const valid = points.filter(
    (p): p is { lat: number; lng: number; t?: number } =>
      p.lat !== undefined && p.lng !== undefined && Math.abs(p.lat) <= 90 && Math.abs(p.lng) <= 180 && !(p.lat === 0 && p.lng === 0),
  );
  const kept: typeof valid = [];
  for (const p of valid) {
    const last = kept[kept.length - 1];
    if (!last || metersBetween([last.lat, last.lng], [p.lat, p.lng]) >= minMeters) kept.push(p);
  }
  if (kept.length < 2) return null;
  const step = Math.max(1, kept.length / MAX_ROUTE_POINTS);
  const thinned: typeof valid = [];
  for (let i = 0; i < kept.length; i += step) thinned.push(kept[Math.floor(i)]);
  if (thinned[thinned.length - 1] !== kept[kept.length - 1]) thinned.push(kept[kept.length - 1]);
  const round = (v: number) => Math.round(v * 1e5) / 1e5;
  return thinned.map((p): RoutePoint => (p.t === undefined ? [round(p.lat), round(p.lng)] : [round(p.lat), round(p.lng), Math.round(p.t)]));
}

/** The route points ridden between two ride seconds; empty for a route without timing. */
export function routeBetween(route: Route, from: number, to: number): [number, number][] {
  return route.flatMap((p) => (p.length === 3 && p[2] >= from && p[2] <= to ? [[p[0], p[1]] as [number, number]] : []));
}

/**
 * Where the best `seconds` of power in a stream was: the start and end, in ride seconds, of the
 * highest-average window of a chart stream (means over `step` seconds, so close for short efforts).
 */
export function bestWindow(watts: number[], step: number, seconds: number): { from: number; to: number; watts: number } | null {
  const n = Math.max(1, Math.round(seconds / step));
  if (watts.length < n) return null;
  let sum = watts.slice(0, n).reduce((a, b) => a + b, 0);
  let best = sum;
  let at = 0;
  for (let i = n; i < watts.length; i++) {
    sum += watts[i] - watts[i - n];
    if (sum > best) {
      best = sum;
      at = i - n + 1;
    }
  }
  return { from: at * step, to: (at + n) * step, watts: Math.round(best / n) };
}

/** Distance along the ground, near enough for spacing points. */
function metersBetween([lat1, lng1]: [number, number], [lat2, lng2]: [number, number]): number {
  const toRad = Math.PI / 180;
  const x = (lng2 - lng1) * toRad * Math.cos(((lat1 + lat2) / 2) * toRad);
  const y = (lat2 - lat1) * toRad;
  return Math.sqrt(x * x + y * y) * 6_371_000;
}
