// Today's options for the morning check-in, from the loaded training state. Kept apart from
// training.ts (which loads from the database) so the coach's tools can use it anywhere.

import { localDate } from "./engine/activity";
import { checkin, type CheckinResult, type Feel } from "./engine/checkin";
import { exertionTarget, MIN_COVERED_MINUTES } from "./engine/exertion";
import { exertionToday, trimpPerStress, type ExertionToday } from "./engine/recovery-glance";
import { addDays } from "./engine/pmc";
import { feedbackStrain } from "./engine/feedback";
import type { CheckinRecord, TrainingState } from "./training";
import type { Session } from "./engine/library";

/** How you feel today: what the check-in on Today asks. */
export type CheckinAnswers = Pick<CheckinRecord, "feel" | "sick" | "minutes">;

/**
 * Today's options (easier, harder, shorter, rest...) from recovery, form, recent rides and how you
 * feel: today's check-in, `answers` when given, or a normal day before you've checked in. Null when
 * today is already settled: a session chosen, already ridden, a race, riding outside, or no FTP yet.
 */
export function todayOptions(state: TrainingState, answers?: CheckinAnswers): CheckinResult | null {
  const { todayPlan, todayStored, today, athlete } = state;
  if (!athlete.ftp || todayStored?.chosen || todayPlan?.role === "event") return null;
  if (state.rides.some((r) => localDate(r.startedAt, athlete.timezone) === today)) return null;
  if (state.outdoor.some((o) => o.date === today && o.workout)) return null;
  const given = answers ?? todayStored?.checkin ?? null;
  const yesterday = state.exertion?.days.find((d) => d.day === addDays(today, -1));
  return checkin({
    planned: todayPlan?.session ?? null,
    recovery: state.recovery?.score?.score ?? null,
    form: state.form,
    fitness: state.fitness,
    feel: (given?.feel ?? 3) as Feel,
    sick: given?.sick ?? false,
    minutes: given?.minutes ?? undefined,
    offBikeTrimp: yesterday && yesterday.coveredMinutes >= MIN_COVERED_MINUTES ? yesterday.offBikeTrimp : undefined,
    signals: state.recovery?.glance.signals,
    feedback: feedbackStrain(state.feedback.map((f) => ({ date: f.day, difficulty: f.difficulty, rpe: f.rpe })), today),
  });
}

/**
 * Today's exertion so far against today's target, and where the session still to ride should leave
 * it: the session chosen this morning, else the plan's, or `instead` (one of today's options). Null without daytime heart rate or recovery.
 */
export function exertionTodayFor(state: TrainingState, instead?: { session: Session | null }): ExertionToday | null {
  const { today, athlete } = state;
  if (!state.exertion || !state.recovery) return null;
  const target = exertionTarget(state.recovery.score?.score ?? null, state.exertion.normal);
  const ridden = state.rides.some((r) => localDate(r.startedAt, athlete.timezone) === today);
  const session = instead ? instead.session : state.todayStored?.chosen ? state.todayStored.chosen.session : (state.todayPlan?.session ?? null);
  // How each past ride day's stress turned into exertion, from the days in the window.
  const stressByDay = new Map<string, number>();
  for (const r of state.rides) {
    const day = localDate(r.startedAt, athlete.timezone);
    if (day < today && r.trainingStress) stressByDay.set(day, (stressByDay.get(day) ?? 0) + r.trainingStress);
  }
  const ratio = trimpPerStress(state.exertion.days.filter((d) => stressByDay.has(d.day)).map((d) => ({ rideTrimp: d.rideTrimp, stress: stressByDay.get(d.day)! })));
  return exertionToday({
    today: state.exertion.days.find((d) => d.day === today) ?? null,
    target,
    plannedStress: ridden || !session ? null : session.stress,
    ratio,
  });
}
