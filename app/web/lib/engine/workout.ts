// Structured indoor workouts. Targets are fractions of FTP (1.0 = FTP).

export type Segment =
  | {
      kind: "steady";
      duration: number;
      target: number;
      /**
       * Ridden all out: the player lets go of ERG for it and the trainer rides like a road, so a
       * sprint isn't capped at the target. Unset means all out only from ALL_OUT_FROM up.
       */
      allOut?: boolean;
      /** An ERG hold added at the end: the player's − and + move its watts, not the intensity. */
      hold?: boolean;
      /** A short effort in the warm-up to open the legs: part of the warm-up, not the workout's work. */
      opener?: boolean;
    }
  | { kind: "ramp"; duration: number; from: number; to: number }
  | { kind: "freeRide"; duration: number };

export interface Workout {
  name: string;
  segments: Segment[];
}

export type SteadySegment = Extract<Segment, { kind: "steady" }>;

export const steady = (duration: number, target: number): SteadySegment => ({ kind: "steady", duration, target });
/** A sprint: ridden all out, with `target` as the planned effort for charts and stress. */
export const sprint = (duration: number, target: number): SteadySegment => ({ kind: "steady", duration, target, allOut: true });
export const ramp = (duration: number, from: number, to: number): Segment => ({ kind: "ramp", duration, from, to });

/** A warm-up opener: `seconds` at `target`, part of the warm-up. */
export const opener = (duration: number, target: number): SteadySegment => ({ kind: "steady", duration, target, opener: true });

/** Which openers a warm-up gets: short, sharp ones before hard days, longer, gentler ones before tempo and sweet spot. */
export type OpenerStyle = "hard" | "steady";

/** The warm-up's length, with or without openers. */
export const WARMUP_SECONDS = 600;

const OPENERS: Record<OpenerStyle, { seconds: number; targets: number[] }> = {
  hard: { seconds: 20, targets: [1.1, 1.2, 1.3] },
  steady: { seconds: 30, targets: [0.9, 1.0, 1.1] },
};
const OPENER_EASY = 0.55;
const OPENER_RAMP = 360;

/**
 * A 10-minute warm-up: 6 minutes building from 45 to 70% FTP, then three openers, each a little
 * harder than the last, with easy riding between them and before the first interval.
 */
export function warmupWithOpeners(style: OpenerStyle): Segment[] {
  const { seconds, targets } = OPENERS[style];
  const out: Segment[] = [ramp(OPENER_RAMP, 0.45, 0.7)];
  targets.forEach((target, i) => {
    out.push(opener(seconds, target));
    if (i < targets.length - 1) out.push(steady(60 - seconds, OPENER_EASY));
  });
  const used = out.reduce((t, s) => t + s.duration, 0);
  out.push(steady(WARMUP_SECONDS - used, OPENER_EASY));
  return out;
}

/**
 * `segments` with their plain 10-minute warm-up ramp swapped for one with openers. Left alone
 * without a style, when the workout already has openers, or when it doesn't start with that ramp
 * (imported, edited and test workouts keep theirs).
 */
export function withOpeners(segments: Segment[], style: OpenerStyle | null): Segment[] {
  const first = segments[0];
  if (!style || !first || segments.some((s) => s.kind === "steady" && s.opener)) return segments;
  if (first.kind !== "ramp" || first.duration !== WARMUP_SECONDS || first.from > 0.5 || first.to <= first.from || first.to > RAMP_MEET_MAX) return segments;
  return [...warmupWithOpeners(style), ...segments.slice(1)];
}

/** Easy riding tops out here: a warm-up climbs to meet an interval this easy, and steps up into anything harder. */
export const RAMP_MEET_MAX = 0.8;

const startOf = (s: Segment) => (s.kind === "steady" ? s.target : s.kind === "ramp" ? s.from : null);
const endOf = (s: Segment) => (s.kind === "steady" ? s.target : s.kind === "ramp" ? s.to : null);

/**
 * The warm-up ramp ends at the power the next interval starts at, and the cool-down ramp starts at
 * the power the last interval ends at, so the profile has no step at either end. Only when that
 * neighbor is easy riding (up to RAMP_MEET_MAX) and on the ramp's side of its other end; a hard
 * first effort or sprint keeps the step up into it.
 */
export function alignRamps(segments: Segment[], ends: { start?: boolean; end?: boolean } = {}): Segment[] {
  if (segments.length < 2) return segments;
  const out = [...segments];
  const first = out[0];
  const next = out[1];
  const meet = startOf(next);
  if (ends.start !== false && first.kind === "ramp" && first.to > first.from && meet !== null && !isAllOut(next) && meet <= RAMP_MEET_MAX && meet > first.from)
    out[0] = { ...first, to: meet };
  const end = out.length - 1;
  const last = out[end];
  const prev = out[end - 1];
  const leave = endOf(prev);
  if (ends.end !== false && last.kind === "ramp" && last.from > last.to && leave !== null && !isAllOut(prev) && leave <= RAMP_MEET_MAX && leave > last.to)
    out[end] = { ...last, from: leave };
  return out;
}

/** Whether the warm-up ramp meets the first interval, and the cool-down ramp the last one. */
export function rampsJoined(segments: Segment[]): { start: boolean; end: boolean } {
  const n = segments.length;
  if (n < 2) return { start: false, end: false };
  const [first, next, prev, last] = [segments[0], segments[1], segments[n - 2], segments[n - 1]];
  return {
    start: first.kind === "ramp" && first.to === startOf(next),
    end: last.kind === "ramp" && last.from === endOf(prev),
  };
}

export function workoutDuration(workout: Workout): number {
  return workout.segments.reduce((total, s) => total + s.duration, 0);
}

function segmentTarget(segment: Segment, offset: number): number | null {
  switch (segment.kind) {
    case "steady":
      return segment.target;
    case "ramp":
      if (segment.duration <= 0) return segment.to;
      return segment.from + (segment.to - segment.from) * Math.min(Math.max(offset / segment.duration, 0), 1);
    case "freeRide":
      return null;
  }
}

/** Target as a fraction of FTP at `elapsed` seconds; null during free ride or after the end. */
export function targetAt(workout: Workout, elapsed: number): number | null {
  let start = 0;
  for (const segment of workout.segments) {
    if (elapsed < start + segment.duration) return segmentTarget(segment, elapsed - start);
    start += segment.duration;
  }
  return null;
}

export function targetWattsAt(workout: Workout, elapsed: number, ftp: number): number | null {
  const target = targetAt(workout, elapsed);
  return target === null ? null : Math.round(target * ftp);
}

/** Planned training stress if every target is hit exactly. Free ride counts as zero. */
export function plannedStress(workout: Workout): number {
  const seconds = Math.floor(workoutDuration(workout));
  if (seconds < 30) return 0;
  const samples = Array.from({ length: seconds }, (_, t) => targetAt(workout, t) ?? 0);
  let sum = 0;
  for (let i = 0; i < 30; i++) sum += samples[i];
  let fourth = (sum / 30) ** 4;
  for (let i = 30; i < samples.length; i++) {
    sum += samples[i] - samples[i - 30];
    fourth += (sum / 30) ** 4;
  }
  const np = (fourth / (samples.length - 29)) ** 0.25;
  return ((seconds * np * np) / 3600) * 100;
}

export interface Interval {
  index: number;
  start: number;
  end: number;
  segment: Segment;
}

/** Segments laid out on the workout clock. */
export function intervals(workout: Workout): Interval[] {
  let start = 0;
  return workout.segments.map((segment, index) => {
    const interval = { index, start, end: start + segment.duration, segment };
    start = interval.end;
    return interval;
  });
}

/** The interval running at `elapsed`, or null before the start or after the end. */
export function intervalAt(workout: Workout, elapsed: number): Interval | null {
  if (elapsed < 0) return null;
  return intervals(workout).find((i) => elapsed < i.end) ?? null;
}

/** Target range of a segment as fractions of FTP; null for free ride. */
export function segmentRange(segment: Segment): { low: number; high: number } | null {
  switch (segment.kind) {
    case "steady":
      return { low: segment.target, high: segment.target };
    case "ramp":
      return { low: Math.min(segment.from, segment.to), high: Math.max(segment.from, segment.to) };
    case "freeRide":
      return null;
  }
}

/** Steady targets from here up (2x FTP) are ridden all out unless marked otherwise: ERG can't hold a sprint. */
export const ALL_OUT_FROM = 2;

/** Whether the player should let go of ERG for this segment. */
export function isAllOut(segment: Segment): boolean {
  return segment.kind === "steady" && (segment.allOut ?? segment.target >= ALL_OUT_FROM);
}

/** Upper limits of Coggan power zones 1 to 6, as fractions of FTP. Zone 7 is everything above. */
export const POWER_ZONE_LIMITS = [0.55, 0.75, 0.9, 1.05, 1.2, 1.5];

/** Coggan power zone (1 to 7) for a target as a fraction of FTP. */
export function powerZone(fraction: number): number {
  const zone = POWER_ZONE_LIMITS.findIndex((limit) => fraction < limit);
  return zone === -1 ? 7 : zone + 1;
}

/** Same workout with every target scaled, as TrainerRoad's workout intensity does. */
export function scaleWorkout(workout: Workout, factor: number): Workout {
  return {
    ...workout,
    segments: workout.segments.map((s) => {
      switch (s.kind) {
        case "steady":
          return { ...s, target: s.target * factor };
        case "ramp":
          return { ...s, from: s.from * factor, to: s.to * factor };
        case "freeRide":
          return s;
      }
    }),
  };
}
