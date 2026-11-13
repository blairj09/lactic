import { alignRamps, intervals, ramp, rampsJoined, steady, workoutDuration, type Segment, type Workout } from "./workout";

// Editing a workout's intervals: pure helpers for the Ride page's workout editor and for checking
// workouts saved to My workouts. Targets stay fractions of FTP.

export type SegmentKind = Segment["kind"];

/** Shortest and longest interval, in seconds. */
export const MIN_SEGMENT = 5;
export const MAX_SEGMENT = 4 * 3600;
/** Highest target, as a fraction of FTP. */
export const MAX_TARGET = 3;
export const MAX_SEGMENTS = 200;
export const MAX_WORKOUT = 8 * 3600;
export const MAX_NAME = 100;

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));
const cleanDuration = (seconds: number) => clamp(Math.round(seconds), MIN_SEGMENT, MAX_SEGMENT);
const cleanTarget = (fraction: number) => clamp(Math.round(fraction * 1000) / 1000, 0, MAX_TARGET);

/** A new workout to build from: a 10 minute warmup and a 5 minute cooldown. */
export function blankWorkout(name = "My workout"): Workout {
  return { name, segments: [ramp(600, 0.5, 0.75), ramp(300, 0.65, 0.45)] };
}

/** The same interval as another kind, keeping its length and roughly its effort. */
export function changeKind(segment: Segment, kind: SegmentKind): Segment {
  if (segment.kind === kind) return segment;
  const { duration } = segment;
  const level = segment.kind === "steady" ? segment.target : segment.kind === "ramp" ? (segment.from + segment.to) / 2 : 0.6;
  if (kind === "steady") return steady(duration, cleanTarget(level));
  if (kind === "ramp") return ramp(duration, cleanTarget(level * 0.85), cleanTarget(level * 1.15));
  return { kind: "freeRide", duration };
}

/** An interval with its numbers brought into range: whole seconds, sane targets. */
export function cleanSegment(segment: Segment): Segment {
  switch (segment.kind) {
    case "steady": {
      const clean = steady(cleanDuration(segment.duration), cleanTarget(segment.target));
      return segment.allOut === undefined ? clean : { ...clean, allOut: segment.allOut };
    }
    case "ramp":
      return ramp(cleanDuration(segment.duration), cleanTarget(segment.from), cleanTarget(segment.to));
    case "freeRide":
      return { kind: "freeRide", duration: cleanDuration(segment.duration) };
  }
}

const withSegments = (workout: Workout, segments: Segment[]): Workout => ({ ...workout, segments });

export function updateSegment(workout: Workout, index: number, segment: Segment): Workout {
  if (!workout.segments[index]) return workout;
  // A warm-up or cool-down that met the edited interval keeps meeting it.
  const joined = rampsJoined(workout.segments);
  const last = workout.segments.length - 1;
  const segments = workout.segments.map((s, i) => (i === index ? cleanSegment(segment) : s));
  return withSegments(workout, alignRamps(segments, { start: joined.start && index === 1, end: joined.end && index === last - 1 }));
}

/** Inserts intervals after `index` (-1 for the start). */
export function insertSegments(workout: Workout, index: number, added: Segment[]): Workout {
  const room = MAX_SEGMENTS - workout.segments.length;
  if (room <= 0) return workout;
  const at = clamp(index + 1, 0, workout.segments.length);
  return withSegments(workout, [...workout.segments.slice(0, at), ...added.slice(0, room).map(cleanSegment), ...workout.segments.slice(at)]);
}

export function removeSegment(workout: Workout, index: number): Workout {
  if (!workout.segments[index] || workout.segments.length <= 1) return workout;
  return withSegments(
    workout,
    workout.segments.filter((_, i) => i !== index),
  );
}

export function duplicateSegment(workout: Workout, index: number): Workout {
  const segment = workout.segments[index];
  return segment ? insertSegments(workout, index, [segment]) : workout;
}

/** Swaps an interval with its neighbour above (-1) or below (+1). */
export function moveSegment(workout: Workout, index: number, step: -1 | 1): Workout {
  const other = index + step;
  if (!workout.segments[index] || !workout.segments[other]) return workout;
  const segments = [...workout.segments];
  [segments[index], segments[other]] = [segments[other], segments[index]];
  return withSegments(workout, segments);
}

/** `count` repeats of a work interval and a recovery, as one block to insert. */
export function repeats(count: number, work: { duration: number; target: number }, rest: { duration: number; target: number }): Segment[] {
  const n = clamp(Math.round(count), 1, 50);
  return Array.from({ length: n }, () => [steady(work.duration, work.target), steady(rest.duration, rest.target)]).flat();
}

/**
 * Mid-ride, intervals already ridden and the one under way can't move or go, or the workout clock
 * would jump. The one under way can still change its target, and its length down to what's ridden.
 */
export function editable(workout: Workout, position: number, index: number): "done" | "current" | "free" {
  const interval = intervals(workout)[index];
  if (!interval || position <= 0) return "free";
  if (interval.end <= position) return "done";
  if (interval.start <= position) return "current";
  return "free";
}

/** The shortest the interval at `index` can be with `position` seconds of the workout ridden. */
export function minDuration(workout: Workout, position: number, index: number): number {
  const interval = intervals(workout)[index];
  if (!interval || interval.start >= position) return MIN_SEGMENT;
  return Math.max(MIN_SEGMENT, Math.ceil(position - interval.start) + MIN_SEGMENT);
}

/** Reads "6:30", "1:02:00", "90s", "5m" or a bare number of minutes into seconds; null if it isn't one. */
export function parseDuration(text: string): number | null {
  const t = text.trim().toLowerCase();
  if (!t) return null;
  if (/^\d+(\.\d+)?$/.test(t)) return Math.round(Number(t) * 60);
  const unit = t.match(/^(\d+(?:\.\d+)?)\s*(s|sec|m|min|h|hr)$/);
  if (unit) return Math.round(Number(unit[1]) * ({ s: 1, sec: 1, m: 60, min: 60, h: 3600, hr: 3600 } as Record<string, number>)[unit[2]]);
  const parts = t.split(":");
  if (parts.length < 2 || parts.length > 3 || parts.some((p) => !/^\d+$/.test(p))) return null;
  const [a, b, c] = parts.map(Number);
  if (parts.length === 2) return b < 60 ? a * 60 + b : null;
  return b < 60 && c < 60 ? a * 3600 + b * 60 + c : null;
}

const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** A workout from untrusted JSON (a saved workout, a server action's input), or null if it isn't one. */
export function readWorkout(raw: unknown): Workout | null {
  if (!raw || typeof raw !== "object") return null;
  const { name, segments } = raw as { name?: unknown; segments?: unknown };
  if (typeof name !== "string" || !Array.isArray(segments) || segments.length === 0 || segments.length > MAX_SEGMENTS) return null;
  const read: Segment[] = [];
  for (const s of segments as Record<string, unknown>[]) {
    if (!s || typeof s !== "object" || !finite(s.duration)) return null;
    if (s.kind === "steady" && finite(s.target))
      read.push(cleanSegment(typeof s.allOut === "boolean" ? { ...steady(s.duration, s.target), allOut: s.allOut } : steady(s.duration, s.target)));
    else if (s.kind === "ramp" && finite(s.from) && finite(s.to)) read.push(cleanSegment(ramp(s.duration, s.from, s.to)));
    else if (s.kind === "freeRide") read.push(cleanSegment({ kind: "freeRide", duration: s.duration }));
    else return null;
  }
  const workout = { name: name.trim().slice(0, MAX_NAME) || "My workout", segments: read };
  return workoutDuration(workout) <= MAX_WORKOUT ? workout : null;
}
