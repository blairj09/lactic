// What the chat coach can read and propose. Every number here comes from the database or the
// engine; the tools only select and summarize. Proposals are checked by the engine (changes.ts) and
// shown to you with an Apply button; the coach can't write anything itself.

import { ALL_FEATURES, FEATURE_LABELS, type Feature, type Features } from "../features";
import { ftpOn, localDate } from "../engine/activity";
import { ageOn, bodyTrend } from "../engine/body";
import { FEEL_LABELS, type CheckinResult, type Feel, type OptionId } from "../engine/checkin";
import { estimateFtp } from "../engine/ftp";
import { DIFFICULTY_LABELS } from "../engine/feedback";
import { FEEL_AFTER_LABELS } from "../engine/levels";
import { buildSession, ZONE_LABELS, ZONES, type Session, type Zone } from "../engine/library";
import { checkTweaks, FOCUS_LABELS, FOCUSES, templateById, TEMPLATES, type Focus, type Param, type Params, type Template } from "../engine/templates";
import { pickFits, type WorkoutPick } from "../engine/picks";
import { dayOptions } from "../engine/overrides";
import { BREAK_KIND_LABELS, BREAK_RIDING_LABELS, SAFETY_RULE_LABELS, SAFETY_RULE_NOTES, describeDay, GOAL_KIND_LABELS, goalIntensity, goalMinutes, PHASE_LABELS, PLAN_GOAL_LABELS, type Availability, type Break, type PlanDay } from "../engine/plan";
import { addDays } from "../engine/pmc";
import { MINIMUM_BASELINE_DAYS } from "../engine/recovery";
import { MIN_COVERED_MINUTES } from "../engine/exertion";
import { raceDay } from "../engine/raceday";
import { mergeCurves, type PowerCurve } from "../engine/power";
import { weighInOn, type BodyMeasurement } from "../body-data";
import type { StoredRide } from "../activities";
import type { StoredFeedback, StoredPlanDay, TrainingState } from "../training";
import { todayOptions } from "../today-options";
import type { Persona } from "./persona";
import { CM_PER_IN, LB_PER_KG, M_PER_MILE, type UnitSystem } from "../units";
import { CHANGE_WINDOW_DAYS, resolveChange, type PlanChange, type Proposal } from "./changes";

export interface RecoveryDay {
  day: string;
  hrvMs: number | null;
  hrvKind: "rmssd" | "sdnn" | null;
  restingHr: number | null;
  sleepHours: number | null;
  deepHours?: number | null;
  remHours?: number | null;
  awakeHours?: number | null;
  /** Apple Watch sleeping wrist temperature, °C (only the change against normal means much). */
  wristTempC?: number | null;
  /** Breaths per minute asleep. */
  respiratoryRate?: number | null;
}

/** Everything the coach can see, loaded once per message. */
export interface CoachData {
  state: TrainingState;
  /** Stored plan days (check-ins, choices, how rides felt), newest first. */
  planDays: StoredPlanDay[];
  recoveryDays: RecoveryDay[];
  body: BodyMeasurement[];
  /** Lasting facts about the athlete, saved by the coach or by them. */
  memory: MemoryFact[];
  /** How the coach talks (Settings); the defaults when missing. */
  persona?: Persona;
  /** The rider's units (Settings). With imperial, results carry lb, in, mi and °F copies to quote. */
  units?: UnitSystem;
  /** What the rider tracks besides rides and the plan (Settings); everything when missing. */
  features?: Features;
}

export interface MemoryFact {
  id: string;
  fact: string;
  source: "coach" | "athlete";
}

/** A change to the coach's memory, made after the reply is saved. */
export type MemoryOp = { op: "add"; fact: string } | { op: "remove"; id: string };

const MAX_FACT = 300;
const MAX_FEEDBACK = 600;

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const CURVE_LABELS: Record<number, string> = { 5: "5s", 15: "15s", 30: "30s", 60: "1min", 120: "2min", 300: "5min", 600: "10min", 1200: "20min", 1800: "30min", 3600: "60min" };

const fn = (name: string, description: string, properties: Record<string, unknown> = {}, required: string[] = []) => ({
  type: "function",
  function: { name, description, parameters: { type: "object", properties, required } },
});
const date = (description: string) => ({ type: "string", description: `${description} (YYYY-MM-DD)` });
const reason = { type: "string", description: "One sentence on why, shown to the athlete with the change" };

export const TOOLS = [
  fn("get_rides", "Rides, newest first, with duration, distance, power, heart rate, training stress (TSS) and the athlete's post-ride answer (difficulty, RPE 1-10, note).", {
    from: date("First day"),
    to: date("Last day"),
    limit: { type: "integer", minimum: 1, maximum: 100, description: "Default 20" },
  }),
  fn("get_ride", "One ride in detail: everything in get_rides plus its best powers and the plan day it was ridden for.", { id: { type: "string" } }, ["id"]),
  fn("get_fitness", "Daily fitness (CTL), fatigue (ATL), form (TSB) and stress. Past days are history; days after today are the plan's forecast if every session is ridden. Ranges over 90 days come back weekly.", {
    from: date("First day, default 6 weeks ago"),
    to: date("Last day, default today"),
  }),
  fn("get_plan", "The training plan by week: phase, weekly stress, each day's session, and for past days what was ridden, the check-in and the post-ride answer (afterRide).", {
    from: date("First day, default this Monday"),
    to: date("Last day, default two weeks on; at most 12 weeks"),
  }),
  fn("get_events", "All goal events, past and upcoming, with priority (A peak, B short taper, C train through). Events with a course carry what it demands (course), how it is ridden (pack: solo, group or bunch) and any target finish time with the FTP it takes (timeTarget)."),
  fn("get_recovery", "Today's recovery score and its reasons, and daily HRV, resting heart rate, sleep stages, breathing rate and wrist temperature, plus each day's exertion (0-10, from heart rate all day: rides and off the bike) against your normal day.", { days: { type: "integer", minimum: 1, maximum: 365, description: "Default 14" } }),
  fn("get_body", "Weigh-ins (weight, body fat, BMI) and the 30-day trend.", { days: { type: "integer", minimum: 1, maximum: 730, description: "Default 90" } }),
  fn("get_power", "Best power at standard durations over a window, watts per kg, the engine's FTP estimate, and FTP history.", {
    days: { type: "integer", minimum: 7, maximum: 730, description: "Default 90" },
  }),
  fn("get_athlete", "Settings: FTP, heart rate thresholds, weight, age, minutes available per weekday, ramp rate, and progression levels per zone."),
  fn(
    "get_day_options",
    `What a day in the next ${CHANGE_WINDOW_DAYS + 1} days could be instead, built by the engine: easier, harder, shorter, endurance, recovery or rest; on a rest day, a ride of the given length.`,
    { date: date("The day"), minutes: { type: "integer", minimum: 20, maximum: 360, description: "Time the athlete has that day, if they said" } },
    ["date"],
  ),
  fn(
    "propose_day_change",
    "Propose replacing a day's session with one of get_day_options' options. The athlete sees it with an Apply button.",
    { date: date("The day"), option_id: { type: "string" }, minutes: { type: "integer", minimum: 20, maximum: 360, description: "Same minutes you passed to get_day_options" }, reason },
    ["date", "option_id", "reason"],
  ),
  fn(
    "get_workouts",
    "The engine's workout structures (classic intervals, over-unders, surges, 30/30s, pyramids, attacks, race starts, sprints...) with what each trains and its targets at the athlete's level, with ranges. Filter by zone and/or focus.",
    {
      zone: { type: "string", enum: ["endurance", "tempo", "sweetSpot", "threshold", "vo2max", "anaerobic"] },
      focus: { type: "string", enum: [...FOCUSES] },
    },
  ),
  fn(
    "propose_workout",
    "Propose a specific workout structure on a day, from get_workouts, optionally at a level and with targets set directly. The engine builds it to fit the minutes; the athlete sees it with an Apply button.",
    {
      date: date("The day"),
      workout_id: { type: "string", description: "An id from get_workouts" },
      level: { type: "number", minimum: 1, maximum: 10, description: "Default: the athlete's level in the zone" },
      minutes: { type: "integer", minimum: 20, maximum: 360, description: "Default: the day's planned length, or 60" },
      targets: { type: "object", description: "Targets to set, by key from get_workouts: % of FTP for power targets, seconds for durations, whole numbers for counts. Others follow the level." },
      reason,
    },
    ["date", "workout_id", "reason"],
  ),
  fn("propose_swap", "Propose swapping the sessions on two days (e.g. moving intervals to a day with more time).", { date: date("One day"), other_date: date("The other day"), reason }, [
    "date",
    "other_date",
    "reason",
  ]),
  fn("propose_reset_day", "Propose putting a changed day back to the plan's session.", { date: date("The day"), reason }, ["date", "reason"]),
  fn(
    "propose_availability",
    "Propose new minutes available per weekday and/or ramp rate (fitness gain per week, 2 to 10, 5 is sustainable). The engine rebuilds the whole plan from them.",
    {
      minutes: { type: "array", items: { type: "integer", minimum: 0, maximum: 480 }, minItems: 7, maxItems: 7, description: "Monday first; under 30 is a rest day" },
      ramp_rate: { type: "number", minimum: 2, maximum: 10 },
      reason,
    },
    ["reason"],
  ),
  fn(
    "propose_break",
    "Propose adding a break: travel, vacation, illness or life getting in the way. The engine plans around it (no sessions on days off, shorter ones when time is limited, no intervals when outdoor only) and the athlete applies it.",
    {
      start: date("First day"),
      end: date("Last day"),
      kind: { type: "string", enum: ["travel", "vacation", "sick", "life"] },
      riding: { type: "string", enum: ["off", "limited", "outdoor"], description: "off: no riding. limited: up to `minutes` a day. outdoor: unstructured riding only" },
      minutes: { type: "integer", minimum: 0, maximum: 480, description: "Minutes a day, for limited" },
      note: { type: "string", description: "Short note, e.g. where or why" },
      reason,
    },
    ["start", "end", "kind", "riding", "reason"],
  ),
];

/** Saving and forgetting lasting facts. The athlete sees and can edit everything saved. */
export const MEMORY_TOOLS = [
  fn(
    "remember",
    "Save a lasting fact about the athlete for future conversations: an injury or niggle, a preference, how they respond to training, life constraints. Not numbers the app already has. One short sentence.",
    { fact: { type: "string" } },
    ["fact"],
  ),
  fn("forget", "Remove a saved fact that's no longer true, by its id from the memory list.", { id: { type: "string" } }, ["id"]),
];

/** Each tool that only makes sense while the rider tracks something. */
const FEATURE_TOOLS: Record<string, Feature> = { get_recovery: "recovery", get_body: "weight" };

/** `tools` without the ones for what the rider doesn't track. */
export function forFeatures<T extends { function: { name: string } }>(tools: T[], f: Features = ALL_FEATURES): T[] {
  return tools.filter((t) => {
    const needs = FEATURE_TOOLS[t.function.name];
    return !needs || f[needs];
  });
}

/** Tools that only read, for the weekly planning run. */
export const READ_TOOL_NAMES = ["get_rides", "get_ride", "get_fitness", "get_plan", "get_events", "get_recovery", "get_body", "get_power", "get_athlete", "get_workouts"];

/** The weekly planning run's own tool: choosing a key day's workout. */
export const PICK_TOOLS = [
  fn(
    "pick_workout",
    "Choose the workout for one of the key days you were given: a structure from get_workouts in that day's zone, optionally with targets set. The engine keeps the day's level and length and builds it.",
    {
      date: date("The key day"),
      workout_id: { type: "string", description: "An id from get_workouts, in the day's zone" },
      targets: { type: "object", description: "Targets to set, by key from get_workouts: % of FTP for power, seconds for durations, whole numbers for counts. Leave out to follow the level." },
      reason: { type: "string", description: "One sentence to the athlete: why this workout on this day" },
    },
    ["date", "workout_id", "reason"],
  ),
];

/** The brief's own tool: which of today's options to suggest. */
export const TODAY_TOOLS = [
  fn(
    "suggest_today",
    "Suggest one of today's options from todayOptions in the status. The athlete sees the options under the brief with yours marked, and chooses.",
    { option_id: { type: "string", description: "An id from todayOptions.options" } },
    ["option_id"],
  ),
];

/** The chat's own tool: offering to send feedback about Lactic itself, once in a conversation. */
export const FEEDBACK_TOOLS = [
  fn(
    "suggest_feedback",
    "Offer the athlete a button that opens Lactic's feedback form, filled in with your summary for them to edit and send. Only for Lactic itself: frustration with the app (something broken, confusing or missing) or a feature it doesn't have. Never for frustration with training, a ride or their body. At most once in a conversation.",
    {
      kind: { type: "string", enum: ["problem", "idea"], description: "problem: something in Lactic is wrong or frustrating. idea: a feature Lactic doesn't have" },
      summary: { type: "string", description: `What to tell the Lactic team, 1 to 3 sentences in the athlete's voice ("I'd like..."). It's posted publicly, so leave out health data, numbers and anything personal. At most ${MAX_FEEDBACK} characters` },
    },
    ["kind", "summary"],
  ),
];

/** Feedback the coach offers to send: the form opens filled in with it, and the athlete sends it or not. */
export interface FeedbackDraft {
  kind: "problem" | "idea";
  summary: string;
}

export type ToolResult = { content: string; proposal?: Proposal; memory?: MemoryOp; pick?: WorkoutPick; today?: OptionId; feedback?: FeedbackDraft };

/** Runs one tool call. Errors come back as text so the coach can correct itself. */
export function runTool(data: CoachData, name: string, args: Record<string, unknown>): ToolResult {
  try {
    const needs = FEATURE_TOOLS[name];
    if (needs && !(data.features ?? ALL_FEATURES)[needs]) throw new Error(`The athlete doesn't track ${FEATURE_LABELS[needs]} in Lactic (Settings → What you track)`);
    const out = (value: unknown) => ({ content: JSON.stringify(value) });
    switch (name) {
      case "get_rides":
        return out(getRides(data, args));
      case "get_ride":
        return out(getRide(data, String(args.id ?? "")));
      case "get_fitness":
        return out(getFitness(data, args));
      case "get_plan":
        return out(getPlan(data, args));
      case "get_events":
        return out(getEvents(data));
      case "get_recovery":
        return out(getRecovery(data, intArg(args.days, 14, 1, 365)));
      case "get_body":
        return out(getBody(data, intArg(args.days, 90, 1, 730)));
      case "get_power":
        return out(getPower(data, intArg(args.days, 90, 7, 730)));
      case "get_athlete":
        return out(getAthlete(data));
      case "get_day_options":
        return out(getDayOptions(data, String(args.date ?? ""), optionalInt(args.minutes)));
      case "propose_day_change":
        return propose(data, { kind: "day", date: String(args.date ?? ""), option: String(args.option_id ?? "") as never, minutes: optionalInt(args.minutes) }, args.reason);
      case "get_workouts":
        return out(getWorkouts(data, args));
      case "propose_workout": {
        const template = templateById(String(args.workout_id ?? ""));
        if (!template) throw new Error("Unknown workout_id; get ids from get_workouts");
        const level = typeof args.level === "number" ? Math.round(args.level * 10) / 10 : undefined;
        const tweaks = args.targets && typeof args.targets === "object" ? fromDisplay(template, args.targets as Record<string, unknown>) : undefined;
        return propose(data, { kind: "workout", date: String(args.date ?? ""), template: template.id, level, minutes: optionalInt(args.minutes), tweaks }, args.reason);
      }
      case "pick_workout":
        return pickWorkout(data, args);
      case "suggest_today": {
        const options = todayOptions(data.state);
        const id = String(args.option_id ?? "") as OptionId;
        if (!options) throw new Error("Today is already settled; there's nothing to suggest");
        if (!options.options.some((o) => o.id === id)) throw new Error(`option_id must be one of ${options.options.map((o) => o.id).join(", ")}`);
        return { content: JSON.stringify({ suggested: id }), today: id };
      }
      case "propose_swap":
        return propose(data, { kind: "swap", date: String(args.date ?? ""), otherDate: String(args.other_date ?? "") }, args.reason);
      case "propose_reset_day":
        return propose(data, { kind: "reset", date: String(args.date ?? "") }, args.reason);
      case "propose_availability": {
        const minutes = Array.isArray(args.minutes) ? (args.minutes.map(Number) as Availability) : undefined;
        const rampRate = typeof args.ramp_rate === "number" ? args.ramp_rate : undefined;
        if (!minutes && rampRate === undefined) throw new Error("Give minutes, ramp_rate or both");
        return propose(data, { kind: "availability", availability: minutes, rampRate }, args.reason);
      }
      case "propose_break": {
        const str = (v: unknown) => (typeof v === "string" ? v : "");
        const b = {
          start: str(args.start),
          end: str(args.end),
          kind: str(args.kind) as Break["kind"],
          riding: str(args.riding) as Break["riding"],
          minutes: typeof args.minutes === "number" ? args.minutes : null,
          note: str(args.note),
        };
        return propose(data, { kind: "break", break: b }, args.reason);
      }
      case "remember": {
        const fact = typeof args.fact === "string" ? args.fact.trim() : "";
        if (!fact) throw new Error("Give the fact to remember");
        if (fact.length > MAX_FACT) throw new Error(`Keep it under ${MAX_FACT} characters`);
        if (data.memory.some((m) => m.fact.toLowerCase() === fact.toLowerCase())) return { content: "Already saved." };
        return { content: JSON.stringify({ saved: fact }), memory: { op: "add", fact } };
      }
      case "forget": {
        const id = String(args.id ?? "");
        if (!data.memory.some((m) => m.id === id)) throw new Error("No saved fact with that id");
        return { content: JSON.stringify({ forgotten: id }), memory: { op: "remove", id } };
      }
      case "suggest_feedback": {
        const kind = args.kind === "idea" ? "idea" : args.kind === "problem" ? "problem" : null;
        if (!kind) throw new Error("kind is problem or idea");
        const summary = typeof args.summary === "string" ? args.summary.trim() : "";
        if (!summary) throw new Error("Give a summary of the feedback");
        if (summary.length > MAX_FEEDBACK) throw new Error(`Keep the summary under ${MAX_FEEDBACK} characters`);
        return {
          content: JSON.stringify({ offered: summary, note: "Shown under your reply as a Send feedback button. The form opens with this filled in; nothing is sent unless they send it. Mention it in a few words and don't offer again." }),
          feedback: { kind, summary },
        };
      }
      default:
        return { content: `Unknown tool ${name}` };
    }
  } catch (e) {
    return { content: `Error: ${e instanceof Error ? e.message : String(e)}` };
  }
}

function propose(data: CoachData, change: PlanChange, why: unknown): ToolResult {
  const effect = resolveChange(data.state, change);
  const proposal: Proposal = { change, summary: effect.summary, reason: typeof why === "string" ? why.trim().slice(0, 300) : "", status: "pending" };
  return { content: JSON.stringify({ proposed: effect.summary, note: "Shown to the athlete with an Apply button. Nothing changes until they press it." }), proposal };
}

/** The snapshot that opens every conversation turn, so simple questions need no tools. */
export function status(data: CoachData) {
  const { state } = data;
  const { athlete, today } = state;
  const tz = athlete.timezone;
  const days = state.plan.weeks.flatMap((w) => w.days);
  const week = state.plan.weeks.find((w) => w.days.some((d) => d.date === today));
  const score = state.recovery?.score;
  const last7 = state.rides.filter((r) => localDate(r.startedAt, tz) > addDays(today, -7));
  const weight = athlete.weightKg;
  const tracking = data.features ?? ALL_FEATURES;
  const weighIn = tracking.weight ? weighInOn(data.body, today, tz) : undefined;
  const off = (Object.keys(FEATURE_LABELS) as Feature[]).filter((f) => !tracking[f]);
  return {
    today: `${today} (${weekday(today)})`,
    units: unitsNote(data),
    ...(off.length
      ? { notTracked: `The athlete chose not to track ${off.map((f) => FEATURE_LABELS[f]).join(" or ")} in Lactic. Don't mention it, ask for it or wait for it; they can turn it on in Settings → What you track.` }
      : {}),
    ftp: athlete.ftp,
    weightKg: weight,
    ...lb(data, "weightLb", weight),
    wattsPerKg: athlete.ftp && weight ? round(athlete.ftp / weight, 2) : null,
    weighInToday: !tracking.weight ? undefined : weighIn ? { weightKg: round(weighIn.weightKg, 1), ...lb(data, "weightLb", weighIn.weightKg), bodyFatPercent: weighIn.bodyFatPercent === null ? null : round(weighIn.bodyFatPercent, 1) } : null,
    fitness: round(state.fitness),
    fatigue: round(state.fatigue),
    form: round(state.form),
    recovery: !tracking.recovery ? undefined : score ? { score: score.score, reasons: score.reasons } : state.recovery?.today
        ? `In for today (see recoveryToday); no score until the HRV baseline has ${MINIMUM_BASELINE_DAYS} nights (${state.recovery.baselineDays} so far)`
        : "No recovery data today",
    yesterdayExertion: tracking.recovery ? yesterdayExertion(state) : undefined,
    recoveryToday: tracking.recovery && state.recovery?.today
      ? { hrvMs: opt(state.recovery.today.hrv), restingHr: opt(state.recovery.today.restingHeartRate), sleepHours: opt(state.recovery.today.sleepHours, 1) }
      : null,
    phase: week ? `${PHASE_LABELS[week.phase]}${week.recoveryWeek ? " (recovery week)" : ""}${week.breakNote === "reentry" ? " (first week back from a break)" : ""}` : null,
    planTarget: state.plan.target ? { name: state.plan.target.name, date: state.plan.target.date } : null,
    savedPlan: planSummary(state),
    upcomingBreaks: state.breaks.filter((b) => b.end >= today).slice(0, 3).map(breakSummary),
    todaySession: describePlanDay(days.find((d) => d.date === today)),
    raceToday: raceToday(days.find((d) => d.date === today), athlete.ftp, weight),
    todayChoice: state.todayStored?.chosen ? describeSession(state.todayStored.chosen.session) : null,
    todayOptions: todayOptionsSummary(state),
    tomorrowSession: describePlanDay(days.find((d) => d.date === addDays(today, 1))),
    changedDays: state.changedDays,
    upcomingEvents: state.goals.filter((g) => g.date >= today).slice(0, 3).map((g) => ({ ...g, daysAway: daysBetween(today, g.date) })),
    recentRideFeedback: state.feedback
      .filter((f) => f.day > addDays(today, -14))
      .slice(0, 5)
      .map((f) => ({ date: f.day, ride: state.rides.find((r) => r.id === f.rideId)?.name ?? "Ride", ...feedbackSummary(f) })),
    last7Days: { rides: last7.length, hours: round(last7.reduce((s, r) => s + r.durationSeconds, 0) / 3600, 1), stress: round(last7.reduce((s, r) => s + (r.trainingStress ?? 0), 0)) },
    totalRidesOnRecord: state.rides.length,
  };
}

/** Today's event with the engine's race-day warm-up and fuelling, shown to the athlete on Today. */
function raceToday(day: PlanDay | undefined, ftp: number | null, weightKg: number | null) {
  if (day?.role !== "event" || !day.goal) return null;
  const goal = day.goal;
  const plan = raceDay(goal, ftp, weightKg);
  return {
    name: goal.name,
    kind: GOAL_KIND_LABELS[goal.kind],
    priority: goal.priority,
    startTime: goal.startTime ?? undefined,
    minutes: goalMinutes(goal),
    intensity: goalIntensity(goal),
    warmup: plan.warmup.map((s) => ({ minutes: s.minutes, what: s.label, watts: s.watts ? `${s.watts[0]}-${s.watts[1]}` : undefined })),
    carbsPerHourWhileRacing: plan.carbsPerHour,
  };
}

function getRides(data: CoachData, args: Record<string, unknown>) {
  const tz = data.state.athlete.timezone;
  const from = dateArg(args.from);
  const to = dateArg(args.to);
  const limit = intArg(args.limit, 20, 1, 100);
  const rides = data.state.rides.filter((r) => {
    const day = localDate(r.startedAt, tz);
    return (!from || day >= from) && (!to || day <= to);
  });
  return { count: rides.length, rides: rides.slice(0, limit).map((r) => ({ ...rideSummary(r, tz, data.units), afterwards: afterwards(data.state, r.id) })) };
}

function getRide(data: CoachData, id: string) {
  const tz = data.state.athlete.timezone;
  const ride = data.state.rides.find((r) => r.id === id);
  if (!ride) throw new Error("No ride with that id; get ids from get_rides");
  const day = localDate(ride.startedAt, tz);
  const stored = data.planDays.find((d) => d.activityId === ride.id);
  return {
    ...rideSummary(ride, tz, data.units),
    afterwards: afterwards(data.state, ride.id),
    bestPower: ride.powerCurve ? curveSummary(ride.powerCurve) : null,
    ftpThatDay: ftpOn(day, data.state.athlete.ftpHistory, data.state.athlete.ftp),
    riddenFor: stored ? { day: stored.day, session: describeSession(stored.chosen?.session ?? stored.planned), feltAfter: feelAfter(stored.feelAfter) } : null,
  };
}

function getFitness(data: CoachData, args: Record<string, unknown>) {
  const { today, series, plan } = data.state;
  const from = dateArg(args.from) ?? addDays(today, -42);
  const to = dateArg(args.to) ?? today;
  if (from > to) throw new Error("from is after to");
  const days = [...series.filter((d) => d.date < today), ...plan.forecast].filter((d) => d.date >= from && d.date <= to);
  const weekly = days.length > 90;
  const picked = weekly ? days.filter((_, i) => i % 7 === 0 || i === days.length - 1) : days;
  return {
    note: `Fitness and fatigue are at the end of each day; form is coming into the day. Days after ${today} are forecast.`,
    sampling: weekly ? "weekly" : "daily",
    days: picked.map((d) => ({ date: d.date, stress: round(d.stress), fitness: round(d.fitness, 1), fatigue: round(d.fatigue, 1), form: round(d.form, 1), forecast: d.date >= today || undefined })),
  };
}

function getPlan(data: CoachData, args: Record<string, unknown>) {
  const { state } = data;
  const from = dateArg(args.from) ?? state.plan.weeks[0]?.start ?? state.today;
  const to = dateArg(args.to) ?? addDays(from, 13);
  if (from > to) throw new Error("from is after to");
  if (to > addDays(from, 12 * 7)) throw new Error("At most 12 weeks at a time");
  const stored = new Map(data.planDays.map((d) => [d.day, d]));
  const weeks = state.plan.weeks.filter((w) => addDays(w.start, 6) >= from && w.start <= to);
  const raceDay = state.plan.target ? state.plan.forecast.find((d) => d.date === state.plan.target!.date) : null;
  const past = from < (state.plan.weeks[0]?.start ?? state.today) ? pastDays(data, from, to) : [];
  return {
    target: state.plan.target ? { name: state.plan.target.name, date: state.plan.target.date, forecastFitness: raceDay ? round(raceDay.fitness) : null, forecastForm: raceDay ? round(raceDay.form) : null } : null,
    earlierDays: past.length ? past : undefined,
    weeks: weeks.map((w) => ({
      start: w.start,
      phase: PHASE_LABELS[w.phase],
      recoveryWeek: w.recoveryWeek,
      breakNote: w.breakNote === "break" ? "Mostly off for a break" : w.breakNote === "reentry" ? "First week back from a break" : undefined,
      targetStress: w.target,
      plannedStress: w.stress,
      days: w.days
        .filter((d) => d.date >= from && d.date <= to)
        .map((d) => {
          const s = stored.get(d.date);
          const ridden = d.date <= state.today ? ridesFor(state, d.date).map((r) => rideLine(r)) : [];
          return {
            date: d.date,
            weekday: weekday(d.date),
            role: d.role,
            break: d.break ? breakSummary(d.break) : undefined,
            session: d.date < state.today ? describeSession(s?.chosen?.session ?? s?.planned ?? null) : describePlanDay(d),
            changedByAthlete: state.changedDays.includes(d.date) || undefined,
            ridden: ridden.length ? ridden : undefined,
            checkin: s?.checkin ? checkinSummary(s) : undefined,
            feltAfter: feelAfter(s?.feelAfter ?? null),
            afterRide: dayFeedback(state, d.date),
          };
        }),
    })),
  };
}

/** The saved plan in force, if any: its goal, dates and where today falls in it. */
function planSummary(state: TrainingState) {
  const p = state.activePlan;
  if (!p) return null;
  const event = p.goal === "event" ? state.goals.find((g) => g.id === p.goalId) : undefined;
  const weeks = Math.floor(daysBetween(p.start, p.end) / 7) + 1;
  const week = state.today >= p.start ? Math.floor(daysBetween(p.start, state.today) / 7) + 1 : null;
  const end = state.plan.forecast[state.plan.forecast.length - 1];
  return {
    name: p.name,
    goal: PLAN_GOAL_LABELS[p.goal],
    event: event ? { name: event.name, date: event.date } : undefined,
    target: p.target ? { value: p.target, unit: p.goal === "ftp" ? "watts FTP" : "fitness (CTL)" } : undefined,
    start: p.start,
    end: p.end,
    weekOfPlan: week ? `${week} of ${weeks}` : `starts in ${daysBetween(state.today, p.start)} days`,
    forecastFitnessAtEnd: end ? round(end.fitness) : null,
  };
}

const breakSummary = (b: Break) => ({
  start: b.start,
  end: b.end,
  kind: BREAK_KIND_LABELS[b.kind],
  riding: b.riding === "limited" ? `${BREAK_RIDING_LABELS.limited}, up to ${b.minutes} min a day` : BREAK_RIDING_LABELS[b.riding],
  note: b.note || undefined,
});

/** Days before this week's plan: what was stored for them and what was ridden. */
function pastDays(data: CoachData, from: string, to: string) {
  const first = data.state.plan.weeks[0]?.start ?? data.state.today;
  const out = [];
  for (let d = from; d < first && d <= to; d = addDays(d, 1)) {
    const s = data.planDays.find((p) => p.day === d);
    const ridden = ridesFor(data.state, d).map((r) => rideLine(r));
    if (!s && !ridden.length) continue;
    out.push({
      date: d,
      weekday: weekday(d),
      session: s ? describeSession(s.chosen?.session ?? s.planned) : undefined,
      ridden: ridden.length ? ridden : undefined,
      checkin: s?.checkin ? checkinSummary(s) : undefined,
      feltAfter: feelAfter(s?.feelAfter ?? null),
      afterRide: dayFeedback(data.state, d),
    });
  }
  return out;
}

function getEvents(data: CoachData) {
  const { today, goals } = data.state;
  return { events: goals.map((g) => ({ ...g, daysAway: daysBetween(today, g.date), past: g.date < today || undefined })) };
}

/** Yesterday's whole-day exertion for the status, or null without heart rate for it. */
function yesterdayExertion(state: CoachData["state"]) {
  const d = state.exertion?.days.find((e) => e.day === addDays(state.today, -1));
  if (!d) return null;
  const normal = state.exertion?.normal;
  return {
    exertion: d.exertion,
    onTheBike: d.rideTrimp,
    offTheBike: d.offBikeTrimp,
    normalDay: normal ? round(normal.mean, 1) : null,
    note: d.coveredMinutes < MIN_COVERED_MINUTES ? "Only rides counted: little watch heart rate that day" : undefined,
  };
}

function getRecovery(data: CoachData, days: number) {
  const { state } = data;
  const since = addDays(state.today, -days + 1);
  const exertionByDay = new Map((state.exertion?.days ?? []).map((d) => [d.day, d]));
  const score = state.recovery?.score;
  return {
    today: score
      ? { score: score.score, reasons: score.reasons }
      : { score: null, note: state.recovery ? `Building the HRV baseline (${state.recovery.baselineDays} days so far)` : "Recovery data failed to load" },
    source: "Apple Health via a shortcut (HRV, resting heart rate, sleep with stages, breathing rate, sleeping wrist temperature).",
    days: data.recoveryDays
      .filter((d) => d.day >= since)
      .map((d) => {
        const h = (v: number | null | undefined) => (v === null || v === undefined ? undefined : round(v, 1));
        return {
          date: d.day,
          hrvMs: d.hrvMs === null ? null : round(d.hrvMs),
          hrvKind: d.hrvKind,
          restingHr: d.restingHr === null ? null : round(d.restingHr),
          sleepHours: d.sleepHours === null ? null : round(d.sleepHours, 1),
          deepHours: h(d.deepHours),
          remHours: h(d.remHours),
          awakeHours: h(d.awakeHours),
          breathsPerMin: h(d.respiratoryRate),
          wristTempC: d.wristTempC === null || d.wristTempC === undefined ? undefined : round(d.wristTempC, 2),
          wristTempF: imperial(data) && d.wristTempC != null ? round((d.wristTempC * 9) / 5 + 32, 1) : undefined,
          // That day's exertion (the night before is in the same row's sleep).
          exertion: exertionByDay.get(d.day)?.exertion,
        };
      }),
    exertion: {
      about: "0 to 10 from Banister TRIMP over the whole day's heart rate (Apple Watch, with ride chest-strap HR inside rides). TRIMP split into on and off the bike.",
      normalDay: state.exertion?.normal ? round(state.exertion.normal.mean, 1) : null,
      yesterday: yesterdayExertion(state),
    },
  };
}

function getBody(data: CoachData, days: number) {
  const now = new Date();
  const since = now.getTime() - days * 86_400_000;
  const trend = bodyTrend(data.body, now);
  const tz = data.state.athlete.timezone;
  return {
    currentWeightKg: data.state.athlete.weightKg,
    ...lb(data, "currentWeightLb", data.state.athlete.weightKg),
    trend30Days: { weightKg: trend.weightKg === null ? null : round(trend.weightKg, 1), ...lb(data, "weightLb", trend.weightKg), bodyFatPercent: trend.bodyFatPercent === null ? null : round(trend.bodyFatPercent, 1) },
    weighIns: data.body
      .filter((b) => b.measuredAt.getTime() >= since)
      .map((b) => ({ date: localDate(b.measuredAt, tz), weightKg: round(b.weightKg, 1), ...lb(data, "weightLb", b.weightKg), bodyFatPercent: b.bodyFatPercent === null ? null : round(b.bodyFatPercent, 1), bmi: b.bmi })),
  };
}

function getPower(data: CoachData, days: number) {
  const { state } = data;
  const tz = state.athlete.timezone;
  const since = addDays(state.today, -days);
  const curves = state.rides.filter((r) => r.powerCurve && localDate(r.startedAt, tz) >= since).map((r) => r.powerCurve!);
  const merged = curves.length ? mergeCurves(...curves) : null;
  const estimate = merged ? estimateFtp(merged) : null;
  const weight = state.athlete.weightKg;
  return {
    window: `${since} to ${state.today}, ${curves.length} rides with power`,
    bestPower: merged ? curveSummary(merged, weight) : null,
    ftpEstimate: estimate ? { watts: round(estimate.watts), method: estimate.method, wPrimeKj: estimate.wPrime ? round(estimate.wPrime / 1000, 1) : undefined } : null,
    currentFtp: state.athlete.ftp,
    ftpHistory: state.athlete.ftpHistory,
  };
}

function getAthlete(data: CoachData) {
  const a = data.state.athlete;
  return {
    ftp: a.ftp,
    thresholdHr: a.thresholdHr,
    maxHr: a.maxHr,
    weightKg: a.weightKg,
    ...lb(data, "weightLb", a.weightKg),
    heightCm: a.heightCm,
    ...(imperial(data) && a.heightCm !== null ? { heightIn: round(a.heightCm / CM_PER_IN, 1) } : {}),
    age: a.birthDate ? ageOn(a.birthDate, data.state.today) : null,
    sex: a.sex,
    timezone: a.timezone,
    minutesPerWeekday: Object.fromEntries(WEEKDAYS.map((d, i) => [d, a.availability[i]])),
    hoursPerWeek: round(a.availability.reduce((x, y) => x + y, 0) / 60, 1),
    rampRate: a.rampRate,
    levels: Object.fromEntries(Object.entries(data.state.levels).map(([zone, level]) => [ZONE_LABELS[zone as keyof typeof ZONE_LABELS] ?? zone, level])),
    levelsNote: "Progression levels 1 to 10 per zone; the plan's workouts are built at these levels.",
  };
}

function getDayOptions(data: CoachData, date: string, minutes?: number) {
  const day = data.state.plan.weeks.flatMap((w) => w.days).find((d) => d.date === date);
  if (!day) throw new Error(`${date} isn't in the plan`);
  if (date < data.state.today || date > addDays(data.state.today, CHANGE_WINDOW_DAYS)) throw new Error(`Pick a day from ${data.state.today} to ${addDays(data.state.today, CHANGE_WINDOW_DAYS)}`);
  if (day.role === "event") throw new Error("That's an event day");
  return {
    date,
    current: describePlanDay(day),
    options: dayOptions(day.session, data.state.levels, minutes).map((o) => ({ id: o.id, label: o.label, session: describeSession(o.session) })),
  };
}

function rideSummary(r: StoredRide, tz: string, units?: UnitSystem) {
  return {
    id: r.id,
    date: localDate(r.startedAt, tz),
    start: r.startedAt.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: tz }),
    name: r.name ?? "Ride",
    source: r.source,
    minutes: Math.round(r.durationSeconds / 60),
    km: r.distanceMeters === null ? null : round(r.distanceMeters / 1000, 1),
    ...(units === "imperial" && r.distanceMeters !== null ? { miles: round(r.distanceMeters / M_PER_MILE, 1) } : {}),
    averageWatts: r.averagePower === null ? null : round(r.averagePower),
    normalizedWatts: r.normalizedPower === null ? null : round(r.normalizedPower),
    intensityFactor: r.intensityFactor === null ? null : round(r.intensityFactor, 2),
    stress: r.trainingStress === null ? null : round(r.trainingStress),
    stressFrom: r.stressMethod,
    averageHr: r.averageHr === null ? null : round(r.averageHr),
  };
}

/** The rides that count for a day: ridden that day unless linked to another plan day, or linked to it (as training.ts ridesFor). */
const ridesFor = (state: TrainingState, day: string) =>
  state.rides.filter((r) => (state.rideLinks?.get(r.id) ?? localDate(r.startedAt, state.athlete.timezone)) === day);

const rideLine = (r: StoredRide) => `${r.name ?? "Ride"}, ${Math.round(r.durationSeconds / 60)} min${r.trainingStress !== null ? `, ${Math.round(r.trainingStress)} TSS` : ""}`;

function curveSummary(curve: PowerCurve, weightKg?: number | null) {
  return Object.entries(CURVE_LABELS).flatMap(([seconds, label]) => {
    const watts = curve[Number(seconds)];
    if (watts === undefined) return [];
    return [{ duration: label, watts: round(watts), wattsPerKg: weightKg ? round(watts / weightKg, 2) : undefined }];
  });
}

/** Today's options for the brief, with how the athlete said they feel when they've checked in. */
function todayOptionsSummary(state: TrainingState) {
  const result = todayOptions(state);
  if (!result) return null;
  const c = state.todayStored?.checkin;
  return {
    checkin: c ? { felt: FEEL_LABELS[c.feel as Feel] ?? c.feel, sick: c.sick || undefined, minutesAvailable: c.minutes ?? undefined, note: c.notes || undefined } : "Not yet",
    ...describeOptions(result),
  };
}

/** Options as the model sees them: ids, labels and the engine's numbers for each. */
function describeOptions(result: CheckinResult) {
  return {
    recommended: result.recommended,
    reasons: result.reasons,
    options: result.options.map((o) => ({ id: o.id, label: o.label, ...(o.session ? sessionInfo(o.session) : { workout: "Rest" }) })),
  };
}

function checkinSummary(s: StoredPlanDay) {
  const c = s.checkin!;
  return {
    felt: FEEL_LABELS[c.feel as Feel] ?? c.feel,
    sick: c.sick || undefined,
    minutesAvailable: c.minutes ?? undefined,
    note: c.notes || undefined,
    recovery: c.recovery,
    engineSuggested: c.recommended,
    coachSaid: c.coach?.message,
    chose: s.chosen ? `${s.chosen.option}: ${describeSession(s.chosen.session)}` : undefined,
  };
}

function describePlanDay(day: PlanDay | undefined) {
  if (!day) return null;
  return day.role === "event" || !day.session ? describeDay(day) : {
        ...sessionInfo(day.session),
        role: day.role,
        whyThisWorkout: day.why,
        easedBy: day.rule ? `${SAFETY_RULE_LABELS[day.rule]}: ${SAFETY_RULE_NOTES[day.rule]}` : undefined,
        movedFrom: day.movedFrom ? `${day.movedFrom.date} (missed there, moved here by the plan${day.movedFrom.shortened ? ", shortened to fit" : ""})` : undefined,
      };
}

const describeSession = (session: Session | null) => (session ? sessionInfo(session) : "Rest");

function sessionInfo(session: Session) {
  return {
    workout: session.workout.name,
    zone: ZONE_LABELS[session.zone] ?? session.zone,
    level: session.level,
    minutes: Math.round(session.duration / 60),
    stress: Math.round(session.stress),
    structure: session.template,
    targetsSet: session.tweaks && Object.keys(session.tweaks).length ? toDisplay(templateById(session.template), session.tweaks) : undefined,
  };
}

/** A key day's workout from the weekly planning run, checked and built by the engine before it's kept. */
function pickWorkout(data: CoachData, args: Record<string, unknown>): ToolResult {
  const date = String(args.date ?? "");
  const template = templateById(String(args.workout_id ?? ""));
  if (!template) throw new Error("Unknown workout_id; get ids from get_workouts");
  const day = data.state.basePlan.weeks.flatMap((w) => w.days).find((d) => d.date === date);
  if (!day || day.role !== "key" || !day.session) throw new Error(`${date} isn't one of the key days to plan`);
  if (!pickFits(day, template.id)) throw new Error(`${date} trains ${ZONE_LABELS[day.session.zone]}; pick a ${ZONE_LABELS[day.session.zone]} workout`);
  const tweaks = checkTweaks(template, args.targets && typeof args.targets === "object" ? fromDisplay(template, args.targets as Record<string, unknown>) : {});
  const session = buildSession(day.session.zone, day.session.level, day.session.duration, { template: template.id, tweaks });
  if (session.template !== template.id) throw new Error(`${template.name} doesn't fit in ${Math.round(day.session.duration / 60)} minutes with those targets; use shorter efforts or another workout`);
  const reason = typeof args.reason === "string" ? args.reason.trim().slice(0, 300) : "";
  if (!reason) throw new Error("Give a reason for the athlete");
  return {
    content: JSON.stringify({ picked: describeDay({ ...day, session, stress: session.stress }) }),
    pick: { date, template: template.id, tweaks: Object.keys(tweaks).length ? tweaks : undefined, reason },
  };
}

/** Structures with their targets at the athlete's level in the zone, as the coach reads them. */
function getWorkouts(data: CoachData, args: Record<string, unknown>) {
  const zone = typeof args.zone === "string" && (ZONES as readonly string[]).includes(args.zone) ? (args.zone as Zone) : null;
  const focus = typeof args.focus === "string" && (FOCUSES as readonly string[]).includes(args.focus) ? (args.focus as Focus) : null;
  const list = TEMPLATES.filter((t) => (!zone || t.zone === zone) && (!focus || t.focus.includes(focus)));
  return {
    note: "Targets are at the athlete's level in the zone; a different level moves them. Power targets are % of FTP. Set any with propose_workout's targets.",
    workouts: list.map((t) => {
      const level = data.state.levels[t.zone];
      const values = t.defaults(level);
      return {
        id: t.id,
        zone: ZONE_LABELS[t.zone],
        name: t.name,
        trains: t.focus.map((f) => FOCUS_LABELS[f]).join("; "),
        about: t.description,
        level,
        targets: Object.fromEntries(t.params.map((p) => [p.key, `${p.label}: ${display(p, values[p.key])} (${display(p, p.min)} to ${display(p, p.max)})`])),
      };
    }),
  };
}

function display(p: Param, value: number) {
  if (p.unit === "ftp") return `${Math.round(value * 100)}%`;
  if (p.unit === "seconds") return `${Math.round(value)} s`;
  return String(Math.round(value));
}

const toDisplay = (template: Template | null, params: Params) =>
  Object.fromEntries(Object.entries(params).map(([key, value]) => {
    const p = template?.params.find((x) => x.key === key);
    return [key, p ? display(p, value) : value];
  }));

/** Targets as the coach gives them (% of FTP for power) in the engine's units; checked again when the change is worked out. */
function fromDisplay(template: Template, targets: Record<string, unknown>): Params {
  const out: Params = {};
  for (const [key, raw] of Object.entries(targets)) {
    const value = typeof raw === "number" ? raw : Number(String(raw).replace(/[%s ]/g, ""));
    const p = template.params.find((x) => x.key === key);
    out[key] = p?.unit === "ftp" ? value / 100 : value;
  }
  return out;
}

const feelAfter = (feel: number | null) => (feel ? FEEL_AFTER_LABELS[feel - 1] : undefined);

/** The post-ride survey answer, as the coaches read it. */
export const feedbackSummary = (f: StoredFeedback) => ({ difficulty: DIFFICULTY_LABELS[f.difficulty], rpe: f.rpe ?? undefined, note: f.note || undefined });

function dayFeedback(state: TrainingState, day: string) {
  const answers = state.feedback.filter((f) => f.day === day).map(feedbackSummary);
  return answers.length ? answers : undefined;
}

function afterwards(state: TrainingState, rideId: string) {
  const answer = state.feedback.find((f) => f.rideId === rideId);
  return answer ? feedbackSummary(answer) : undefined;
}
const weekday = (date: string) => WEEKDAYS[(new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7];
const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
const opt = (value: number | undefined, digits = 0) => (value === undefined ? null : round(value, digits));
const round = (value: number, digits = 0) => Math.round(value * 10 ** digits) / 10 ** digits;

const imperial = (data: CoachData) => data.units === "imperial";

/** A pound copy of a kilo value for imperial riders, so the coach quotes it rather than converting. */
function lb(data: CoachData, key: string, kg: number | null | undefined): Record<string, number> {
  return imperial(data) && kg != null ? { [key]: round(kg * LB_PER_KG, 1) } : {};
}

function unitsNote(data: CoachData) {
  return imperial(data)
    ? "imperial: say weights in lb, heights in inches, distances in miles and temperatures in °F, quoting the weightLb, heightIn, miles and wristTempF fields. Power stays W and W/kg."
    : "metric: kg, cm, km and °C. Power in W and W/kg.";
}

function dateArg(value: unknown): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string" || !/^\d{4}-\d\d-\d\d$/.test(value)) throw new Error("Dates look like YYYY-MM-DD");
  return value;
}

function intArg(value: unknown, fallback: number, min: number, max: number): number {
  const n = Number(value);
  return value === undefined || value === null || !Number.isFinite(n) ? fallback : Math.round(Math.min(Math.max(n, min), max));
}

function optionalInt(value: unknown): number | undefined {
  const n = Number(value);
  return value === undefined || value === null || !Number.isFinite(n) ? undefined : Math.round(n);
}
