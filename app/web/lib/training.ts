// Everything the plan, the check-in and the coach read, loaded once per request: rides, fitness,
// recovery, goals, levels and the plan computed from them.

import { loadCourseSummaries } from "./course";
import { courseDemands } from "./engine/course/shape";
import { experiments } from "./experiments";
import { loadAthlete, loadRides, type Athlete, type StoredRide } from "./activities";
import { dailyStress, localDate } from "./engine/activity";
import { DIFFICULTIES, type Difficulty } from "./engine/feedback";
import { loadFavorites } from "./favorites";
import { favoriteLibraryIds } from "./engine/workout-library";
import { applyOutcomes, outcomeFromRides, seedLevels, type Outcome } from "./engine/levels";
import { ZONE_LABELS, ZONES, type Levels, type Session } from "./engine/library";
import { addDays, fitnessSeries, type FitnessDay } from "./engine/pmc";
import { BREAK_KINDS, BREAK_RIDING, buildPlan, currentPlan, dayMinutes, weekStart, GOAL_KINDS, goalMinutes, INTENSITIES, PLAN_GOALS, type Break, type Goal, type Plan, type PlanDay, type SavedPlan } from "./engine/plan";
import { applyOverrides, sameSession } from "./engine/overrides";
import { applyMoves, refitMissed, type Move } from "./engine/adapt";
import { inputsKey, keepWeek, weekDrift, type Drift, type KeptWeek } from "./engine/stability";
import { LINK_WINDOW_DAYS, type ComplianceDay } from "./engine/compliance";
import { applyPicks, type WorkoutPick } from "./engine/picks";
import { weekReview, type SnapshotDay, type WeekReview } from "./engine/review";
import type { OutdoorRide } from "./engine/outdoor";
import { mergeCurves } from "./engine/power";
import { readWorkout } from "./engine/workout-edit";
import type { OptionId } from "./engine/checkin";
import { loadRecovery, type RecoveryToday } from "./recovery-data";
import { features } from "./features";
import { loadDaytime } from "./daytime-data";
import { exertionNormal, type DayExertion, type ExertionNormal } from "./engine/exertion";
import type { createClient } from "./supabase/server";

type Supabase = Awaited<ReturnType<typeof createClient>>;

const LEVEL_WINDOW_DAYS = 90;
/** How far ahead stored day changes are read; past the longest plan. */
const AHEAD_DAYS = 53 * 7;

export interface CheckinRecord {
  feel: number;
  sick: boolean;
  minutes: number | null;
  notes: string;
  recovery: number | null;
  form: number;
  recommended: OptionId;
  reasons: string[];
  coach: { message: string; pick: OptionId; model: string } | null;
  at: string;
}

export interface StoredPlanDay {
  day: string;
  planned: Session | null;
  chosen: { option: OptionId; session: Session | null } | null;
  checkin: CheckinRecord | null;
  activityId: string | null;
  feelAfter: number | null;
  /** Set when a missed key session was moved to this day (adapt.ts): the day it was planned for. */
  movedFrom: string | null;
}

/** The post-ride survey for one ride. */
export interface StoredFeedback {
  /** The ride as shown (a copy's answer belongs to the ride it copies). */
  rideId: string;
  /** The ride's local date. */
  day: string;
  difficulty: Difficulty;
  rpe: number | null;
  note: string;
  /** The library workout ridden, when it wasn't a plan day's session. */
  session: Pick<Session, "zone" | "level" | "duration" | "stress"> | null;
}

export interface TrainingState {
  athlete: Athlete;
  today: string;
  rides: StoredRide[];
  /** Fitness series through today. */
  series: FitnessDay[];
  /** Coming into today. */
  fitness: number;
  fatigue: number;
  form: number;
  /** Null when it failed to load, so the rest of the page still works. */
  recovery: RecoveryToday | null;
  /** Exertion by day (Apple Health heart rate all day, plus rides), and your normal coming into today. */
  exertion: { days: DayExertion[]; normal: ExertionNormal | null; hasWatch: boolean } | null;
  goals: Goal[];
  /** Every saved plan, and the one in force (running now, else the next to start). */
  plans: SavedPlan[];
  activePlan: SavedPlan | null;
  breaks: Break[];
  levels: Levels;
  /** Favorite workout keys (`library:<id>`, `custom:<id>`). */
  favorites: string[];
  /** What levels start from and the outcomes that moved them, so levels on an earlier day can be worked out (levelsOn). */
  levelSeed: Levels;
  levelOutcomes: Outcome[];
  /** The plan with changes you made to single days laid over it. */
  plan: Plan;
  /** The plan as the engine built it with the coach's workout picks, before those changes. */
  basePlan: Plan;
  /** The coach's workout picks from today on (picks.ts). */
  picks: WorkoutPick[];
  /** Days from today on ridden outside, so they go to the Karoo (outdoor.ts). */
  outdoor: OutdoorRide[];
  /** How far the rebuilt week has moved from the one kept when the week began (stability.ts), and the rebuilt days, for a re-plan. */
  weekDrift: Drift | null;
  rebuiltWeek: PlanDay[] | null;
  /** What the plan is built from, as kept with the week. */
  planInputs: string;
  /** Missed key sessions moved to a later day of their week, stored and made this load. */
  moves: Move[];
  /** Days from today on whose session differs from the engine's plan. */
  changedDays: string[];
  /** Today's plan entry, and what's stored for it. */
  todayPlan: PlanDay | null;
  todayStored: StoredPlanDay | null;
  /** Recent days you chose a session on, newest first. */
  recentDays: StoredPlanDay[];
  /** Every stored day from 90 days back through today, newest first. */
  storedDays: StoredPlanDay[];
  /** Post-ride survey answers from the last 90 days, newest ride first. */
  feedback: StoredFeedback[];
  /** Rides you set (or the Ride page saved) as counting for a plan day, by ride id: the day they count for. */
  rideLinks: Map<string, string>;
}

export async function loadGoals(supabase: Supabase): Promise<Goal[]> {
  const { data, error } = await supabase
    .from("training_goals")
    .select("id, name, event_date, priority, kind, duration_minutes, intensity, start_time")
    .order("event_date");
  if (error) throw error;
  return data
    .filter((g) => (GOAL_KINDS as readonly string[]).includes(g.kind))
    .map((g) => ({
      id: g.id,
      name: g.name,
      date: g.event_date,
      priority: g.priority,
      kind: g.kind,
      minutes: g.duration_minutes ?? null,
      intensity: (INTENSITIES as readonly string[]).includes(g.intensity) ? g.intensity : null,
      startTime: g.start_time ? String(g.start_time).slice(0, 5) : null,
    }));
}

/** Saved plans, oldest first. Empty (and logged) if the table isn't there yet, so the app keeps working. */
export async function loadPlans(supabase: Supabase): Promise<SavedPlan[]> {
  const { data, error } = await supabase.from("training_plans").select("id, name, start_date, end_date, goal, goal_id, target").order("start_date");
  if (error) return (console.error(error), []);
  return data
    .filter((p) => (PLAN_GOALS as readonly string[]).includes(p.goal))
    .map((p) => ({ id: p.id, name: p.name, start: p.start_date, end: p.end_date, goal: p.goal, goalId: p.goal_id, target: p.target === null ? null : Number(p.target) }));
}

export async function loadBreaks(supabase: Supabase): Promise<Break[]> {
  const { data, error } = await supabase.from("plan_breaks").select("id, start_date, end_date, kind, riding, minutes, note").order("start_date");
  if (error) return (console.error(error), []);
  return data
    .filter((b) => (BREAK_KINDS as readonly string[]).includes(b.kind) && (BREAK_RIDING as readonly string[]).includes(b.riding))
    .map((b) => ({ id: b.id, start: b.start_date, end: b.end_date, kind: b.kind, riding: b.riding, minutes: b.minutes, note: b.note }));
}

/** The coach's workout picks from `from` on. Empty (and logged) if the table isn't there yet, so the app keeps working. */
export async function loadPicks(supabase: Supabase, from: string): Promise<WorkoutPick[]> {
  const { data, error } = await supabase.from("coach_picks").select("day, template, tweaks, reason").gte("day", from).order("day");
  if (error) return (console.error(error), []);
  return data.map((r) => ({ date: r.day, template: r.template, tweaks: r.tweaks ?? {}, reason: r.reason ?? "" }));
}

/** Days ridden outside from `from` on. Empty (and logged) if the table isn't there yet, so the app keeps working. */
export async function loadOutdoor(supabase: Supabase, from: string): Promise<OutdoorRide[]> {
  const { data, error } = await supabase.from("outdoor_rides").select("day, workout").gte("day", from).order("day");
  if (error) return (console.error(error), []);
  return data.map((r) => ({ date: r.day, workout: r.workout ? readWorkout(r.workout) : null }));
}

export async function loadPlanDays(supabase: Supabase, from: string, through: string): Promise<StoredPlanDay[]> {
  const { data, error } = await supabase
    .from("plan_days")
    .select("day, planned, chosen, checkin, activity_id, feel_after, moved_from")
    .gte("day", from)
    .lte("day", through)
    .order("day", { ascending: false });
  if (error) throw error;
  return data.map((r) => ({ day: r.day, planned: r.planned, chosen: r.chosen, checkin: r.checkin, activityId: r.activity_id, feelAfter: r.feel_after, movedFrom: r.moved_from ?? null }));
}

/** Survey answers, unmatched to rides yet (feedbackFor), so the query can run alongside the rides'. */
async function loadFeedbackRows(supabase: Supabase) {
  const { data, error } = await supabase.from("ride_feedback").select("activity_id, difficulty, rpe, note, session, activities(duplicate_of)");
  if (error) return (console.error(error), []);
  return data;
}

/** Survey answers for rides since a date, keyed to the ride shown (not its copies). */
function feedbackFor(rows: Awaited<ReturnType<typeof loadFeedbackRows>>, rides: StoredRide[], since: string, tz: string): StoredFeedback[] {
  const byId = new Map(rides.map((r) => [r.id, r]));
  const out: StoredFeedback[] = [];
  for (const row of rows) {
    const parent = Array.isArray(row.activities) ? row.activities[0] : row.activities;
    const ride = byId.get(parent?.duplicate_of ?? row.activity_id);
    if (!ride || !(DIFFICULTIES as readonly string[]).includes(row.difficulty)) continue;
    const day = localDate(ride.startedAt, tz);
    if (day < since) continue;
    out.push({ rideId: ride.id, day, difficulty: row.difficulty, rpe: row.rpe, note: row.note ?? "", session: validSession(row.session) });
  }
  const order = new Map(rides.map((r, i) => [r.id, i]));
  return out.sort((a, b) => order.get(a.rideId)! - order.get(b.rideId)!);
}

function validSession(value: unknown): StoredFeedback["session"] {
  const s = value as Partial<Session> | null;
  if (!s || !(ZONES as readonly string[]).includes(s.zone as string) || ![s.level, s.duration, s.stress].every((n) => typeof n === "number" && Number.isFinite(n))) return null;
  return { zone: s.zone!, level: s.level!, duration: s.duration!, stress: s.stress! };
}

export async function loadTrainingState(supabase: Supabase): Promise<TrainingState> {
  // Every query is one round trip to the database, so they all go out together: those that don't need the athlete's
  // time zone start before it's known, and recovery reads its rows while the day's exertion loads.
  const early = Promise.all([loadRides(supabase), loadGoals(supabase), loadPlans(supabase), loadBreaks(supabase), loadFeedbackRows(supabase), experiments().course_prep ? loadCourseSummaries(supabase) : null]);
  early.catch(() => {}); // Reported by the await below; this keeps a failure while the athlete loads from going unhandled.
  const athlete = await loadAthlete(supabase);
  const tz = athlete.timezone;
  const today = localDate(new Date(), tz);
  const daytime = loadDaytime(supabase, athlete, today).catch((e) => (console.error(e), null));
  const [[rides, eventGoals, plans, breaks, feedbackRows, courses], recovery, daytimeData, allDays, picks, outdoor, keptRow, favorites] = await Promise.all([
    early,
    // Riders who don't track recovery get none, even if some sleep data arrived (intervals.icu wellness), so neither
    // Today's options nor the coach go by a score they never see.
    features().recovery ? loadRecovery(supabase, today, athlete.sleepNeedHours, daytime, athlete.timezone).catch((e) => (console.error(e), null)) : null,
    daytime,
    loadPlanDays(supabase, addDays(today, -LEVEL_WINDOW_DAYS), addDays(today, AHEAD_DAYS)),
    loadPicks(supabase, today),
    loadOutdoor(supabase, today),
    loadKeptWeek(supabase, weekStart(today)),
    // Favorites are optional: the plan builds the same without them.
    loadFavorites(supabase).catch((e) => (console.error(e), [] as string[])),
  ]);
  // Events with a course file carry what the course asks of you, so the plan can train for it (course/shape.ts).
  const goals = eventGoals.map((g) => {
    const course = courses?.get(g.id);
    return course ? { ...g, course: courseDemands(course, g.kind, g, { ftp: athlete.ftp, weightKg: athlete.weightKg }) } : g;
  });
  const feedback = feedbackFor(feedbackRows, rides, addDays(today, -LEVEL_WINDOW_DAYS), tz);
  const ahead = allDays.filter((d) => d.day >= today);
  const storedDays = allDays.filter((d) => d.day <= today);
  const rideLinks = linksFrom(storedDays);
  const countsOn = (r: StoredRide) => rideLinks.get(r.id) ?? localDate(r.startedAt, tz);

  const firstDay = rides.length ? localDate(rides[rides.length - 1].startedAt, tz) : today;
  const series = fitnessSeries(dailyStress(rides, tz), firstDay < today ? firstDay : addDays(today, -1), today);
  const yesterday = series.find((d) => d.date === addDays(today, -1)) ?? { fitness: 0, fatigue: 0 };
  const form = yesterday.fitness - yesterday.fatigue;

  // Levels: seeded from the last 90 days of power, then moved by how chosen sessions and library
  // workouts went (the post-ride survey, else the older "how did it feel").
  const since = addDays(today, -LEVEL_WINDOW_DAYS);
  const recent = rides.filter((r) => localDate(r.startedAt, tz) >= since);
  const curves = recent.flatMap((r) => (r.powerCurve ? [r.powerCurve] : []));
  const seed = seedLevels(curves.length ? mergeCurves(...curves) : null, athlete.ftp, Math.max(0, ...recent.map((r) => r.durationSeconds)));
  const sessionDays = new Set(storedDays.filter((d) => d.chosen?.session).map((d) => d.day));
  const planOutcomes = storedDays.flatMap((d): Outcome[] => {
    const session = d.chosen?.session;
    if (!session) return [];
    const dayRides = recent
      .filter((r) => countsOn(r) === d.day)
      .map((r) => ({ id: r.id, durationSeconds: r.durationSeconds, trainingStress: r.trainingStress, linked: r.id === d.activityId }));
    const answer = feedback.find((f) => f.rideId === d.activityId) ?? feedback.find((f) => dayRides.some((r) => r.id === f.rideId));
    const outcome = outcomeFromRides(
      d.day,
      session,
      dayRides,
      answer ? { difficulty: answer.difficulty, rpe: answer.rpe } : d.feelAfter ? { feel: d.feelAfter as Outcome["feel"] } : {},
    );
    return outcome ? [outcome] : [];
  });
  // Library workouts ridden on days without a plan session.
  const libraryOutcomes = feedback.flatMap((f): Outcome[] => {
    const ride = recent.find((r) => r.id === f.rideId);
    if (!f.session || !ride || sessionDays.has(f.day) || f.session.duration <= 0) return [];
    return [{ date: f.day, zone: f.session.zone, level: f.session.level, completion: Math.min(1, ride.durationSeconds / f.session.duration), difficulty: f.difficulty, rpe: f.rpe }];
  });
  const levels = applyOutcomes(seed, [...planOutcomes, ...libraryOutcomes]);

  const activePlan = currentPlan(plans, today);
  const enginePlan = buildPlan({
    today,
    goals,
    frame: activePlan,
    breaks,
    availability: athlete.availability,
    fitness: yesterday.fitness,
    fatigue: yesterday.fatigue,
    levels,
    rampRate: athlete.rampRate,
    favorites: favoriteLibraryIds(favorites),
  });
  // This week's skeleton stays as it was when the week began; a rebuild that's moved past the drift limit is offered
  // as a re-plan instead (stability.ts). Changing what the plan is built from re-plans the week at once.
  const planInputs = inputsKey({ availability: athlete.availability, rampRate: athlete.rampRate, goals, breaks, plan: activePlan });
  const rebuiltWeek = enginePlan.weeks[0]?.start === weekStart(today) ? enginePlan.weeks[0].days : null;
  let kept: KeptWeek | null = keptRow && keptRow.inputs === planInputs ? keptRow : null;
  if (!kept && rebuiltWeek) {
    kept = { week: weekStart(today), days: rebuiltWeek, inputs: planInputs };
    await saveKeptWeek(supabase, athlete.userId, kept);
  }
  const drift = kept && rebuiltWeek ? weekDrift(kept.days, rebuiltWeek, today) : null;
  const stablePlan = keepWeek(enginePlan, kept, today, yesterday);
  // The coach's weekly picks choose the structure of key days; the engine keeps everything else.
  const picked = applyPicks(stablePlan, picks, today, yesterday);
  // Key sessions missed earlier this week move to a later day: moves made on earlier loads are stored with the day
  // they went to, so they stay put; new ones are made now and stored.
  const storedMoves: Move[] = allDays.filter((d) => d.movedFrom).map((d) => ({ from: d.movedFrom!, to: d.day, session: d.planned }));
  const refit = refitMissed(
    applyMoves(picked, storedMoves, today, yesterday),
    {
      today,
      ridden: new Set(rides.map(countsOn)),
      decided: new Set([...storedDays.filter((d) => d.chosen).map((d) => d.day), ...ahead.map((d) => d.day)]),
      minutes: (date) => dayMinutes(date, athlete.availability, breaks),
    },
    yesterday,
  );
  const basePlan = refit.plan;
  if (refit.moves.length) await saveMoves(supabase, athlete.userId, refit.moves);
  // Days changed through the coach: today and later rows hold the session to ride (chosen at check-in, else planned).
  const overrides = ahead.map((d) => ({ date: d.day, session: d.chosen ? d.chosen.session : d.planned }));
  const plan = applyOverrides(basePlan, overrides, today, yesterday);
  const baseDays = new Map(basePlan.weeks.flatMap((w) => w.days).map((d) => [d.date, d.session]));
  const changedDays = plan.weeks
    .flatMap((w) => w.days)
    .filter((d) => d.date >= today && baseDays.has(d.date) && !sameSession(d.session, baseDays.get(d.date)!))
    .map((d) => d.date);
  const todayPlan = plan.weeks.flatMap((w) => w.days).find((d) => d.date === today) ?? null;

  return {
    athlete,
    today,
    rides,
    series,
    fitness: yesterday.fitness,
    fatigue: yesterday.fatigue,
    form,
    recovery,
    exertion: daytimeData ? { days: daytimeData.days, normal: exertionNormal(daytimeData.days, today), hasWatch: daytimeData.hasWatch } : null,
    goals,
    plans,
    activePlan,
    breaks,
    levels,
    levelSeed: seed,
    levelOutcomes: [...planOutcomes, ...libraryOutcomes],
    plan,
    basePlan,
    picks,
    outdoor,
    moves: [...storedMoves, ...refit.moves],
    weekDrift: drift,
    rebuiltWeek,
    planInputs,
    changedDays,
    todayPlan,
    todayStored: storedDays.find((d) => d.day === today) ?? null,
    recentDays: storedDays.filter((d) => d.chosen?.session),
    storedDays,
    feedback,
    rideLinks,
    favorites,
  };
}

/** The week's skeleton as kept when it began. Null (and logged on error) when there's none yet. */
async function loadKeptWeek(supabase: Supabase, monday: string): Promise<KeptWeek | null> {
  const { data, error } = await supabase.from("plan_weeks").select("week, days, inputs").eq("week", monday).maybeSingle();
  if (error) return (console.error(error), null);
  return data && Array.isArray(data.days) ? { week: data.week, days: data.days, inputs: data.inputs ?? "" } : null;
}

/** Keeps a week's skeleton (the Re-plan button writes the rebuilt one through here too). A failure is logged: the week is just rebuilt again. */
export async function saveKeptWeek(supabase: Supabase, userId: string, kept: KeptWeek) {
  const { error } = await supabase
    .from("plan_weeks")
    .upsert({ user_id: userId, week: kept.week, days: kept.days, inputs: kept.inputs, updated_at: new Date().toISOString() }, { onConflict: "user_id,week" });
  if (error) console.error("Couldn't keep this week's plan:", error);
}

/** Stores new moves on the days they went to, so they stay put. A failure is logged: the move is made again next load. */
async function saveMoves(supabase: Supabase, userId: string, moves: Move[]) {
  const now = new Date().toISOString();
  const rows = moves.map((m) => ({ user_id: userId, day: m.to, planned: m.session, chosen: null, moved_from: m.from, updated_at: now }));
  const { error } = await supabase.from("plan_days").upsert(rows, { onConflict: "user_id,day" });
  if (error) console.error("Couldn't store a moved session:", error);
}

/** Ride id to the plan day it's linked to; a ride linked to two days (shouldn't happen) counts for the latest. */
function linksFrom(storedDays: StoredPlanDay[]): Map<string, string> {
  const links = new Map<string, string>();
  for (const d of storedDays) if (d.activityId && !links.has(d.activityId)) links.set(d.activityId, d.day);
  return links;
}

/** The day a ride counts for: the plan day you linked it to, else the day it was ridden. */
export function rideDay(state: Pick<TrainingState, "rideLinks" | "athlete">, ride: Pick<StoredRide, "id" | "startedAt">): string {
  return state.rideLinks.get(ride.id) ?? localDate(ride.startedAt, state.athlete.timezone);
}

/** The rides that count for a day (copies left out): those ridden that day, less any linked elsewhere, plus any linked to it. */
export function ridesFor(state: Pick<TrainingState, "rideLinks" | "athlete" | "rides">, day: string): StoredRide[] {
  return state.rides.filter((r) => rideDay(state, r) === day);
}

/** A planned day a ride could count for: one within LINK_WINDOW_DAYS of it, through today, with something planned. */
export interface LinkOption {
  date: string;
  /** What was planned: the workout's zone and length, or the event's name. */
  label: string;
}

/** The plan days a ride can count for, nearest first. */
export function linkOptions(state: TrainingState, rideDate: string): LinkOption[] {
  const out: LinkOption[] = [];
  for (let k = -LINK_WINDOW_DAYS; k <= LINK_WINDOW_DAYS; k++) {
    const date = addDays(rideDate, k);
    if (date > state.today) continue;
    const planned = plannedOn(state, date);
    if (!planned || planned.stress <= 0) continue;
    const goal = planned.session ? null : state.goals.find((g) => g.date === date);
    const label = planned.session
      ? `${ZONE_LABELS[planned.session.zone]}, ${Math.round(planned.session.duration / 60)} min`
      : (goal?.name ?? `${Math.round(planned.duration / 60)} min`);
    out.push({ date, label });
  }
  return out.sort((a, b) => Math.abs(dayGap(a.date, rideDate)) - Math.abs(dayGap(b.date, rideDate)) || a.date.localeCompare(b.date));
}

const dayGap = (a: string, b: string) => Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000);

/** The session to ride on a day: what you chose at check-in, else the plan's. */
export function sessionFor(state: TrainingState, day: string, stored: StoredPlanDay | null): Session | null {
  if (stored?.chosen) return stored.chosen.session;
  return state.plan.weeks.flatMap((w) => w.days).find((d) => d.date === day)?.session ?? null;
}

/** What was planned for a day, today or before: a stored session first (chosen at check-in, else as planned then), else the rebuilt plan's. */
export function plannedOn(state: TrainingState, day: string): { session: Session | null; duration: number; stress: number } | null {
  const stored = state.storedDays.find((d) => d.day === day);
  if (stored && (stored.chosen || stored.planned)) {
    const session = stored.chosen ? stored.chosen.session : stored.planned;
    return session ? { session, duration: session.duration, stress: session.stress } : null;
  }
  const planned = state.plan.weeks.flatMap((w) => w.days).find((d) => d.date === day);
  if (!planned || planned.stress <= 0) return null;
  return { session: planned.session, duration: planned.session?.duration ?? (planned.goal ? goalMinutes(planned.goal) * 60 : 0), stress: planned.stress };
}

/** Progression levels at the end of a day, from the outcomes up to it. */
export function levelsOn(state: TrainingState, day: string): Levels {
  return applyOutcomes(state.levelSeed, state.levelOutcomes.filter((o) => o.date <= day));
}

/**
 * What was planned for a day, today or before: a stored session first (chosen at check-in, else as planned then), else the rebuilt
 * plan's, else what `snapshot` says it was (the rebuilt plan starts this week, so earlier days come from a snapshot taken then).
 */
function plannedOrSnapshot(state: TrainingState, day: string, snapshot?: Map<string, { duration: number; stress: number }>) {
  const planned = plannedOn(state, day);
  if (planned || !snapshot || state.storedDays.some((d) => d.day === day && (d.chosen || d.planned))) return planned;
  const s = snapshot.get(day);
  return s && s.stress > 0 ? { session: null, ...s } : null;
}

/** Each day from `from` through `through` with what was planned and the rides on it, for marking planned against done. */
export function complianceDays(state: TrainingState, from: string, through: string, snapshot?: Map<string, { duration: number; stress: number }>): ComplianceDay[] {
  const days: ComplianceDay[] = [];
  for (let date = from; date <= through; date = addDays(date, 1)) {
    const move = state.moves.find((m) => m.from === date);
    const planned = move ? null : plannedOrSnapshot(state, date, snapshot);
    days.push({
      date,
      planned: planned && { duration: planned.duration, stress: planned.stress },
      rides: date <= state.today ? ridesFor(state, date) : [],
      ...(move ? { movedTo: move.to } : {}),
    });
  }
  return days;
}

/** What each day of the week starting `monday` is planned to be now, kept so next week's review can compare against it. */
export function planSnapshot(state: TrainingState, monday: string): SnapshotDay[] {
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i)).flatMap((date) => {
    const planned = plannedOn(state, date);
    return planned && planned.stress > 0 ? [{ date, duration: Math.round(planned.duration), stress: Math.round(planned.stress) }] : [];
  });
}

/** The review of the week starting `monday`, against what was stored for its days or else `snapshot`, taken when the week started. */
export function reviewWeek(state: TrainingState, monday: string, snapshot: SnapshotDay[] = []): WeekReview {
  const end = addDays(monday, 6);
  const byDate = new Map(snapshot.map((d) => [d.date, d]));
  return weekReview({
    start: monday,
    days: complianceDays(state, addDays(monday, -1), addDays(end, 1), byDate),
    feedback: state.feedback,
    levelsBefore: levelsOn(state, addDays(monday, -1)),
    levelsAfter: levelsOn(state, end),
    series: state.series.filter((d) => d.date >= addDays(monday, -1) && d.date <= end),
  });
}
