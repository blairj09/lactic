// Plan stability. The engine rebuilds the plan on every load from today's fitness and levels, which
// would quietly reshuffle the week as rides come in. Instead the week's skeleton (each day's role and
// session) is kept from when the week was first seen, and the rebuild is only compared with it: past
// DRIFT_LIMIT, the rider is offered a re-plan instead of a silent rewrite. Changing what the plan is
// built from (time, goals, breaks, the plan itself) re-plans the week straight away, since the rider
// asked for it.

import type { Plan, PlanDay, PlanWeek } from "./plan";
import { fitnessSeries } from "./pmc";
import { openerStyle } from "./library";
import { alignRamps, plannedStress, withOpeners } from "./workout";

/** The rebuilt week may move this share from the kept one, over the days left, before a re-plan is offered. */
export const DRIFT_LIMIT = 0.15;

/** A week's skeleton as it was kept. */
export interface KeptWeek {
  /** Monday. */
  week: string;
  days: PlanDay[];
  /** What the plan was built from when the week was kept (inputsKey); a change re-plans the week. */
  inputs: string;
}

export interface Drift {
  /** Rebuilt against kept, over the days from today on: +0.2 is 20% more stress. */
  share: number;
  kept: number;
  rebuilt: number;
}

/** A stable string of what the plan is built from, so a change to any of it is seen. */
export function inputsKey(inputs: unknown): string {
  return JSON.stringify(inputs);
}

/** How far the rebuilt week has moved from the kept one over the days from `today` on. Null when nothing's left to compare. */
export function weekDrift(kept: PlanDay[], rebuilt: PlanDay[], today: string): Drift | null {
  const sum = (days: PlanDay[]) => Math.round(days.filter((d) => d.date >= today).reduce((s, d) => s + d.stress, 0));
  const k = sum(kept);
  const r = sum(rebuilt);
  if (k <= 0) return r > 0 ? { share: 1, kept: k, rebuilt: r } : null;
  return { share: (r - k) / k, kept: k, rebuilt: r };
}

/** Whether a drift is big enough to offer a re-plan. */
export const driftOffer = (drift: Drift | null) => Boolean(drift && Math.abs(drift.share) > DRIFT_LIMIT);

/**
 * The plan with its first week's days put back to the kept skeleton (when `kept` is for that week),
 * week stress and the forecast redone. Later weeks stay as rebuilt: they're the forecast.
 */
export function keepWeek(plan: Plan, kept: KeptWeek | null, today: string, start: { fitness: number; fatigue: number }): Plan {
  const first = plan.weeks[0];
  if (!kept || !first || first.start !== kept.week || kept.days.length !== 7) return plan;
  // Kept from before warm-ups met the first interval or had openers: build them the same way now
  // (workout.ts). A rider's own saved workouts keep theirs.
  const days = kept.days.map((d) => {
    if (!d.session || !Array.isArray(d.session.workout?.segments)) return d;
    const style = d.session.custom ? null : openerStyle(d.session.zone);
    const opened = withOpeners(d.session.workout.segments, style);
    const workout = { ...d.session.workout, segments: alignRamps(opened) };
    if (opened === d.session.workout.segments) return { ...d, session: { ...d.session, workout } };
    const stress = plannedStress(workout);
    return { ...d, stress: d.stress + stress - d.session.stress, session: { ...d.session, workout, stress } };
  });
  const week: PlanWeek = { ...first, days, stress: Math.round(days.reduce((s, d) => s + d.stress, 0)) };
  const weeks = [week, ...plan.weeks.slice(1)];
  const stress: Record<string, number> = {};
  for (const day of weeks.flatMap((w) => w.days)) if (day.date >= today) stress[day.date] = day.stress;
  const end = plan.forecast.length ? plan.forecast[plan.forecast.length - 1].date : today;
  return { ...plan, weeks, forecast: fitnessSeries(stress, today, end, { startingFitness: start.fitness, startingFatigue: start.fatigue }) };
}
