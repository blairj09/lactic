// Sprints in a workout: ERG lets go so the target doesn't cap you, and the trainer rides like a
// road at a grade instead, so your gears give the resistance. Pure, so it tests in Node.

import { intervalAt, isAllOut, type Workout } from "../engine/workout";

/** Road grade for sprints until you change it: enough to push against in a big gear. */
export const SPRINT_GRADE = 3;
export const GRADE_MIN = -5;
export const GRADE_MAX = 15;

export function clampGrade(grade: number): number {
  if (!Number.isFinite(grade)) return 0;
  return Math.min(GRADE_MAX, Math.max(GRADE_MIN, Math.round(grade)));
}

/** Whether the workout is in a sprint at `position` seconds. */
export function allOutAt(workout: Workout, position: number): boolean {
  const interval = intervalAt(workout, position);
  return !!interval && isAllOut(interval.segment);
}

/** Whether the workout is in a free ride at `position` seconds: no target, the trainer rides like a road. */
export function freeRideAt(workout: Workout, position: number): boolean {
  return intervalAt(workout, position)?.segment.kind === "freeRide";
}
