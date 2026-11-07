// Today's options for the morning check-in, from the loaded training state. Kept apart from
// training.ts (which loads from the database) so the coach's tools can use it anywhere.

import { localDate } from "./engine/activity";
import { checkin, type CheckinResult, type Feel } from "./engine/checkin";
import { MIN_COVERED_MINUTES } from "./engine/exertion";
import { addDays } from "./engine/pmc";
import { feedbackStrain } from "./engine/feedback";
import type { CheckinRecord, TrainingState } from "./training";

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
    feedback: feedbackStrain(state.feedback.map((f) => ({ date: f.day, difficulty: f.difficulty, rpe: f.rpe })), today),
  });
}
