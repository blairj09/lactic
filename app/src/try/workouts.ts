// The workouts a visitor can ride on the try-a-ride page: six half-hour ones up front, and the whole
// library a tap away. All from the library, so the targets, levels and stress come from the engine
// like any other ride.

import { LIBRARY_CATEGORIES, LIBRARY_CATEGORY_LABELS, WORKOUT_LIBRARY, libraryWorkout, type LibraryCategory, type LibraryWorkout } from "@shared/engine/workout-library";

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

/** The library's categories that hold workouts, in the library's order. */
export const TRY_CATEGORIES: { value: LibraryCategory; label: string }[] = LIBRARY_CATEGORIES.filter((c) => WORKOUT_LIBRARY.some((w) => w.category === c)).map((c) => ({
  value: c,
  label: LIBRARY_CATEGORY_LABELS[c],
}));

/** Every library workout, or one category's, shortest first. */
export function catalogWorkouts(category: LibraryCategory | "all" = "all"): LibraryWorkout[] {
  const order = (w: LibraryWorkout) => LIBRARY_CATEGORIES.indexOf(w.category);
  return WORKOUT_LIBRARY.filter((w) => category === "all" || w.category === category).sort((a, b) => order(a) - order(b) || a.duration - b.duration);
}

/** True for one of the six half-hour workouts shown first. */
export const isShortTry = (id: string) => (TRY_WORKOUTS as readonly string[]).includes(id);

/** The label on a workout's card: the short list's own tag, else its category. */
export const tryTag = (w: LibraryWorkout) => (isShortTry(w.id) ? TRY_TAGS[w.id as keyof typeof TRY_TAGS] : LIBRARY_CATEGORY_LABELS[w.category]);

/** Starting FTP for a visitor who doesn't know theirs: a fair middle, easy to nudge mid-ride. */
export const DEFAULT_TRY_FTP = 200;

/** A typed FTP, or null when it's outside what a person can ride. */
export function readFtp(text: string): number | null {
  const n = Math.round(Number(text));
  return Number.isFinite(n) && n >= 50 && n <= 600 ? n : null;
}
