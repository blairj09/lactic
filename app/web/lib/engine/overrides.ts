// Changes to single days of the plan, made through the coach chat or on the Plan page: a different
// session on a day (picked from the engine's options, or a workout you edited), two days swapped, or a
// day put back. The plan is still rebuilt on each load; these are laid over it afterwards and the
// forecast is redone.

import { checkin, type OptionId } from "./checkin";
import { buildSession, INTERVAL_ZONES, type Levels, type Session, type Zone } from "./library";
import { plannedStress, workoutDuration, type Workout } from "./workout";
import type { DayRole, Plan, PlanDay } from "./plan";
import { fitnessSeries } from "./pmc";

export type DayOptionId = OptionId | "addEndurance" | "addRecovery";

export interface DayOption {
  id: DayOptionId;
  label: string;
  /** Null means rest. */
  session: Session | null;
}

/**
 * What a day could be instead: the check-in's options for its session (easier, harder, shorter,
 * swap to endurance, recovery, rest), or on a rest day, an endurance or recovery ride when you say
 * how long you have.
 */
export function dayOptions(planned: Session | null, levels: Levels, minutes?: number): DayOption[] {
  // Recovery, form and feel only change which option the check-in recommends, not the options.
  const options: DayOption[] = checkin({ planned, recovery: null, form: 0, fitness: 0, feel: 3, minutes }).options;
  if (planned) return options;
  const slot = (minutes ?? 60) * 60;
  return [
    { id: "addEndurance", label: `Endurance ride (${Math.round(slot / 60)} min)`, session: buildSession("endurance", levels.endurance, slot) },
    ...options.filter((o) => o.id !== "rest").map((o) => (o.id === "recovery" ? { ...o, id: "addRecovery" as const } : o)),
    { id: "rest", label: "Keep it a rest day", session: null },
  ];
}

/** A day the coach changed: the session to ride instead of the plan's (null for rest). */
export interface DayOverride {
  date: string;
  session: Session | null;
}

/**
 * Lays overrides over the plan's days from `today` on, then recomputes each week's stress and the
 * forecast. Event days are left alone. Returns a new plan; the input isn't changed.
 */
export function applyOverrides(plan: Plan, overrides: DayOverride[], today: string, start: { fitness: number; fatigue: number }): Plan {
  const byDate = new Map(overrides.filter((o) => o.date >= today).map((o) => [o.date, o.session]));
  if (byDate.size === 0) return plan;
  const weeks = plan.weeks.map((week) => {
    const days = week.days.map((day): PlanDay => {
      if (!byDate.has(day.date) || day.role === "event") return day;
      const session = byDate.get(day.date)!;
      if (sameSession(session, day.session)) return day;
      // The coach's reason was for the workout it picked, not this one.
      return { ...day, role: roleFor(session), session, stress: session?.stress ?? 0, why: undefined, rule: undefined, course: undefined };
    });
    return { ...week, days, stress: Math.round(days.reduce((s, d) => s + d.stress, 0)) };
  });
  const stress: Record<string, number> = {};
  for (const day of weeks.flatMap((w) => w.days)) if (day.date >= today) stress[day.date] = day.stress;
  const end = plan.forecast.length ? plan.forecast[plan.forecast.length - 1].date : today;
  const forecast = fitnessSeries(stress, today, end, { startingFitness: start.fitness, startingFatigue: start.fatigue });
  return { ...plan, weeks, forecast };
}

function roleFor(session: Session | null): DayRole {
  if (!session) return "rest";
  if (session.workout.name.startsWith("Openers")) return "openers";
  if (session.workout.name === "Ramp test") return "test";
  return INTERVAL_ZONES.includes(session.zone) ? "key" : session.duration >= 2.5 * 3600 ? "long" : "easy";
}

/** True when two sessions are the same workout, down to its intervals. */
export const sameSession = (a: Session | null, b: Session | null) =>
  a === b ||
  (a !== null &&
    b !== null &&
    a.workout.name === b.workout.name &&
    a.duration === b.duration &&
    a.zone === b.zone &&
    JSON.stringify(a.workout.segments) === JSON.stringify(b.workout.segments));

/** Zone bounds as fractions of FTP, for reading a zone off a workout you built. */
const ZONE_TOPS: [number, Zone][] = [
  [0.56, "recovery"],
  [0.76, "endurance"],
  [0.88, "tempo"],
  [0.95, "sweetSpot"],
  [1.06, "threshold"],
  [1.2, "vo2max"],
];
/** Efforts shorter than this don't set the zone (a sprint in an endurance ride). */
const ZONE_MIN_SECONDS = 30;

/** The zone of a workout's hardest effort held for 30 seconds or more; ramps count at their average. */
export function workoutZone(workout: Workout): Zone {
  let top = 0;
  for (const s of workout.segments) {
    if (s.duration < ZONE_MIN_SECONDS || s.kind === "freeRide") continue;
    top = Math.max(top, s.kind === "steady" ? s.target : (s.from + s.to) / 2);
  }
  return ZONE_TOPS.find(([limit]) => top < limit)?.[1] ?? "anaerobic";
}

/**
 * A workout you edited for a day, as a session: its own length and stress, the zone of its hardest
 * effort, and the day's level when the zone is the same (else your level in the new zone).
 */
export function editedSession(workout: Workout, base: Session | null, levels: Levels): Session {
  const zone = workoutZone(workout);
  return {
    zone,
    level: base && base.zone === zone ? base.level : Math.round(levels[zone] * 10) / 10,
    workout,
    duration: Math.round(workoutDuration(workout)),
    stress: Math.round(plannedStress(workout) * 10) / 10,
    edited: true,
  };
}
