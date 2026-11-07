// Plan changes the coach can propose from the chat. The coach only names a change (a day and one of
// the engine's options for it, two days to swap, a day to put back, or new weekly hours); the engine
// works out the sessions and their effect. Nothing is written until you press Apply, and applying
// works the change out again from fresh data.

import { addDays } from "../engine/pmc";
import { BREAK_KIND_LABELS, BREAK_KINDS, BREAK_RIDING, BREAK_RIDING_LABELS, buildPlan, describeDay, type Availability, type Break, type Plan, type PlanDay } from "../engine/plan";
import { dayOptions, type DayOptionId } from "../engine/overrides";
import { buildSession, MAX_LEVEL, MIN_LEVEL, type Session } from "../engine/library";
import { checkTweaks, templateById, type Params } from "../engine/templates";
import type { TrainingState } from "../training";

/** How far ahead single days can be changed. */
export const CHANGE_WINDOW_DAYS = 27;

export type PlanChange =
  | { kind: "day"; date: string; option: DayOptionId; minutes?: number }
  /** A specific workout structure on a day, at a level and with any targets set directly (FTP fractions, seconds, counts). */
  | { kind: "workout"; date: string; template: string; level?: number; minutes?: number; tweaks?: Params }
  | { kind: "swap"; date: string; otherDate: string }
  | { kind: "reset"; date: string }
  | { kind: "availability"; availability?: Availability; rampRate?: number }
  | { kind: "break"; break: Omit<Break, "id"> };

export interface Proposal {
  change: PlanChange;
  /** The engine's description of the change, shown on the card. */
  summary: string;
  /** The coach's one-line reason. */
  reason: string;
  status: "pending" | "applied" | "dismissed";
}

/** What applying a change writes: the session for each day (null for rest, "reset" to go back to the plan), or settings. */
export type ChangeEffect =
  | { kind: "days"; days: { date: string; session: Session | null | "reset" }[]; summary: string }
  | { kind: "settings"; availability: Availability; rampRate: number; summary: string }
  | { kind: "break"; break: Omit<Break, "id">; summary: string };

type State = Pick<TrainingState, "today" | "plan" | "basePlan" | "levels" | "goals" | "athlete" | "fitness" | "fatigue" | "rides" | "activePlan" | "breaks">;

/** Works out a change against the current plan, or throws with a reason the coach can act on. */
export function resolveChange(state: State, change: PlanChange): ChangeEffect {
  switch (change.kind) {
    case "day": {
      const day = changeableDay(state, change.date);
      const minutes = checkMinutes(change.minutes);
      const option = dayOptions(day.session, state.levels, minutes).find((o) => o.id === change.option);
      if (!option) throw new Error(`"${change.option}" isn't one of the options for ${change.date}. Call get_day_options first.`);
      return { kind: "days", days: [{ date: day.date, session: option.session }], summary: `${label(day.date)}: ${describe(day.session)} → ${describe(option.session)}` };
    }
    case "workout": {
      const day = changeableDay(state, change.date);
      const template = templateById(change.template);
      if (!template) throw new Error(`There's no workout "${change.template}"; get ids from get_workouts`);
      const minutes = checkMinutes(change.minutes) ?? (day.session ? Math.round(day.session.duration / 60) : 60);
      const level = change.level ?? (day.session?.zone === template.zone ? day.session.level : state.levels[template.zone]);
      if (!(level >= MIN_LEVEL && level <= MAX_LEVEL)) throw new Error(`Level should be between ${MIN_LEVEL} and ${MAX_LEVEL}`);
      const tweaks = checkTweaks(template, change.tweaks ?? {});
      const session = buildSession(template.zone, level, minutes * 60, { template: template.id, tweaks });
      if (session.template !== template.id) throw new Error(`${template.name} doesn't fit in ${minutes} minutes with those targets; give it more minutes or shorter efforts`);
      return { kind: "days", days: [{ date: day.date, session }], summary: `${label(day.date)}: ${describe(day.session)} → ${describe(session)}` };
    }
    case "swap": {
      if (change.date === change.otherDate) throw new Error("Pick two different days to swap");
      const a = changeableDay(state, change.date);
      const b = changeableDay(state, change.otherDate);
      return {
        kind: "days",
        days: [
          { date: a.date, session: b.session },
          { date: b.date, session: a.session },
        ],
        summary: `Swap ${label(a.date)} (${describe(a.session)}) with ${label(b.date)} (${describe(b.session)})`,
      };
    }
    case "reset": {
      const day = changeableDay(state, change.date);
      const base = state.basePlan.weeks.flatMap((w) => w.days).find((d) => d.date === day.date);
      return { kind: "days", days: [{ date: day.date, session: "reset" }], summary: `${label(day.date)}: back to the plan's ${describe(base?.session ?? null)}` };
    }
    case "availability": {
      const availability = change.availability ?? state.athlete.availability;
      const rampRate = change.rampRate ?? state.athlete.rampRate;
      if (availability.length !== 7 || availability.some((m) => !Number.isFinite(m) || m < 0 || m > 480)) throw new Error("Give 7 values, Monday first, each 0 to 480 minutes");
      if (!(rampRate >= 2 && rampRate <= 10)) throw new Error("Ramp rate should be between 2 and 10");
      const rounded = availability.map((m) => Math.round(m / 15) * 15) as Availability;
      return { kind: "settings", availability: rounded, rampRate, summary: describeSettingsChange(state, rounded, rampRate) };
    }
    case "break": {
      const b = checkBreak(state, change.break);
      return { kind: "break", break: b, summary: describeBreak(state, b) };
    }
  }
}

/** A plan day from today through the change window that isn't an event. */
export function changeableDay(state: State, date: string): PlanDay {
  if (!/^\d{4}-\d\d-\d\d$/.test(date)) throw new Error(`Dates look like ${state.today}`);
  if (date < state.today) throw new Error("Past days can't be changed");
  if (date > addDays(state.today, CHANGE_WINDOW_DAYS)) throw new Error(`Only the next ${CHANGE_WINDOW_DAYS + 1} days can be changed one at a time; change weekly hours for longer-term changes`);
  const day = state.plan.weeks.flatMap((w) => w.days).find((d) => d.date === date);
  if (!day) throw new Error(`${date} isn't in the plan`);
  if (day.role === "event") throw new Error(`${date} is an event day; events are edited on the Plan page`);
  return day;
}

const MAX_BREAK_DAYS = 120;

function checkBreak(state: State, b: Omit<Break, "id">): Omit<Break, "id"> {
  const iso = /^\d{4}-\d\d-\d\d$/;
  if (!iso.test(b.start) || !iso.test(b.end)) throw new Error(`Dates look like ${state.today}`);
  if (b.end < state.today) throw new Error("That break is already over");
  if (b.end < b.start) throw new Error("The break ends before it starts");
  if (daysApart(b.start, b.end) >= MAX_BREAK_DAYS) throw new Error("A break can be four months at most");
  if (!BREAK_KINDS.includes(b.kind)) throw new Error(`kind is one of ${BREAK_KINDS.join(", ")}`);
  if (!BREAK_RIDING.includes(b.riding)) throw new Error(`riding is one of ${BREAK_RIDING.join(", ")}`);
  const minutes = b.riding === "limited" ? Math.round(Number(b.minutes)) : null;
  if (minutes !== null && !(minutes >= 0 && minutes <= 480)) throw new Error("For limited riding, give minutes a day, 0 to 480");
  const clash = state.breaks.find((x) => x.start <= b.end && b.start <= x.end);
  if (clash) throw new Error(`That overlaps a break already planned (${clash.start} to ${clash.end})`);
  return { start: b.start, end: b.end, kind: b.kind, riding: b.riding, minutes, note: String(b.note ?? "").slice(0, 500) };
}

/** The break and what it does to fitness at the plan's end or the target event. */
function describeBreak(state: State, b: Omit<Break, "id">): string {
  const rebuilt = buildPlan({
    today: state.today,
    goals: state.goals,
    frame: state.activePlan,
    breaks: [...state.breaks, { ...b, id: "new" }],
    availability: state.athlete.availability,
    fitness: state.fitness,
    fatigue: state.fatigue,
    levels: state.levels,
    rampRate: state.athlete.rampRate,
  });
  const peak = (plan: Plan) => {
    const day = plan.target ? plan.forecast.find((d) => d.date === plan.target!.date) : plan.forecast[plan.forecast.length - 1];
    return day ? Math.round(day.fitness) : null;
  };
  const riding = b.riding === "limited" ? `up to ${b.minutes} min a day` : BREAK_RIDING_LABELS[b.riding].toLowerCase();
  const parts = [`${BREAK_KIND_LABELS[b.kind]} break ${label(b.start)}${b.end !== b.start ? ` to ${label(b.end)}` : ""}, ${riding}`];
  const before = peak(state.basePlan);
  const after = peak(rebuilt);
  if (before !== null && after !== null) parts.push(`fitness ${rebuilt.target ? `on ${rebuilt.target.name} day` : "at the end of the plan"} ${before} → ${after}`);
  return parts.join("; ");
}

const daysApart = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

function checkMinutes(minutes: number | undefined): number | undefined {
  if (minutes === undefined) return undefined;
  if (!(minutes >= 20 && minutes <= 360)) throw new Error("Minutes should be between 20 and 360");
  return Math.round(minutes);
}

/** The engine's view of what new hours or ramp rate would do: weekly hours, load and fitness at the target. */
function describeSettingsChange(state: State, availability: Availability, rampRate: number): string {
  const rebuilt = buildPlan({
    today: state.today,
    goals: state.goals,
    frame: state.activePlan,
    breaks: state.breaks,
    availability,
    fitness: state.fitness,
    fatigue: state.fatigue,
    levels: state.levels,
    rampRate,
  });
  const hours = (a: Availability) => (a.reduce((x, y) => x + y, 0) / 60).toFixed(1);
  const load = (plan: Plan) => Math.round(average(plan.weeks.slice(0, 4).map((w) => w.stress)));
  const peak = (plan: Plan) => {
    const day = plan.target ? plan.forecast.find((d) => d.date === plan.target!.date) : plan.forecast[plan.forecast.length - 1];
    return day ? Math.round(day.fitness) : null;
  };
  const parts = [`Hours available ${hours(state.athlete.availability)} → ${hours(availability)} a week`];
  if (rampRate !== state.athlete.rampRate) parts.push(`ramp rate ${state.athlete.rampRate} → ${rampRate}`);
  parts.push(`next 4 weeks average ${load(state.basePlan)} → ${load(rebuilt)} TSS a week`);
  const before = peak(state.basePlan);
  const after = peak(rebuilt);
  if (before !== null && after !== null) parts.push(`fitness ${rebuilt.target ? `on ${rebuilt.target.name} day` : "at the end of the plan"} ${before} → ${after}`);
  return parts.join("; ");
}

const average = (values: number[]) => values.reduce((a, b) => a + b, 0) / Math.max(values.length, 1);

const describe = (session: Session | null) => (session ? describeDay({ date: "", role: "easy", session, stress: session.stress }) : "Rest");

const label = (date: string) =>
  new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
