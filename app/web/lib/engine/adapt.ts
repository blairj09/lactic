// Missed key sessions, moved to a later day of the same week. The plan is rebuilt on every load, so this
// runs on every load too: a key session planned for a day before today with no ride counting for it
// goes to the best open day left this week, shortened when that day has less time. Rule-based, the same
// answer every time for the same rides.

import { buildSession, type Session } from "./library";
import { MIN_SESSION_MINUTES, type DayRole, type Plan, type PlanDay } from "./plan";
import { addDays, fitnessSeries } from "./pmc";

/** A key session shorter than this isn't worth moving: it would lose its main set. */
export const MIN_REFIT_MINUTES = 45;

/** Days that count as hard: a key day's neighbors can't be one, so no two hard days run back to back. */
const HARD: DayRole[] = ["key", "test", "event", "openers"];

export interface RefitInput {
  today: string;
  /** Days with a ride counting for them, through today. */
  ridden: Set<string>;
  /** Days the rider set themselves: a check-in choice or a changed day. Not moved from, and not moved onto. */
  decided: Set<string>;
  /** Minutes the rider has on a day, breaks applied, and whether it's outdoor only. */
  minutes: (date: string) => { minutes: number; easyOnly: boolean };
}

/**
 * Moves each key session missed this week (planned before today, no ride, not one the rider changed) to
 * the earliest open day left this week that takes it whole, else the open day with the most time,
 * shortened to fit. An open day is today or later, not ridden yet, an easy or rest day (never the long
 * ride), with at least MIN_REFIT_MINUTES, not outdoor only, with no hard day either side of it, and not
 * in the three days before an A or B event. A session with no open day stays missed. Returns the new
 * plan, with week stress and the forecast redone, and the moves, to store so they stay put as days pass.
 */
export function refitMissed(plan: Plan, input: RefitInput, start: { fitness: number; fatigue: number }): { plan: Plan; moves: Move[] } {
  const { today } = input;
  const none = { plan, moves: [] };
  const weekIndex = plan.weeks.findIndex((w) => w.start <= today && today <= addDays(w.start, 6));
  if (weekIndex < 0) return none;
  const days = plan.weeks[weekIndex].days.map((d) => ({ ...d }));
  const missed = days.filter((d) => d.date < today && d.role === "key" && d.session && !d.movedTo && !input.ridden.has(d.date) && !input.decided.has(d.date));
  if (!missed.length) return none;

  const at = (date: string) => days.find((d) => d.date === date);
  // Neighbors outside the week (last Sunday, next Monday) come from the plan as built.
  const all = new Map(plan.weeks.flatMap((w) => w.days).map((d) => [d.date, d]));
  const role = (date: string) => (at(date) ?? all.get(date))?.role;
  const hard = (date: string) => {
    const r = role(date);
    return r !== undefined && HARD.includes(r);
  };
  const priorityEvent = (date: string) => {
    const d = at(date) ?? all.get(date);
    return d?.role === "event" && d.goal && d.goal.priority !== "C";
  };

  const moves: Move[] = [];
  for (const from of missed) {
    const session = from.session!;
    // The missed day is no longer hard, so a day next to it can take a session.
    from.role = "rest";
    const open = days.filter((d) => {
      if (d.date < today || input.ridden.has(d.date) || input.decided.has(d.date)) return false;
      if (d.role !== "easy" && d.role !== "rest") return false;
      if (d.movedFrom) return false;
      const { minutes, easyOnly } = input.minutes(d.date);
      if (easyOnly || minutes < Math.max(MIN_REFIT_MINUTES, MIN_SESSION_MINUTES)) return false;
      if (hard(addDays(d.date, -1)) || hard(addDays(d.date, 1))) return false;
      return ![1, 2, 3].some((k) => priorityEvent(addDays(d.date, k)));
    });
    const fitsWhole = (d: PlanDay) => input.minutes(d.date).minutes * 60 >= session.duration;
    // A workout you built yourself can't be rebuilt shorter, so it only goes where it fits whole.
    const candidates = session.edited ? open.filter(fitsWhole) : open;
    if (!candidates.length) {
      from.role = "key";
      continue;
    }
    const to = candidates.find(fitsWhole) ?? candidates.reduce((best, d) => (input.minutes(d.date).minutes > input.minutes(best.date).minutes ? d : best));
    const shortened = !fitsWhole(to);
    const placed: Session = shortened ? refit(session, input.minutes(to.date).minutes * 60) : session;
    Object.assign(from, { role: "rest", session: null, stress: 0, why: undefined, movedTo: { date: to.date, session } });
    Object.assign(to, { role: "key", session: placed, stress: placed.stress, movedFrom: { date: from.date, shortened } });
    moves.push({ from: from.date, to: to.date, session: placed });
  }
  if (!moves.length) return none;
  const weeks = plan.weeks.map((w, i) => (i === weekIndex ? { ...w, days } : w));
  return { plan: finish({ ...plan, weeks }, today, start), moves };
}

/** A key session moved off a missed day: where it went, and the session as it goes there. */
export interface Move {
  from: string;
  to: string;
  /** Null once you made the day it went to a rest day. */
  session: Session | null;
}

/**
 * Lays moves made on earlier days (stored with the day they went to) over the rebuilt plan: the missed
 * day becomes rest with a note of where its session went, and the day it went to rides the moved
 * session. Moves whose days aren't in the plan are skipped.
 */
export function applyMoves(plan: Plan, moves: Move[], today: string, start: { fitness: number; fatigue: number }): Plan {
  if (!moves.length) return plan;
  let changed = false;
  const planned = new Map(plan.weeks.flatMap((w) => w.days).map((d) => [d.date, d.session]));
  const weeks = plan.weeks.map((week) => ({
    ...week,
    days: week.days.map((day): PlanDay => {
      const out = moves.find((m) => m.from === day.date);
      const into = moves.find((m) => m.to === day.date);
      if (!out && !into) return day;
      changed = true;
      let next = day;
      const was = out ? (day.session ?? out.session) : null;
      if (out && was && day.role !== "event") {
        next = { ...next, role: "rest", session: null, stress: 0, why: undefined, movedTo: { date: out.to, session: was } };
      }
      if (into?.session && next.role !== "event") {
        const original = planned.get(into.from);
        const shortened = Boolean(original && into.session.duration < original.duration);
        next = { ...next, role: "key", session: into.session, stress: into.session.stress, movedFrom: { date: into.from, shortened } };
      }
      return next;
    }),
  }));
  return changed ? finish({ ...plan, weeks }, today, start) : plan;
}

/** Week stress and the forecast redone after days changed. */
function finish(plan: Plan, today: string, start: { fitness: number; fatigue: number }): Plan {
  const weeks = plan.weeks.map((w) => ({ ...w, stress: Math.round(w.days.reduce((s, d) => s + d.stress, 0)) }));
  const stress: Record<string, number> = {};
  for (const day of weeks.flatMap((w) => w.days)) if (day.date >= today) stress[day.date] = day.stress;
  const end = plan.forecast.length ? plan.forecast[plan.forecast.length - 1].date : today;
  const forecast = fitnessSeries(stress, today, end, { startingFitness: start.fitness, startingFatigue: start.fatigue });
  return { ...plan, weeks, forecast };
}

/** The same session in a shorter slot: same zone, level and structure where it fits (buildSession steps the level down if not). */
function refit(session: Session, seconds: number): Session {
  return buildSession(session.zone, session.level, seconds, { template: session.template, tweaks: session.tweaks });
}
