// Event and plan changes the coach can propose: add, change, move or remove an event, and start,
// change or end a saved plan. The coach only names the change; the engine checks it, rebuilds the
// plan from it and lists the days that would change, so the card shows what Apply does. Applying
// works it out again from fresh data.

import { addDays } from "../engine/pmc";
import {
  buildPlan,
  GOAL_KIND_LABELS,
  GOAL_KINDS,
  goalMinutes,
  INTENSITIES,
  INTENSITY_LABELS,
  overlappingPlans,
  PHASE_LABELS,
  PLAN_GOAL_LABELS,
  PLAN_GOALS,
  type Goal,
  type GoalKind,
  type Intensity,
  type Plan,
  type PlanDay,
  type PlanGoal,
  type Priority,
  type SavedPlan,
} from "../engine/plan";
import { applyOverrides, sameSession } from "../engine/overrides";
import { applyPicks } from "../engine/picks";
import type { TrainingState } from "../training";

/** An event's fields as the coach gives them; a change gives only what changes. */
export interface EventFields {
  name?: string;
  date?: string;
  priority?: Priority;
  kind?: GoalKind;
  minutes?: number | null;
  intensity?: Intensity | null;
  startTime?: string | null;
}

/** A saved plan's fields as the coach gives them; a change gives only what changes. */
export interface PlanFields {
  name?: string;
  start?: string;
  end?: string;
  goal?: PlanGoal;
  /** The event to peak for, when the goal is event. */
  eventId?: string | null;
  target?: number | null;
}

export type EventChange = { kind: "event"; action: "add" | "edit" | "remove"; id?: string; event?: EventFields };
export type SavedPlanChange = { kind: "plan"; action: "add" | "edit" | "end"; id?: string; plan?: PlanFields };

/** What the card shows besides the summary, all from the engine. */
export interface ProposalPreview {
  /** An event's settings, or what changes in them. */
  fields?: { label: string; value: string }[];
  /** Days whose session changes, before and after. */
  days?: { date: string; before: string; after: string; event?: boolean }[];
  /** A plan's weeks. */
  weeks?: { start: string; phase: string; hours: number; stress: number }[];
  stats?: { label: string; value: string }[];
}

export type EventEffect = {
  kind: "event";
  action: "add" | "edit" | "remove";
  goal: Goal;
  /** The event's date before the change, for an edit that moves it. */
  from?: string;
  /** Days changed through the coach that go back to the plan, so the run-in shows as planned. */
  reset: string[];
  summary: string;
  preview: ProposalPreview;
};

export type PlanEffect = {
  kind: "plan";
  action: "add" | "edit" | "end";
  plan: SavedPlan;
  /** For end: remove a plan that hasn't started, else end it yesterday. */
  remove?: boolean;
  summary: string;
  preview: ProposalPreview;
};

export type EventState = Pick<TrainingState, "today" | "plan" | "levels" | "goals" | "athlete" | "fitness" | "fatigue" | "activePlan" | "breaks"> &
  Partial<Pick<TrainingState, "favoriteWorkouts" | "customWorkouts" | "picks" | "changedDays" | "plans" | "todayStored">>;

const ISO = /^\d{4}-\d\d-\d\d$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
/** How far ahead an event can go. */
const MAX_EVENT_DAYS = 2 * 365;
/** Days before an event whose changes go back to the plan when it's added or moved: its run-in. */
const RUN_IN_DAYS = 7;
const MIN_PLAN_DAYS = 14;
const MAX_PLAN_DAYS = 52 * 7;
/** For a plan change, the days ahead whose changes are listed. */
const PLAN_DAYS_SHOWN = 14;
/** Days around an event whose changes are listed: its run-in and the recovery after. */
const around = (date: string): [string, string] => [addDays(date, -RUN_IN_DAYS), addDays(date, RUN_IN_DAYS)];
/** Changed days shown on a card, at most. */
const MAX_DAYS = 12;

const PRIORITY_NOTES: Record<Priority, string> = { A: "A, the plan peaks for it", B: "B, short taper", C: "C, ridden as training" };

/** The first day a change can still show on: tomorrow once today is ridden. */
const firstOpenDay = (state: EventState) => (state.todayStored?.activityId ? addDays(state.today, 1) : state.today);

export function resolveEventChange(state: EventState, change: EventChange): EventEffect {
  const today = firstOpenDay(state);
  if (change.action === "add") {
    const goal = checkEvent(state, { id: "new", ...change.event }, null);
    const goals = [...state.goals, goal];
    const reset = runIn(state, goal.date);
    const after = planAfter(state, { goals, reset });
    return {
      kind: "event",
      action: "add",
      goal,
      reset,
      summary: `Add ${goal.name}: ${label(goal.date)}`,
      preview: { fields: eventFields(goal), days: changedDays(state.plan, after, today, [around(goal.date)]), stats: raceForm(after, goal.date) },
    };
  }
  const old = state.goals.find((g) => g.id === change.id);
  if (!old) throw new Error(`There's no event "${change.id ?? ""}"; get ids from get_events`);
  if (old.date < state.today) throw new Error(`${old.name} is past; past events can't be changed`);
  if (change.action === "remove") {
    const peaks = (state.plans ?? []).find((p) => p.goal === "event" && p.goalId === old.id && p.end >= state.today);
    if (peaks) throw new Error(`${peaks.name} peaks for ${old.name}; end that plan first (propose_plan with action end)`);
    const after = planAfter(state, { goals: state.goals.filter((g) => g.id !== old.id), reset: [] });
    return {
      kind: "event",
      action: "remove",
      goal: old,
      reset: [],
      summary: `Remove ${old.name} (${label(old.date)})`,
      preview: { days: changedDays(state.plan, after, today, [around(old.date)]) },
    };
  }
  const goal = checkEvent(state, { ...old, ...defined(change.event ?? {}) }, old);
  const moved = goal.date !== old.date;
  const fields = editedFields(old, goal);
  if (!moved && fields.length === 0) throw new Error("That's how the event is already");
  const goals = state.goals.map((g) => (g.id === goal.id ? goal : g));
  const reset = moved ? runIn(state, goal.date) : [];
  const after = planAfter(state, { goals, reset });
  return {
    kind: "event",
    action: "edit",
    goal,
    from: moved ? old.date : undefined,
    reset,
    summary: moved ? `${goal.name}: ${label(old.date)} → ${label(goal.date)}` : `Change ${old.name}`,
    preview: { fields: fields.length ? fields : undefined, days: changedDays(state.plan, after, today, [around(goal.date), around(old.date)]), stats: raceForm(after, goal.date) },
  };
}

export function resolvePlanChange(state: EventState, change: SavedPlanChange): PlanEffect {
  const today = firstOpenDay(state);
  const plans = state.plans ?? [];
  if (change.action === "end") {
    const plan = plans.find((p) => p.id === change.id);
    if (!plan) throw new Error(`There's no plan "${change.id ?? ""}"; the saved plan's id is in get_plan`);
    if (plan.end < state.today) throw new Error(`${plan.name} is already over`);
    const remove = plan.start >= state.today;
    const after = planAfter(state, { frame: nextPlan(plans.filter((p) => p.id !== plan.id), state.today), reset: [] });
    return {
      kind: "plan",
      action: "end",
      plan,
      remove,
      summary: remove ? `Remove ${plan.name}` : `End ${plan.name} today`,
      preview: { days: changedDays(state.plan, after, today, [[today, addDays(today, PLAN_DAYS_SHOWN - 1)]]) },
    };
  }
  const old = change.action === "edit" ? plans.find((p) => p.id === change.id) : undefined;
  if (change.action === "edit" && !old) throw new Error(`There's no plan "${change.id ?? ""}"; the saved plan's id is in get_plan`);
  const plan = checkPlan(state, change.plan ?? {}, old ?? null);
  const after = planAfter(state, { frame: nextPlan([...plans.filter((p) => p.id !== plan.id), plan], state.today), reset: [] });
  const ofPlan = buildPlan({ ...planInput(state), frame: plan });
  const weeks = ofPlan.weeks
    .filter((w) => !w.beforePlan)
    .map((w) => ({
      start: w.start,
      phase: `${PHASE_LABELS[w.phase]}${w.recoveryWeek ? " (recovery)" : ""}`,
      hours: Math.round(w.days.reduce((t, d) => t + (d.session?.duration ?? 0), 0) / 360) / 10,
      stress: w.stress,
    }));
  const endDay = ofPlan.target ? ofPlan.forecast.find((d) => d.date === ofPlan.target!.date) : ofPlan.forecast.find((d) => d.date === plan.end);
  const stats = endDay
    ? [
        { label: ofPlan.target ? "Fitness on race day" : "Fitness at the end", value: `${Math.round(state.fitness)} → ${Math.round(endDay.fitness)}` },
        ...(ofPlan.target ? [{ label: "Form", value: signed(endDay.form) }] : []),
      ]
    : undefined;
  const dates = `${short(plan.start)} to ${short(plan.end)}`;
  return {
    kind: "plan",
    action: change.action,
    plan,
    summary: old ? `${plan.name}: ${short(old.start)} to ${short(old.end)} → ${dates}` : `New plan: ${plan.name}, ${dates}`,
    preview: { weeks, stats, days: old ? changedDays(state.plan, after, today, [[today, addDays(today, PLAN_DAYS_SHOWN - 1)]]) : undefined },
  };
}

/** Days changed through the coach in the run-in to an event on `date`, from today on. */
function runIn(state: EventState, date: string): string[] {
  const from = addDays(date, -RUN_IN_DAYS) < state.today ? state.today : addDays(date, -RUN_IN_DAYS);
  return (state.changedDays ?? []).filter((d) => d >= from && d <= date);
}

/** The plan as it would be with new events or a new plan frame: rebuilt, with the coach's picks and the day changes that stay. */
function planAfter(state: EventState, next: { goals?: Goal[]; frame?: SavedPlan | null; reset: string[] }): Plan {
  const start = { fitness: state.fitness, fatigue: state.fatigue };
  const goals = next.goals ?? state.goals;
  const built = buildPlan({ ...planInput(state), goals, frame: next.frame !== undefined ? next.frame : state.activePlan });
  const picked = applyPicks(built, state.picks ?? [], state.today, start, state.customWorkouts ?? []);
  const current = new Map(state.plan.weeks.flatMap((w) => w.days).map((d) => [d.date, d.session]));
  const keep = (state.changedDays ?? []).filter((d) => !next.reset.includes(d) && current.has(d));
  return applyOverrides(picked, keep.map((date) => ({ date, session: current.get(date) ?? null })), state.today, start);
}

function planInput(state: EventState) {
  return {
    today: state.today,
    goals: state.goals,
    frame: state.activePlan,
    breaks: state.breaks,
    availability: state.athlete.availability,
    fitness: state.fitness,
    fatigue: state.fatigue,
    levels: state.levels,
    rampRate: state.athlete.rampRate,
    favorites: state.favoriteWorkouts ?? [],
  };
}

/** The plan in force after a change to the saved plans: running now, else the next to start. */
function nextPlan(plans: SavedPlan[], today: string): SavedPlan | null {
  const sorted = [...plans].filter((p) => p.end >= today).sort((a, b) => a.start.localeCompare(b.start));
  return sorted.find((p) => p.start <= today) ?? sorted[0] ?? null;
}

/** Days from today on that differ between two plans, before and after. */
export function changedDays(before: Plan, after: Plan, today: string, windows: [string, string][]): ProposalPreview["days"] {
  const inWindow = (date: string) => windows.some(([a, b]) => date >= a && date <= b);
  const was = new Map(before.weeks.flatMap((w) => w.days).map((d) => [d.date, d]));
  const out: NonNullable<ProposalPreview["days"]> = [];
  for (const day of after.weeks.flatMap((w) => w.days)) {
    const old = was.get(day.date);
    if (day.date < today || !inWindow(day.date) || !old || sameDay(old, day)) continue;
    out.push({ date: day.date, before: dayText(old), after: dayText(day, true), event: day.role === "event" || undefined });
    if (out.length >= MAX_DAYS) break;
  }
  // An event's old day past the end of the rebuilt plan (a plan ends the week of its event).
  const planned = new Set(after.weeks.flatMap((w) => w.days.map((d) => d.date)));
  for (const old of was.values()) {
    if (old.date >= today && inWindow(old.date) && old.role === "event" && !planned.has(old.date)) out.push({ date: old.date, before: dayText(old), after: "Not planned yet" });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date)).slice(0, MAX_DAYS);
}

const sameDay = (a: PlanDay, b: PlanDay) => (a.role === "event" || b.role === "event" ? a.role === b.role && a.goal?.id === b.goal?.id && a.goal?.date === b.goal?.date : sameSession(a.session, b.session));

function dayText(day: PlanDay, full = false): string {
  if (day.role === "event" && day.goal) return full ? `${day.goal.name} · ${goalMinutes(day.goal)} min` : day.goal.name;
  if (!day.session) return "Rest";
  const name = day.session.workout.name;
  const minutes = Math.round(day.session.duration / 60);
  const withMinutes = /\bmin\b/.test(name) ? name : `${name} · ${minutes} min`;
  return full ? `${withMinutes} · ${Math.round(day.session.stress)} TSS` : withMinutes;
}

function raceForm(plan: Plan, date: string): ProposalPreview["stats"] {
  const day = plan.forecast.find((d) => d.date === date);
  return day ? [{ label: "Race-day form", value: signed(day.form) }] : undefined;
}

function checkEvent(state: EventState, e: EventFields & { id: string }, old: Goal | null): Goal {
  const name = String(e.name ?? "").trim();
  if (!name || name.length > 200) throw new Error("Give the event a name");
  const date = String(e.date ?? "");
  if (!ISO.test(date)) throw new Error(`Dates look like ${state.today}`);
  if (date < state.today) throw new Error("That date is past; events go on today or later");
  if (date > addDays(state.today, MAX_EVENT_DAYS)) throw new Error("Events can be up to two years ahead");
  const priority = (e.priority ?? "") as Priority;
  if (!["A", "B", "C"].includes(priority)) throw new Error("priority is A (peak), B (short taper) or C (train through)");
  const kind = (e.kind ?? "") as GoalKind;
  if (!GOAL_KINDS.includes(kind)) throw new Error(`kind is one of ${GOAL_KINDS.join(", ")}`);
  const minutes = e.minutes == null ? null : Math.round(Number(e.minutes));
  if (minutes !== null && !(minutes >= 10 && minutes <= 1440)) throw new Error("Event minutes should be between 10 and 1440");
  const intensity = e.intensity ?? null;
  if (intensity !== null && !INTENSITIES.includes(intensity)) throw new Error(`intensity is one of ${INTENSITIES.join(", ")}`);
  const startTime = e.startTime ?? null;
  if (startTime !== null && startTime !== "" && !TIME.test(startTime)) throw new Error("Start time looks like 10:45");
  return { ...(old ?? {}), id: e.id, name, date, priority, kind, minutes, intensity, startTime: startTime || null };
}

function checkPlan(state: EventState, p: PlanFields, old: SavedPlan | null): SavedPlan {
  const goal = (p.goal ?? old?.goal ?? "") as PlanGoal;
  if (!PLAN_GOALS.includes(goal)) throw new Error(`goal is one of ${PLAN_GOALS.join(", ")}`);
  const start = p.start ?? old?.start ?? state.today;
  if (!ISO.test(start)) throw new Error(`Dates look like ${state.today}`);
  if (!old && start < state.today) throw new Error("A new plan starts today or later");
  let end = p.end ?? old?.end ?? "";
  let goalId: string | null = null;
  const eventId = p.eventId !== undefined ? p.eventId : old?.goalId;
  if (goal === "event") {
    const event = state.goals.find((g) => g.id === eventId);
    if (!event) throw new Error("Give the event to peak for (event_id from get_events); add it first with propose_event if it's not there");
    goalId = event.id;
    end = event.date;
  }
  if (!ISO.test(end)) throw new Error("Give the plan's last day");
  const days = Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000) + 1;
  if (days < MIN_PLAN_DAYS) throw new Error(`A plan needs at least two weeks; this one is ${days} days`);
  if (days > MAX_PLAN_DAYS) throw new Error("A plan can run a year at most");
  if (end < state.today) throw new Error("That plan would already be over");
  const target = p.target !== undefined ? p.target : (old?.target ?? null);
  if (target !== null && !(goal === "ftp" || goal === "fitness")) throw new Error("A target is for ftp (watts) or fitness (CTL) plans");
  if (target !== null && !(target > 0 && target < 1000)) throw new Error("Target should be FTP watts or a fitness (CTL) number");
  const event = goalId ? state.goals.find((g) => g.id === goalId) : null;
  const name = String(p.name ?? "").trim().slice(0, 200) || old?.name || (event ? `Build to ${event.name}` : PLAN_GOAL_LABELS[goal]);
  const clash = overlappingPlans(state.plans ?? [], start, end, old?.id);
  if (clash.length) throw new Error(`That overlaps ${clash[0].name} (${short(clash[0].start)} to ${short(clash[0].end)}); change or end it first`);
  return { id: old?.id ?? "new", name, start, end, goal, goalId, target };
}

function eventFields(g: Goal): ProposalPreview["fields"] {
  return [
    { label: "Priority", value: PRIORITY_NOTES[g.priority] },
    { label: "Kind", value: [GOAL_KIND_LABELS[g.kind], `${goalMinutes(g)} min`, ...(g.intensity ? [intensityWord(g.intensity)] : [])].join(" · ") },
    ...(g.startTime ? [{ label: "Start", value: g.startTime }] : []),
  ];
}

function editedFields(a: Goal, b: Goal): NonNullable<ProposalPreview["fields"]> {
  const out: NonNullable<ProposalPreview["fields"]> = [];
  const add = (label: string, x: string, y: string) => x !== y && out.push({ label, value: x ? `${x} → ${y || "none"}` : y });
  add("Name", a.name, b.name);
  add("Priority", a.priority, b.priority);
  add("Kind", GOAL_KIND_LABELS[a.kind], GOAL_KIND_LABELS[b.kind]);
  if (goalMinutes(a) !== goalMinutes(b)) out.push({ label: "Duration", value: `${goalMinutes(a)} → ${goalMinutes(b)} min` });
  add("Effort", a.intensity ? intensityWord(a.intensity) : "", b.intensity ? intensityWord(b.intensity) : "");
  add("Start", a.startTime ?? "", b.startTime ?? "");
  return out;
}

const intensityWord = (i: Intensity) => INTENSITY_LABELS[i].split(":")[0];
const defined = <T extends object>(o: T): Partial<T> => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;
const signed = (n: number) => `${Math.round(n) > 0 ? "+" : ""}${Math.round(n)}`;
const label = (date: string) => new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
const short = (date: string) => new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
