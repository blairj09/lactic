// The half-hour workouts a visitor can ride on the try-a-ride page: all from the library, so the
// targets, levels and stress come from the engine like any other ride.

import { libraryWorkout, type LibraryWorkout } from "@shared/engine/workout-library";

export const TRY_WORKOUTS = ["recovery-30", "sweetspot-2x8", "threshold-3x5", "vo2-6x1", "sprints-8x10s", "test-ramp"] as const;

/** The label on each card: the zone it trains, or what the test is for. */
export const TRY_TAGS: Record<(typeof TRY_WORKOUTS)[number], string> = {
  "recovery-30": "Recovery",
  "sweetspot-2x8": "Sweet spot",
  "threshold-3x5": "Threshold",
  "vo2-6x1": "VO2 max",
  "sprints-8x10s": "Sprints",
  "test-ramp": "Find your FTP",
};

export const DEFAULT_TRY_WORKOUT = "sweetspot-2x8";

export function tryWorkouts(): LibraryWorkout[] {
  return TRY_WORKOUTS.map((id) => libraryWorkout(id)).filter((w): w is LibraryWorkout => w !== null);
}

/** Starting FTP for a visitor who doesn't know theirs: a fair middle, easy to nudge mid-ride. */
export const DEFAULT_TRY_FTP = 200;

/** A typed FTP, or null when it's outside what a person can ride. */
export function readFtp(text: string): number | null {
  const n = Math.round(Number(text));
  return Number.isFinite(n) && n >= 50 && n <= 600 ? n : null;
}
