// The words on a ride posted to Strava: the workout's name as the title, and a description of how
// it went (the work intervals against their targets, then the ride's totals), signed by Lactic.
// It only formats numbers the engine already worked out; it never computes a metric itself.
// No browser or Node APIs, so it runs and tests anywhere.

import type { RideInterval } from "../engine/ride-detail";
import type { Workout } from "../engine/workout";
import { formatDuration } from "../format";

/** A steady block at this share of FTP or more counts as a work interval. */
const WORK_FROM = 0.8;
/** Strava cuts descriptions off somewhere past this. */
const MAX_DESCRIPTION = 1800;
export const LACTIC_SIGNATURE = "Trained with Lactic, the open-source training platform · lactic.fit";

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

const minutes = (seconds: number) => (seconds % 60 === 0 && seconds >= 60 ? `${seconds / 60} min` : seconds < 60 ? `${seconds} s` : `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`);

/** "3 × 12 min at 265 W: 268, 266, 263 W", one line per run of matching work intervals. */
export function intervalLines(workout: Workout | null, intervals: RideInterval[] | null): string[] {
  if (!workout || !intervals?.length) return [];
  const work = intervals.filter((iv) => {
    const segment = workout.segments[iv.index];
    return segment?.kind === "steady" && !segment.hold && !segment.opener && segment.target >= WORK_FROM && iv.target !== null;
  });
  const groups: RideInterval[][] = [];
  for (const iv of work) {
    const last = groups.at(-1);
    if (last && last[0].planned === iv.planned && last[0].target === iv.target) last.push(iv);
    else groups.push([iv]);
  }
  return groups.map((g) => {
    const head = `${g.length > 1 ? `${g.length} × ` : ""}${minutes(g[0].planned)} at ${g[0].target} W`;
    const done = g.map((iv) => (iv.ridden === 0 ? "skipped" : iv.power === null ? "–" : `${iv.power}`));
    return `${head}: ${done.join(", ")}${done.some((d) => d !== "skipped" && d !== "–") ? " W" : ""}`;
  });
}

export function totalsLine(ride: PostedRide): string {
  const parts = [formatDuration(ride.durationSeconds)];
  if (ride.normalizedPower !== null) parts.push(`NP ${Math.round(ride.normalizedPower)} W`);
  else if (ride.averagePower !== null) parts.push(`Avg ${Math.round(ride.averagePower)} W`);
  if (ride.trainingStress !== null) parts.push(`TSS ${Math.round(ride.trainingStress)}`);
  if (ride.intensityFactor !== null) parts.push(`IF ${ride.intensityFactor.toFixed(2)}`);
  if (ride.averageHr !== null) parts.push(`Avg HR ${Math.round(ride.averageHr)}`);
  return parts.join(" · ");
}

export function stravaDescription(ride: PostedRide): string {
  const lines = intervalLines(ride.workout, ride.intervals);
  const blocks = [lines.join("\n"), totalsLine(ride), LACTIC_SIGNATURE].filter(Boolean);
  let text = blocks.join("\n\n");
  if (text.length > MAX_DESCRIPTION) {
    // Keep the totals and the signature; trim the interval list.
    const room = MAX_DESCRIPTION - totalsLine(ride).length - LACTIC_SIGNATURE.length - 6;
    text = [`${lines.join("\n").slice(0, room).replace(/\n[^\n]*$/, "")}\n…`, totalsLine(ride), LACTIC_SIGNATURE].join("\n\n");
  }
  return text;
}
