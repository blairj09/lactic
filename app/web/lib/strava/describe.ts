// The words on a ride posted to Strava: the workout's name as the title, and a description that is
// just the workout's shape as a line of block bars (▂▅▅▂▅▅▇▃), signed by Lactic. Strava shows
// descriptions as plain text in a normal font and can't take images, so the bars stand in for a chart.
// It only draws the planned workout; it never computes a metric itself.
// No browser or Node APIs, so it runs and tests anywhere.

import type { RideInterval } from "../engine/ride-detail";
import type { Segment, Workout } from "../engine/workout";

export const LACTIC_SIGNATURE = "Trained with Lactic · lactic.fit";

/** Bars from easy to all out. */
const BARS = "▁▂▃▄▅▆▇█";
/** Share of FTP drawn as the lowest and the highest bar. */
const FLOOR = 0.4;
const CEILING = 1.2;
/** How wide the shape is, so it fits a phone line without wrapping. */
const WIDTH = 20;
/** Up to this many bars, every segment gets at least one, so short reps still show. */
const MAX_WIDTH = 24;
/** Free ride segments are drawn as easy riding. */
const FREE_RIDE = 0.5;

export interface PostedRide {
  name: string | null;
  durationSeconds: number;
  averagePower: number | null;
  normalizedPower: number | null;
  trainingStress: number | null;
  intensityFactor: number | null;
  averageHr: number | null;
  workout: Workout | null;
  intervals: RideInterval[] | null;
}

export function stravaTitle(ride: Pick<PostedRide, "name" | "workout">): string {
  const name = (ride.name || ride.workout?.name || "").trim();
  return (name || "Lactic ride").slice(0, 200);
}

const bar = (fraction: number) => BARS[Math.max(0, Math.min(BARS.length - 1, Math.round(((fraction - FLOOR) / (CEILING - FLOOR)) * (BARS.length - 1))))];

/** Target as a share of FTP, `at` (0 to 1) of the way through a segment. */
function targetAt(segment: Segment, at: number): number {
  switch (segment.kind) {
    case "steady":
      return segment.target;
    case "ramp":
      return segment.from + (segment.to - segment.from) * at;
    case "freeRide":
      return FREE_RIDE;
  }
}

/** The planned workout as one line of bars: each segment its share of the width (at least one bar while it fits), else even time slices. */
export function workoutShape(workout: Workout | null): string {
  const segments = workout?.segments.filter((s) => s.duration > 0) ?? [];
  const total = segments.reduce((sum, s) => sum + s.duration, 0);
  if (!total) return "";
  const widths = segments.map((s) => Math.max(1, Math.round((s.duration / total) * WIDTH)));
  if (widths.reduce((a, b) => a + b, 0) <= MAX_WIDTH) {
    return segments.map((s, i) => Array.from({ length: widths[i] }, (_, k) => bar(targetAt(s, (k + 0.5) / widths[i])))).flat().join("");
  }
  // Too many segments for one bar each: average the target over even slices of the clock.
  const at = (t: number) => {
    let start = 0;
    for (const s of segments) {
      if (t < start + s.duration) return targetAt(s, (t - start) / s.duration);
      start += s.duration;
    }
    return targetAt(segments[segments.length - 1], 1);
  };
  let line = "";
  for (let c = 0; c < WIDTH; c++) {
    const from = (c * total) / WIDTH;
    const to = ((c + 1) * total) / WIDTH;
    const steps = 12;
    let sum = 0;
    for (let k = 0; k < steps; k++) sum += at(from + ((k + 0.5) / steps) * (to - from));
    line += bar(sum / steps);
  }
  return line;
}

export function stravaDescription(ride: PostedRide): string {
  return [workoutShape(ride.workout), LACTIC_SIGNATURE].filter(Boolean).join("\n\n");
}
