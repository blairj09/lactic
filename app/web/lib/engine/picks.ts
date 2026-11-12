// The coach's workout picks laid over the engine's plan. The engine decides each key day's zone,
// level and length; a pick only chooses the structure (templates.ts) and any targets set on it, or a
// fixed workout (the starter library or My workouts) that fits the day, with the coach's reason. A
// pick that no longer fits the day (the zone moved, or it isn't a key day) is left out and the
// engine's own structure stays. Days where the plan put one of the rider's favorites are never picked over.

import { buildSession } from "./library";
import type { Plan, PlanDay } from "./plan";
import { fitnessSeries } from "./pmc";
import { templateById, type Params } from "./templates";
import { fitsSlot, librarySession, workoutByKey } from "./workout-library";
import type { Workout } from "./workout";

export interface WorkoutPick {
  date: string;
  /** A structure id (templates.ts), or a fixed workout's key: `library:<id>` or `custom:<id>`. */
  template: string;
  tweaks?: Params;
  reason: string;
}

/** My workouts, for picks of them. */
export type Customs = readonly { id: string; workout: Workout }[];

/** A fixed workout's key rather than a structure id. */
export const isWorkoutKey = (id: string) => id.startsWith("library:") || id.startsWith("custom:");

/** Whether the plan put one of the rider's favorites (a fixed workout) on this day; the coach's picks leave it be. */
export const holdsFavorite = (day: PlanDay) => Boolean(day.session && !day.session.edited && (day.session.library || day.session.custom));

/** Whether a pick can go on this day: a key session in the structure's zone, or a fixed workout that fits its slot. */
export function pickFits(day: PlanDay | undefined, template: string, customs: Customs = []): boolean {
  if (!day || day.role !== "key" || !day.session) return false;
  if (isWorkoutKey(template)) {
    const w = workoutByKey(template, customs);
    return Boolean(w && fitsSlot(w, day.session.zone, day.session.level, day.session.duration));
  }
  const t = templateById(template);
  return Boolean(t && day.session.zone === t.zone);
}

/** Lays picks over key days from `today` on and redoes week stress and the forecast. The input isn't changed. */
export function applyPicks(plan: Plan, picks: WorkoutPick[], today: string, start: { fitness: number; fatigue: number }, customs: Customs = []): Plan {
  const byDate = new Map(picks.filter((p) => p.date >= today).map((p) => [p.date, p]));
  if (byDate.size === 0) return plan;
  let changed = false;
  const weeks = plan.weeks.map((week) => {
    const days = week.days.map((day): PlanDay => {
      const pick = byDate.get(day.date);
      if (!pick || holdsFavorite(day) || !pickFits(day, pick.template, customs)) return day;
      const s = day.session!;
      const fixed = isWorkoutKey(pick.template) ? workoutByKey(pick.template, customs) : null;
      const session = fixed ? librarySession(fixed) : buildSession(s.zone, s.level, s.duration, { template: pick.template, tweaks: pick.tweaks });
      changed = true;
      return { ...day, session, stress: session.stress, why: pick.reason, course: undefined };
    });
    return { ...week, days, stress: Math.round(days.reduce((s, d) => s + d.stress, 0)) };
  });
  if (!changed) return plan;
  const stress: Record<string, number> = {};
  for (const day of weeks.flatMap((w) => w.days)) if (day.date >= today) stress[day.date] = day.stress;
  const end = plan.forecast.length ? plan.forecast[plan.forecast.length - 1].date : today;
  const forecast = fitnessSeries(stress, today, end, { startingFitness: start.fitness, startingFatigue: start.fatigue });
  return { ...plan, weeks, forecast };
}

/** Key days from `from` through `through` that have no pick fitting them and no favorite on them: the coach has planning to do. */
export function unpickedKeyDays(plan: Plan, picks: WorkoutPick[], from: string, through: string, customs: Customs = []): PlanDay[] {
  const byDate = new Map(picks.map((p) => [p.date, p]));
  return plan.weeks
    .flatMap((w) => w.days)
    .filter((d) => d.date >= from && d.date <= through && d.role === "key" && d.session && !d.goal && !holdsFavorite(d))
    .filter((d) => {
      const pick = byDate.get(d.date);
      return !pick || !pickFits(d, pick.template, customs);
    });
}
