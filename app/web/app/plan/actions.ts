"use server";

import { revalidatePath } from "next/cache";
import { FEEL_LABELS, type Feel, type OptionId } from "@/lib/engine/checkin";
import { addDays } from "@/lib/engine/pmc";
import {
  BREAK_KIND_LABELS,
  BREAK_KINDS,
  BREAK_RIDING,
  buildPlan,
  GOAL_KINDS,
  INTENSITIES,
  overlappingPlans,
  PLAN_GOAL_LABELS,
  PLAN_GOALS,
  weekStart,
  type Availability,
  type BreakKind,
  type BreakRiding,
  type GoalKind,
  type Intensity,
  type Phase,
  type PlanGoal,
  type Priority,
  type SavedPlan,
} from "@/lib/engine/plan";
import { planAhead, recordCheckin, recordChoice } from "@/lib/coach/conversation";
import { changeableDay } from "@/lib/coach/changes";
import { localDate } from "@/lib/engine/activity";
import { editedSession } from "@/lib/engine/overrides";
import { readWorkout } from "@/lib/engine/workout-edit";
import { pushChangedPlan, writeDays } from "@/lib/plan-changes";
import { loadTrainingState, saveKeptWeek, type CheckinRecord, type TrainingState } from "@/lib/training";
import { todayOptions } from "@/lib/today-options";
import { createClient } from "@/lib/supabase/server";
import type { ActionResult } from "../actions";

async function attempt(work: () => Promise<string>): Promise<ActionResult> {
  try {
    const message = await work();
    revalidatePath("/", "layout");
    return { ok: true, message };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}

/** Takes this week's rebuilt plan in place of the one kept when the week began (stability.ts): the Re-plan chip. */
export async function replanWeek(): Promise<ActionResult> {
  return attempt(async () => {
    const supabase = await createClient();
    const state = await loadTrainingState(supabase);
    if (!state.rebuiltWeek) throw new Error("Nothing to re-plan this week.");
    await saveKeptWeek(supabase, state.athlete.userId, { week: weekStart(state.today), days: state.rebuiltWeek, inputs: state.planInputs });
    const pushed = await pushChangedPlan(supabase);
    return `This week is re-planned from your fitness today.${pushed}`;
  });
}

/** Adds an event, or updates one when the form carries its id. */
export async function saveGoal(_: ActionResult | null, form: FormData): Promise<ActionResult> {
  return attempt(async () => {
    const id = String(form.get("id") ?? "");
    const name = String(form.get("name") ?? "").trim();
    const date = String(form.get("date") ?? "");
    const priority = String(form.get("priority") ?? "") as Priority;
    const kind = String(form.get("kind") ?? "") as GoalKind;
    if (!name || name.length > 200) throw new Error("Give the event a name");
    if (!/^20\d\d-\d\d-\d\d$/.test(date)) throw new Error("Pick the event date");
    if (!["A", "B", "C"].includes(priority)) throw new Error("Pick a priority");
    if (!GOAL_KINDS.includes(kind)) throw new Error("Pick the kind of event");
    const minutes = Math.round(Number(form.get("minutes")));
    if (!(minutes >= 10 && minutes <= 1440)) throw new Error("Event duration should be between 10 minutes and 24 hours");
    const intensity = String(form.get("intensity") ?? "") as Intensity;
    if (!INTENSITIES.includes(intensity)) throw new Error("Pick how hard the event is");
    const start = String(form.get("start_time") ?? "");
    if (start && !TIME.test(start)) throw new Error("Start time looks like 10:45");
    const row = { name, event_date: date, priority, kind, duration_minutes: minutes, intensity, start_time: start || null };
    const supabase = await createClient();
    if (id) {
      const { error } = await supabase.from("training_goals").update(row).eq("id", id);
      if (error) throw error;
      return `Updated ${name}.`;
    }
    const { error } = await supabase.from("training_goals").insert(row);
    if (error) throw error;
    return `Added ${name}. The plan now builds toward it.`;
  });
}

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Sets or clears an event's start time, from the race-day card on Today. */
export async function saveGoalStart(id: string, start: string | null): Promise<ActionResult> {
  return attempt(async () => {
    if (start && !TIME.test(start)) throw new Error("Start time looks like 10:45");
    const { error } = await (await createClient()).from("training_goals").update({ start_time: start || null }).eq("id", id);
    if (error) throw error;
    return start ? `Start time set to ${start}.` : "Start time cleared.";
  });
}

export async function deleteGoal(id: string): Promise<ActionResult> {
  return attempt(async () => {
    const supabase = await createClient();
    const { error } = await supabase.from("training_goals").delete().eq("id", id);
    if (error) throw error;
    return "Event removed.";
  });
}

export async function saveAvailability(_: ActionResult | null, form: FormData): Promise<ActionResult> {
  return attempt(async () => {
    const minutes = Array.from({ length: 7 }, (_, i) => {
      const n = Number(form.get(`day${i}`) ?? 0);
      if (!Number.isFinite(n) || n < 0 || n > 480) throw new Error("Minutes per day should be between 0 and 480");
      return Math.round(n / 15) * 15;
    }) as Availability;
    const rampRate = Number(form.get("ramp_rate") ?? 5);
    if (!(rampRate >= 2 && rampRate <= 10)) throw new Error("Ramp rate should be between 2 and 10");
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) throw new Error("Not signed in");
    const { error } = await supabase
      .from("athlete_settings")
      .upsert({ user_id: user.id, availability: minutes, ramp_rate: rampRate, updated_at: new Date().toISOString() }, { onConflict: "user_id" });
    if (error) throw error;
    const hours = minutes.reduce((a, b) => a + b, 0) / 60;
    return `Saved: ${hours.toFixed(1)} hours a week.`;
  });
}

const DATE = /^20\d\d-\d\d-\d\d$/;
const MIN_PLAN_DAYS = 14;
const MAX_PLAN_DAYS = 52 * 7;
const dayCount = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
const short = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

/** A plan from the builder form, checked against your events and other plans. */
function planFromForm(form: FormData, state: TrainingState): Omit<SavedPlan, "id"> & { id?: string } {
  const id = String(form.get("id") ?? "") || undefined;
  const goal = String(form.get("goal") ?? "") as PlanGoal;
  if (!PLAN_GOALS.includes(goal)) throw new Error("Pick what the plan is for");
  const start = String(form.get("start") ?? "");
  if (!DATE.test(start)) throw new Error("Pick a start date");
  let end = String(form.get("end") ?? "");
  let goalId: string | null = null;
  if (goal === "event") {
    goalId = String(form.get("goal_id") ?? "");
    const event = state.goals.find((g) => g.id === goalId);
    if (!event) throw new Error("Pick the event to peak for, or add it under Events first");
    end = event.date;
  }
  if (!DATE.test(end)) throw new Error("Pick an end date");
  const days = dayCount(start, end) + 1;
  if (days < MIN_PLAN_DAYS) throw new Error(`A plan needs at least two weeks; this one is ${days} days`);
  if (days > MAX_PLAN_DAYS) throw new Error("A plan can run a year at most");
  if (end < state.today) throw new Error("That plan would already be over");
  const rawTarget = String(form.get("target") ?? "").trim();
  const target = rawTarget && (goal === "ftp" || goal === "fitness") ? Number(rawTarget) : null;
  if (target !== null && !(target > 0 && target < 1000)) throw new Error(goal === "ftp" ? "Target FTP should be in watts" : "Target fitness should be a CTL number");
  const event = goalId ? state.goals.find((g) => g.id === goalId) : null;
  const name = String(form.get("name") ?? "").trim().slice(0, 200) || (event ? `Build to ${event.name}` : PLAN_GOAL_LABELS[goal]);
  const clash = overlappingPlans(state.plans, start, end, id);
  if (clash.length) throw new Error(`That overlaps ${clash[0].name} (${short(clash[0].start)} to ${short(clash[0].end)}). Change its dates or remove it first.`);
  return { id, name, start, end, goal, goalId, target };
}

export interface PlanPreview {
  ok: boolean;
  message: string;
  weeks?: { start: string; phase: Phase; recoveryWeek: boolean; breakNote?: "break" | "reentry"; hours: number; stress: number }[];
  /** Fitness at the end of the plan (or on event day), and form on event day. */
  endFitness?: number;
  eventForm?: number;
  fitnessNow?: number;
}

/** What the builder form's plan would look like, without saving it. */
export async function previewPlan(_: PlanPreview | null, form: FormData): Promise<PlanPreview> {
  try {
    const state = await loadTrainingState(await createClient());
    const frame = planFromForm(form, state);
    const plan = buildPlan({
      today: state.today,
      goals: state.goals,
      frame,
      breaks: state.breaks,
      availability: state.athlete.availability,
      fitness: state.fitness,
      fatigue: state.fatigue,
      levels: state.levels,
      rampRate: state.athlete.rampRate,
    });
    const end = plan.target ? plan.forecast.find((d) => d.date === plan.target!.date) : plan.forecast.find((d) => d.date === frame.end);
    return {
      ok: true,
      message: "",
      weeks: plan.weeks.filter((w) => !w.beforePlan).map((w) => ({
        start: w.start,
        phase: w.phase,
        recoveryWeek: w.recoveryWeek,
        breakNote: w.breakNote,
        hours: Math.round(w.days.reduce((t, d) => t + (d.session?.duration ?? 0), 0) / 360) / 10,
        stress: w.stress,
      })),
      endFitness: end ? Math.round(end.fitness) : undefined,
      eventForm: plan.target && end ? Math.round(end.form) : undefined,
      fitnessNow: Math.round(state.fitness),
    };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}

export async function savePlan(_: ActionResult | null, form: FormData): Promise<ActionResult> {
  return attempt(async () => {
    const supabase = await createClient();
    const state = await loadTrainingState(supabase);
    const plan = planFromForm(form, state);
    const row = { name: plan.name, start_date: plan.start, end_date: plan.end, goal: plan.goal, goal_id: plan.goalId, target: plan.target, updated_at: new Date().toISOString() };
    const { error } = plan.id ? await supabase.from("training_plans").update(row).eq("id", plan.id) : await supabase.from("training_plans").insert(row);
    if (error) throw error;
    return `Saved ${plan.name}: ${short(plan.start)} to ${short(plan.end)}.`;
  });
}

/** Ends a running plan yesterday, or removes one that hasn't started (or ended before it began). */
export async function endPlan(id: string): Promise<ActionResult> {
  return attempt(async () => {
    const supabase = await createClient();
    const state = await loadTrainingState(supabase);
    const plan = state.plans.find((p) => p.id === id);
    if (!plan) throw new Error("No such plan");
    const yesterday = addDays(state.today, -1);
    if (plan.start > yesterday || plan.end < state.today) {
      const { error } = await supabase.from("training_plans").delete().eq("id", id);
      if (error) throw error;
      return `Removed ${plan.name}.`;
    }
    // A plan whose goal is an event keeps its event; ending it early just shortens it.
    const { error } = await supabase.from("training_plans").update({ end_date: yesterday, goal: plan.goal === "event" ? "base" : plan.goal, updated_at: new Date().toISOString() }).eq("id", id);
    if (error) throw error;
    return `Ended ${plan.name}. Training goes back to the default plan until you build a new one.`;
  });
}

export async function saveBreak(_: ActionResult | null, form: FormData): Promise<ActionResult> {
  return attempt(async () => {
    const start = String(form.get("start") ?? "");
    const end = String(form.get("end") ?? "") || start;
    const kind = String(form.get("kind") ?? "") as BreakKind;
    const riding = String(form.get("riding") ?? "") as BreakRiding;
    const note = String(form.get("note") ?? "").trim().slice(0, 500);
    if (!DATE.test(start) || !DATE.test(end)) throw new Error("Pick the dates");
    if (end < start) throw new Error("The break ends before it starts");
    if (dayCount(start, end) > 120) throw new Error("A break can be four months at most");
    if (!BREAK_KINDS.includes(kind)) throw new Error("Pick the kind of break");
    if (!BREAK_RIDING.includes(riding)) throw new Error("Say how much riding you can do");
    const minutes = riding === "limited" ? Math.round(Number(form.get("minutes") ?? 0)) : null;
    if (minutes !== null && !(minutes >= 0 && minutes <= 480)) throw new Error("Minutes a day should be 0 to 480");
    const supabase = await createClient();
    const { error } = await supabase.from("plan_breaks").insert({ start_date: start, end_date: end, kind, riding, minutes, note });
    if (error) throw error;
    return `Added ${BREAK_KIND_LABELS[kind].toLowerCase()}, ${short(start)}${end !== start ? ` to ${short(end)}` : ""}. The plan works around it from ${short(weekStart(start))}.`;
  });
}

export async function deleteBreak(id: string): Promise<ActionResult> {
  return attempt(async () => {
    const supabase = await createClient();
    const { error } = await supabase.from("plan_breaks").delete().eq("id", id);
    if (error) throw error;
    return "Break removed.";
  });
}

/**
 * Saves how you feel today. The brief on Today is rewritten from it, with today's options rebuilt by
 * the engine and the coach's pick among them.
 */
export async function saveCheckin(input: { feel: number; sick: boolean; minutes: number | null; notes: string }): Promise<ActionResult> {
  return attempt(async () => {
    const feel = Math.round(Number(input.feel)) as Feel;
    if (![1, 2, 3, 4, 5].includes(feel)) throw new Error("Say how you feel, 1 to 5");
    const minutes = input.minutes === null ? null : Math.round(Number(input.minutes));
    if (minutes !== null && !(minutes >= 20 && minutes <= 360)) throw new Error("Time available should be 20 to 360 minutes");
    const notes = String(input.notes ?? "").trim().slice(0, 1000);
    const sick = Boolean(input.sick);

    const supabase = await createClient();
    const state = await loadTrainingState(supabase);
    const result = todayOptions(state, { feel, sick, minutes });
    if (!result) throw new Error("Today is already settled");
    const record: CheckinRecord = {
      feel,
      sick,
      minutes,
      notes,
      recovery: state.recovery?.score?.score ?? null,
      form: Math.round(state.form * 10) / 10,
      recommended: result.recommended,
      reasons: result.reasons,
      coach: null,
      at: new Date().toISOString(),
    };
    const { error } = await supabase
      .from("plan_days")
      .upsert(
        { user_id: state.athlete.userId, day: state.today, planned: state.todayPlan?.session ?? null, checkin: record, updated_at: new Date().toISOString() },
        { onConflict: "user_id,day" },
      );
    if (error) throw error;
    await recordCheckin(
      supabase,
      state.today,
      [`Check-in: feeling ${FEEL_LABELS[feel].toLowerCase()}`, sick ? ", ill" : "", minutes ? `, ${minutes} min available` : "", notes ? `. "${notes}"` : ""].join(""),
    );
    return "Checked in.";
  });
}

/** Locks in one of today's options. They're rebuilt from today's data and check-in, so the session is the engine's. */
export async function chooseOption(option: OptionId): Promise<ActionResult> {
  return attempt(async () => {
    const supabase = await createClient();
    const state = await loadTrainingState(supabase);
    const chosen = todayOptions(state)?.options.find((o) => o.id === option);
    if (!chosen) throw new Error("That option isn't available today");
    const { error } = await supabase
      .from("plan_days")
      .upsert(
        { user_id: state.athlete.userId, day: state.today, planned: state.todayPlan?.session ?? null, chosen: { option, session: chosen.session }, updated_at: new Date().toISOString() },
        { onConflict: "user_id,day" },
      );
    if (error) throw error;
    await recordChoice(supabase, state.today, `Chose: ${chosen.label}${chosen.session ? ` (${chosen.session.workout.name})` : ""}.`);
    return chosen.session ? `Locked in: ${chosen.session.workout.name}.` : "Rest day it is.";
  });
}

/** Asks the coach to pick the workout for every key day from today through next week again. */
export async function pickWorkouts(): Promise<ActionResult> {
  return attempt(async () => {
    const supabase = await createClient();
    const picked = await planAhead(supabase, {}, { all: true });
    return picked ? `The coach picked ${picked} workout${picked === 1 ? "" : "s"}` : "No key days to pick for";
  });
}

/** A day you can change from the Plan page: from today through the next four weeks, not an event, not ridden. */
function editableDay(state: TrainingState, date: string) {
  const day = changeableDay(state, date);
  const tz = state.athlete.timezone;
  if (date === state.today && state.rides.some((r) => localDate(r.startedAt, tz) === date)) throw new Error("You've already ridden today");
  return day;
}

/** Saves a workout you edited as a day's session (null makes it a rest day), then sends the plan to intervals.icu. */
export async function saveDayWorkout(date: string, raw: unknown): Promise<ActionResult> {
  return attempt(async () => {
    const workout = raw === null ? null : readWorkout(raw);
    if (raw !== null && !workout) throw new Error("That workout can't be saved");
    const supabase = await createClient();
    const state = await loadTrainingState(supabase);
    const day = editableDay(state, date);
    await writeDays(supabase, state, [{ date, session: workout && editedSession(workout, day.session, state.levels) }]);
    return `${workout ? `Saved “${workout.name}”` : "Made it a rest day"}.${await pushChangedPlan(supabase)}`;
  });
}

/** Puts a day back to the plan's session. */
export async function resetPlanDay(date: string): Promise<ActionResult> {
  return attempt(async () => {
    const supabase = await createClient();
    const state = await loadTrainingState(supabase);
    editableDay(state, date);
    await writeDays(supabase, state, [{ date, session: "reset" }]);
    return `Back to the plan's session.${await pushChangedPlan(supabase)}`;
  });
}

/**
 * Moves a day's session to another day, and that day's to it (a rest day swaps too, so dropping a
 * workout on a rest day moves the rest). Riding outside moves with the workout.
 */
export async function moveDay(from: string, to: string): Promise<ActionResult> {
  return attempt(async () => {
    if (from === to) throw new Error("Pick another day");
    const supabase = await createClient();
    const state = await loadTrainingState(supabase);
    const a = editableDay(state, from);
    const b = editableDay(state, to);
    await writeDays(supabase, state, [
      { date: from, session: b.session },
      { date: to, session: a.session },
    ]);
    await swapOutdoor(supabase, from, to);
    return `Moved.${await pushChangedPlan(supabase)}`;
  });
}

async function swapOutdoor(supabase: Awaited<ReturnType<typeof createClient>>, a: string, b: string) {
  const { data, error } = await supabase.from("outdoor_rides").select("day, workout").in("day", [a, b]);
  // Nothing to carry over without the table.
  if (error || data.length === 0) return;
  const { error: removed } = await supabase.from("outdoor_rides").delete().in("day", [a, b]);
  if (removed) throw removed;
  const { error: added } = await supabase.from("outdoor_rides").insert(data.map((r) => ({ day: r.day === a ? b : a, workout: r.workout })));
  if (added) throw added;
}
