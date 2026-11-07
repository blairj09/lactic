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
