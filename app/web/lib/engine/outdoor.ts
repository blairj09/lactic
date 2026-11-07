// Workouts made for riding outside on a bike computer. On the road power is held by feel, through
// hills, wind and traffic, so each target becomes a range around it and ramps become short steps.

import { steady, type Segment, type Workout } from "./workout";

/** Half the width of an outdoor target range, as a fraction of FTP: 90% becomes 87-93%. */
export const OUTDOOR_RANGE = 0.03;
/** Longest step a ramp is split into, in seconds. */
export const RAMP_STEP = 120;

// The nudge keeps halves like 0.525 rounding up despite floating point.
const t2 = (fraction: number) => Math.round(fraction * 100 + 1e-9) / 100;

/** A ridden-outside day: the plan's session, or a workout chosen in its place. */
export interface OutdoorRide {
  date: string;
  workout: Workout | null;
}

/** Target range for a steady target, as fractions of FTP. */
export function outdoorRange(target: number): { low: number; high: number } {
  return { low: t2(Math.max(0, target - OUTDOOR_RANGE)), high: t2(target + OUTDOOR_RANGE) };
}

/** The same workout with each ramp as steps of RAMP_STEP or less, each at the ramp's mean target over it. */
export function outdoorWorkout(workout: Workout): Workout {
  const segments = workout.segments.flatMap((s): Segment[] => {
    if (s.kind !== "ramp" || s.duration <= 0) return [s];
    const count = Math.max(1, Math.ceil(s.duration / RAMP_STEP));
    return Array.from({ length: count }, (_, i) => {
      const mid = (i + 0.5) / count;
      return steady(s.duration / count, t2(s.from + (s.to - s.from) * mid));
    });
  });
  return { ...workout, segments };
}
