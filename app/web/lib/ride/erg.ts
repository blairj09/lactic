// Free ERG riding: no workout, just a target you move while riding. Pure, so it tests in Node.

import { steady, type Workout } from "../engine/workout";

export const ERG_MIN = 50;
export const ERG_MAX = 1000;
export const ERG_STEP = 5;

/** A target in watts, on the 5 W grid and inside what the trainer is asked for. */
export function clampErg(watts: number): number {
  if (!Number.isFinite(watts)) return ERG_MIN;
  return Math.min(ERG_MAX, Math.max(ERG_MIN, Math.round(watts / ERG_STEP) * ERG_STEP));
}

/** Where to start the slider: about endurance pace. */
export function defaultErg(ftp: number): number {
  return clampErg(ftp > 0 ? ftp * 0.6 : 150);
}

/** The target from a ride position (seconds) on. */
export interface ErgChange {
  at: number;
  watts: number;
}

/** Changes closer together than this are one change, so tapping + five times leaves one step. */
const MERGE_SECONDS = 3;

/** Adds a target change to the history. Before the ride starts it just replaces the opening target. */
export function addErgChange(changes: ErgChange[], at: number, watts: number): ErgChange[] {
  const target = clampErg(watts);
  const last = changes[changes.length - 1];
  if (!last) return [{ at: 0, watts: target }];
  if (last.watts === target) return changes;
  if (at - last.at < MERGE_SECONDS) {
    const rest = changes.slice(0, -1);
    // Back to where it was before: drop the step altogether.
    if (rest.length && rest[rest.length - 1].watts === target) return rest;
    return [...rest, { at: last.at, watts: target }];
  }
  return [...changes, { at, watts: target }];
}

/**
 * The ride so far as a workout, for the player's chart: each target held as a steady block, with
 * the current one drawn `ahead` seconds past the playhead.
 */
export function ergWorkout(changes: ErgChange[], position: number, ftp: number, ahead: number): Workout {
  const scale = ftp > 0 ? ftp : 250;
  const end = position + ahead;
  const segments = changes
    .map((c, i) => ({ c, until: Math.min(changes[i + 1]?.at ?? end, end) }))
    .filter(({ c, until }) => until > c.at)
    .map(({ c, until }) => steady(until - c.at, c.watts / scale));
  return { name: "Free ERG", segments };
}
