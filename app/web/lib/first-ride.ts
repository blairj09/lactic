// Day one: the rider just set Lactic up to ride, so a day with nothing planned offers a short,
// easy first ride instead of a rest day.

import { buildSession, type Session } from "./engine/library";
import type { TrainingState } from "./training";

export const FIRST_RIDE_MINUTES = 30;

/** Whether today is the plan's first day (or it hasn't started yet) and nothing has been ridden today. */
export function firstRideDay(state: TrainingState, rodeToday: boolean): boolean {
  const start = state.plan.frame?.start;
  return Boolean(start && state.today <= start && !rodeToday && !state.todayPlan?.session);
}

/** An easy 30 minutes of endurance: enough to try the trainer and the app. */
export function firstRideSession(state: Pick<TrainingState, "levels">): Session {
  return buildSession("endurance", Math.min(state.levels.endurance, 2), FIRST_RIDE_MINUTES * 60);
}
