// The iPhone's Live Activity for a ride (lock screen and Dynamic Island): what it shows, worded
// here from the ride player's data, for a ride on the phone or the computer's ride seen from the
// phone. Swift only lays it out (app/src-tauri/ios/widgets/RideActivity.swift). Countdowns are sent
// as moments (seconds since 1970) so iOS keeps them ticking between updates, even when the phone
// can't hear from the computer. Pure, so it tests in Node.

import { segmentRoles } from "../engine/segment-roles";
import { intervals, powerZone, segmentRange, type Interval, type Workout } from "../engine/workout";
import { describeTarget, formatTime } from "../format";
import type { RideTotals } from "./totals";

/** What the activity needs from the player (PlayerData has all of it). */
export interface LiveRide {
  workout: Workout;
  ftp: number;
  position: number;
  duration: number;
  current: Interval | null;
  upcoming: Interval[];
  intervalCount: number;
  targetWatts: number | null;
  powerAverage?: number;
  power?: number;
  heartRate?: number;
  cadence?: number;
  running: boolean;
  elapsed: number;
  erg: { watts: number } | null;
  allOut: boolean;
  finished: boolean;
  ended: boolean;
  totals: RideTotals;
}

export type LivePhase = "ready" | "riding" | "paused" | "done";

/** Matches `LacticRideAttributes.ContentState` in RideActivity.swift, field for field. */
export interface LiveActivityState {
  phase: LivePhase;
  /** The workout's name, or "Free ERG". */
  title: string;
  /** "On MacBook" for the computer's ride; null for the phone's own. */
  place: string | null;
  /** "Sweet spot 2", "Recovery"; null in free ERG. */
  interval: string | null;
  /** The interval's zone as the app's 1 to 7 color step; null for free ride. */
  step: number | null;
  /** "Interval 4 of 9"; null in free ERG. */
  counter: string | null;
  /** When the interval under way ends (riding), seconds since 1970. */
  intervalEnd: number | null;
  /** Seconds left in the interval, for a paused ride (no countdown). */
  intervalLeft: number;
  /** When the workout ends (riding), seconds since 1970; null in free ERG. */
  rideEnd: number | null;
  rideLeft: number;
  /** When the ride would have started had it never paused (riding), for free ERG's clock. */
  started: number | null;
  elapsed: number;
  /** "265 W", "150-210 W", "All out", "Free ride". */
  target: string | null;
  /** Watts over the last few seconds (or the latest), while riding. */
  power: number | null;
  heartRate: number | null;
  cadence: number | null;
  /** Power against the target: within 5% is on it. Null without a target or not riding. */
  tone: "on" | "under" | "over" | null;
  /** "Recovery 5:00 · 140 W"; null when nothing comes next. */
  next: string | null;
  /** The workout bar: each interval's share of the whole and its color step (0 = free ride). */
  bar: { share: number; step: number }[];
  /** How far through the workout, 0 to 1. */
  at: number;
  /** Ready: "Warm-up 10:00 · 150 W first". Done: "1:15:00 · 88 TSS". */
  note: string | null;
}

/** More intervals than this merge into blocks of the same color, so the bar stays drawable. */
const BAR_MAX = 48;

function stepOf(interval: Interval): number {
  const range = segmentRange(interval.segment);
  return range ? powerZone((range.low + range.high) / 2) : 0;
}

function workoutBar(workout: Workout): { share: number; step: number }[] {
  const all = intervals(workout);
  const total = all.reduce((t, i) => t + (i.end - i.start), 0);
  if (!total) return [];
  const bar: { share: number; step: number }[] = [];
  for (const i of all) {
    const share = (i.end - i.start) / total;
    const step = stepOf(i);
    const last = bar[bar.length - 1];
    if (last && last.step === step) last.share += share;
    else bar.push({ share, step });
  }
  // Still too many: fold the shortest into the one before until it fits.
  while (bar.length > BAR_MAX) {
    let k = 1;
    for (let j = 2; j < bar.length; j++) if (bar[j].share < bar[k].share) k = j;
    bar[k - 1].share += bar[k].share;
    bar.splice(k, 1);
  }
  return bar.map((b) => ({ share: Math.round(b.share * 10000) / 10000, step: b.step }));
}

const round = (n: number | undefined) => (n === undefined || !Number.isFinite(n) ? null : Math.round(n));

/**
 * The activity for this moment of the ride, or null when there's none to show (the ride ended).
 * `now` is in milliseconds; `place` says where the ride is when it isn't on this phone.
 */
export function liveActivity(ride: LiveRide | null, now: number, place: string | null = null): LiveActivityState | null {
  if (!ride || ride.ended) return null;
  const free = !!ride.erg;
  const roles = free ? [] : segmentRoles(ride.workout);
  const nowS = now / 1000;
  const phase: LivePhase = ride.finished ? "done" : ride.running ? "riding" : ride.elapsed === 0 ? "ready" : "paused";
  const riding = phase === "riding";
  const current = free ? null : ride.current;
  const intervalLeft = current ? Math.max(0, Math.round(current.end - ride.position)) : 0;
  const rideLeft = free ? 0 : Math.max(0, Math.round(ride.duration - ride.position));
  const target = free
    ? `${Math.round(ride.erg!.watts)} W`
    : ride.allOut
      ? "All out"
      : current
        ? ride.targetWatts !== null
          ? `${Math.round(ride.targetWatts)} W`
          : describeTarget(current, ride.ftp)
        : null;
  const power = riding ? round(ride.powerAverage ?? ride.power) : null;
  const goal = free ? ride.erg!.watts : ride.allOut ? null : ride.targetWatts;
  const tone = power === null || !goal ? null : power < goal * 0.95 ? "under" : power > goal * 1.05 ? "over" : "on";
  const next = free ? undefined : ride.upcoming[0];
  const first = free ? undefined : intervals(ride.workout)[0];
  const tss = ride.totals.tss;
  return {
    phase,
    title: free ? "Free ERG" : ride.workout.name,
    place,
    interval: current ? (roles[current.index] ?? null) : null,
    step: current ? stepOf(current) || null : null,
    counter: current && !free ? `Interval ${current.index + 1} of ${ride.intervalCount}` : null,
    intervalEnd: riding && current ? Math.round(nowS + intervalLeft) : null,
    intervalLeft,
    rideEnd: riding && !free ? Math.round(nowS + rideLeft) : null,
    rideLeft,
    started: riding ? Math.round(nowS - ride.elapsed) : null,
    elapsed: Math.round(ride.elapsed),
    target,
    power,
    heartRate: riding ? round(ride.heartRate) || null : null,
    cadence: riding ? round(ride.cadence) : null,
    tone,
    next: next ? `${roles[next.index] ?? "Next"} ${formatTime(next.end - next.start)} · ${describeTarget(next, ride.ftp)}` : null,
    bar: free ? [] : workoutBar(ride.workout),
    at: free || ride.duration <= 0 ? 0 : Math.min(1, Math.max(0, Math.round((ride.position / ride.duration) * 1000) / 1000)),
    note:
      phase === "done"
        ? `${formatTime(ride.elapsed)}${tss ? ` · ${Math.round(tss)} TSS` : ""}`
        : phase === "ready" && first
          ? `${roles[0] ?? "First"} ${formatTime(first.end - first.start)} · ${describeTarget(first, ride.ftp)} first`
          : null,
  };
}

/**
 * Numbers that change with every pedal stroke or second; the rest changes only when something
 * happens. (The seconds left only show while paused, when they stand still.)
 */
const LIVE_NUMBERS = ["power", "heartRate", "cadence", "tone", "intervalLeft", "rideLeft", "elapsed", "at"] as const;
/** Moments that drift by a second between updates without anything happening. */
const MOMENTS = ["intervalEnd", "rideEnd", "started"] as const;
/** Live numbers go out at most this often (ms); anything else goes straight away. */
export const NUMBERS_EVERY = 2000;

/**
 * Whether `next` is worth handing iOS, given what it was last handed at `lastAt` (ms): straight
 * away when the ride's shape changes (interval, phase, a countdown moved by more than 2 seconds),
 * at most every two seconds for new power, heart rate and cadence.
 */
export function worthSending(last: LiveActivityState | null, lastAt: number, next: LiveActivityState, now: number): boolean {
  if (!last) return true;
  const strip = (s: LiveActivityState) => {
    const copy: Record<string, unknown> = { ...s };
    for (const k of [...LIVE_NUMBERS, ...MOMENTS]) delete copy[k];
    return JSON.stringify(copy);
  };
  if (strip(last) !== strip(next)) return true;
  for (const k of MOMENTS) {
    const a = last[k];
    const b = next[k];
    if ((a === null) !== (b === null) || (a !== null && b !== null && Math.abs(a - b) > 2)) return true;
  }
  if (LIVE_NUMBERS.some((k) => last[k] !== next[k])) return now - lastAt >= NUMBERS_EVERY;
  return false;
}
