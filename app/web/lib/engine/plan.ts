// Goal-based training plans: phases back from the target event, a weekly load that ramps from your
// current fitness, and sessions laid out over the days you can ride. Computed fresh from today's
// fitness and levels each time, so it adapts as rides come in rather than going stale.

import { buildSession, INTERVAL_ZONES, openers, rampTest, ZONE_LABELS, type Levels, type Session, type Zone, MAX_LEVEL, MIN_LEVEL } from "./library";
import { addDays, fitnessSeries, type FitnessDay } from "./pmc";
import { pickTemplate, type Focus } from "./templates";
import { libraryFits, librarySession } from "./workout-library";

export const GOAL_KINDS = ["roadRace", "criterium", "cyclocross", "mountainBike", "track", "timeTrial", "gravel", "granFondo", "hillClimb"] as const;
export type GoalKind = (typeof GOAL_KINDS)[number];

export const GOAL_KIND_LABELS: Record<GoalKind, string> = {
  roadRace: "Road race",
  criterium: "Criterium",
  cyclocross: "Cyclocross",
  mountainBike: "Mountain bike race",
  track: "Track",
  timeTrial: "Time trial",
  gravel: "Gravel race",
  granFondo: "Gran fondo or century",
  hillClimb: "Hill climb",
};

/** How hard the event is ridden, overall. */
export const INTENSITIES = ["easy", "moderate", "hard", "max"] as const;
export type Intensity = (typeof INTENSITIES)[number];

export const INTENSITY_LABELS: Record<Intensity, string> = {
  easy: "Easy: social pace",
  moderate: "Moderate: steady, some hard bits",
  hard: "Hard: racing for most of it",
  max: "Max: flat out start to finish",
};

/** How the effort is shaped: steady pressure, a mix, or repeated surges. */
const PATTERN: Record<GoalKind, "steady" | "mixed" | "surgy"> = {
  roadRace: "mixed",
  criterium: "surgy",
  cyclocross: "surgy",
  mountainBike: "mixed",
  track: "surgy",
  timeTrial: "steady",
  gravel: "mixed",
  granFondo: "steady",
  hillClimb: "steady",
};

/** What the event form starts with for each kind. */
export const KIND_DEFAULTS: Record<GoalKind, { minutes: number; intensity: Intensity }> = {
  roadRace: { minutes: 180, intensity: "hard" },
  criterium: { minutes: 60, intensity: "max" },
  cyclocross: { minutes: 50, intensity: "max" },
  mountainBike: { minutes: 90, intensity: "hard" },
  track: { minutes: 30, intensity: "max" },
  timeTrial: { minutes: 40, intensity: "max" },
  gravel: { minutes: 300, intensity: "moderate" },
  granFondo: { minutes: 300, intensity: "moderate" },
  hillClimb: { minutes: 25, intensity: "max" },
};

/** A: the event the plan peaks for. B: a mini taper around it. C: ridden through as training. */
export type Priority = "A" | "B" | "C";

export interface Goal {
  id: string;
  name: string;
  /** YYYY-MM-DD. */
  date: string;
  priority: Priority;
  kind: GoalKind;
  /** Expected riding time; the kind's default when not given. */
  minutes?: number | null;
  intensity?: Intensity | null;
  /** Local start time, "HH:MM", once set. */
  startTime?: string | null;
}

export const goalMinutes = (g: Goal) => g.minutes ?? KIND_DEFAULTS[g.kind].minutes;
export const goalIntensity = (g: Goal) => g.intensity ?? KIND_DEFAULTS[g.kind].intensity;

/** Intensity factor for an event's stress estimate. Long events can't be held as high, so it eases with time. */
const EVENT_IF: Record<Intensity, number> = { easy: 0.65, moderate: 0.75, hard: 0.85, max: 0.95 };

/** Estimated training stress of an event: hours x IF^2 x 100. */
export function eventStress(goal: Goal): number {
  const hours = goalMinutes(goal) / 60;
  const factor = EVENT_IF[goalIntensity(goal)] - Math.max(0, hours - 1) * 0.03;
  return Math.round(hours * Math.max(factor, 0.6) ** 2 * 100);
}

/**
 * Key-session zones for the last weeks before an event, from how it's ridden. Surges (crits,
 * cyclocross) train VO2 max and anaerobic efforts; short steady events threshold and VO2 max;
 * long events sweet spot and threshold, or tempo if they're ridden easy.
 */
export function specialtyZones(goal: Goal): Zone[] {
  const minutes = goalMinutes(goal);
  const intensity = goalIntensity(goal);
  const hard = intensity === "hard" || intensity === "max";
  switch (PATTERN[goal.kind]) {
    case "surgy":
      return hard ? ["vo2max", "anaerobic"] : ["threshold", "vo2max"];
    case "steady":
      if (minutes <= 30) return ["vo2max", "threshold"];
      if (minutes <= 75) return ["threshold", "sweetSpot"];
      return hard ? ["sweetSpot", "threshold"] : ["tempo", "sweetSpot"];
    case "mixed":
      if (minutes <= 120) return hard ? ["vo2max", "threshold"] : ["threshold", "sweetSpot"];
      return hard ? ["threshold", "vo2max"] : ["sweetSpot", "threshold"];
  }
}

/**
 * Workout structures a phase favors: steady and building efforts in base, every structure in build,
 * and in specialty and taper the ones that ride like the event (surges for crits and cyclocross,
 * sustained for time trials and climbs, a mix for road and gravel).
 */
export function phaseFocus(phase: Phase, target: Goal | null): Focus[] {
  if (phase === "base") return ["sustained", "progressive"];
  if (!target || phase === "build" || phase === "test") return [];
  switch (PATTERN[target.kind]) {
    case "surgy":
      return ["surges", "raceSim", "repeatability", "hardStart", "sprint"];
    case "steady":
      return ["sustained", "progressive", "overUnder"];
    case "mixed":
      return ["overUnder", "hardStart", "surges", "repeatability"];
  }
}

/** How a week picks its key workouts: the structures its phase favors, and the rider's favorite library workouts. */
interface Picking {
  focus: Focus[];
  favorites: readonly string[];
}

/**
 * A key session in `zone`: one of your favorite library workouts when one fits the slot and level,
 * else a structure that rotates week to week (`slot` spreads a week's key days). Favorites rotate the same way.
 */
function keySession(zone: Zone, level: number, seconds: number, prefer: Picking, week: string, slot: number): Session {
  const seed = Math.floor(daysBetween("2024-01-01", week) / 7) + slot;
  const favorites = prefer.favorites.length ? libraryFits(zone, level, seconds, prefer.favorites) : [];
  if (favorites.length) return librarySession(favorites[seed % favorites.length]);
  if (zone === "endurance" || zone === "recovery") return buildSession(zone, level, seconds);
  return buildSession(zone, level, seconds, { template: pickTemplate(zone, prefer.focus, seed).id });
}

export type Phase = "base" | "build" | "specialty" | "taper" | "test";

export const PHASE_LABELS: Record<Phase, string> = { base: "Base", build: "Build", specialty: "Specialty", taper: "Taper", test: "Test" };

/**
 * What a saved plan works toward. event: peak for one of your events. ftp: build, then test FTP in
 * the last week. fitness: raise fitness (CTL) by the end date. base: steady base with no peak.
 */
export const PLAN_GOALS = ["event", "ftp", "fitness", "base"] as const;
export type PlanGoal = (typeof PLAN_GOALS)[number];

export const PLAN_GOAL_LABELS: Record<PlanGoal, string> = {
  event: "Peak for an event",
  ftp: "Raise FTP",
  fitness: "Build fitness",
  base: "Base and maintain",
};

/** A plan you saved: its frame plus a name. */
export interface SavedPlan extends PlanFrame {
  id: string;
  name: string;
}

/** The plan that applies today: the one running now, else the next one to start. */
export function currentPlan(plans: SavedPlan[], today: string): SavedPlan | null {
  const sorted = [...plans].sort((a, b) => a.start.localeCompare(b.start));
  return sorted.find((p) => p.start <= today && today <= p.end) ?? sorted.find((p) => p.start > today) ?? null;
}

/** Plans that share any day with [start, end], other than `exceptId`. */
export function overlappingPlans(plans: SavedPlan[], start: string, end: string, exceptId?: string): SavedPlan[] {
  return plans.filter((p) => p.id !== exceptId && p.start <= end && start <= p.end);
}

/** The frame of a saved plan: the engine fills in its sessions. */
export interface PlanFrame {
  /** YYYY-MM-DD, inclusive. For an event goal the end is the event's date. */
  start: string;
  end: string;
  goal: PlanGoal;
  /** The event to peak for, when the goal is event. */
  goalId?: string | null;
  /** FTP watts for ftp, fitness (CTL) for fitness. Informational: the plan reports how close it gets. */
  target?: number | null;
}

/** Minutes available per weekday, Monday first. Under 30 means a rest day. */
export type Availability = [number, number, number, number, number, number, number];

export const DEFAULT_AVAILABILITY: Availability = [0, 60, 60, 60, 0, 120, 90];

export const MIN_SESSION_MINUTES = 30;

/** Time away from normal training. off: no riding. limited: up to `minutes` a day. outdoor: unstructured riding, no intervals. */
export const BREAK_KINDS = ["travel", "vacation", "sick", "life"] as const;
export type BreakKind = (typeof BREAK_KINDS)[number];
export const BREAK_KIND_LABELS: Record<BreakKind, string> = { travel: "Travel", vacation: "Vacation", sick: "Sick or injured", life: "Life" };
export const BREAK_RIDING = ["off", "limited", "outdoor"] as const;
export type BreakRiding = (typeof BREAK_RIDING)[number];
export const BREAK_RIDING_LABELS: Record<BreakRiding, string> = { off: "Off the bike", limited: "Limited time", outdoor: "Outdoor riding only" };

export interface Break {
  id: string;
  /** YYYY-MM-DD, inclusive. */
  start: string;
  end: string;
  kind: BreakKind;
  riding: BreakRiding;
  /** Minutes a day, for limited. */
  minutes?: number | null;
  note?: string;
}

/** Days off the bike in a week that make it a recovery week, and in a row that call for a re-entry week after. */
const BREAK_RECOVERY_DAYS = 4;
const REENTRY_DAYS = 7;

export type DayRole = "key" | "long" | "easy" | "openers" | "test" | "event" | "rest";

export interface PlanDay {
  /** YYYY-MM-DD. */
  date: string;
  role: DayRole;
  session: Session | null;
  /** The event on this day, if any. */
  goal?: Goal;
  /** Planned stress, including an estimate for events. */
  stress: number;
  /** The break this day falls in, if any. */
  break?: Break;
  /** The coach's reason for this day's workout, when it picked it (picks.ts). */
  why?: string;
  /** A key session missed earlier in the week and moved here (adapt.ts): the day it was planned for, and whether it was shortened to fit. */
  movedFrom?: { date: string; shortened: boolean };
  /** A missed key session that moved to a later day this week: that day, and the session as it was planned here. */
  movedTo?: { date: string; session: Session };
}

export interface PlanWeek {
  /** Monday, YYYY-MM-DD. */
  start: string;
  phase: Phase;
  recoveryWeek: boolean;
  /** Why the week is lighter than its phase: a break in it, or the first week back after one. */
  breakNote?: "break" | "reentry";
  /** A week before a saved plan starts: its days are left open, apart from your events. */
  beforePlan?: true;
  /** Weekly stress the week was built toward. */
  target: number;
  stress: number;
  days: PlanDay[];
}

export interface PlanInput {
  /** YYYY-MM-DD in the athlete's time zone. */
  today: string;
  goals: Goal[];
  availability: Availability;
  /** Fitness and fatigue at the end of yesterday. */
  fitness: number;
  fatigue: number;
  levels: Levels;
  /** Fitness gain per week the plan aims for in load weeks. 5 is a sustainable default; 8 is aggressive. */
  rampRate?: number;
  /** Weeks to plan when there's no A event ahead. */
  horizonWeeks?: number;
  /** A saved plan's dates and goal. Without one, the plan runs from this week to the next A event. */
  frame?: PlanFrame | null;
  /** Scheduled time away. */
  breaks?: Break[];
  /** Starter library workouts the rider favorited (ids): key days use one when it fits. */
  favorites?: readonly string[];
}

export interface Plan {
  /** The A event the plan peaks for, if any. */
  target: Goal | null;
  /** The saved plan's frame, when there is one. */
  frame: PlanFrame | null;
  weeks: PlanWeek[];
  /** Fitness, fatigue and form from today to the end of the plan, if every session is ridden. */
  forecast: FitnessDay[];
}

export const DEFAULT_RAMP_RATE = 5;
const MAX_WEEKS = 52;

/** Interval zones for key sessions in base and build; specialty and taper follow the event. */
const KEY_ZONES: Record<"base" | "build", Zone[]> = {
  base: ["sweetSpot", "tempo"],
  build: ["threshold", "vo2max"],
};

/** Longest planned key session, in minutes; longer days are easier riding. */
const KEY_CAP_MINUTES: Record<Zone, number> = { recovery: 60, endurance: 300, tempo: 120, sweetSpot: 105, threshold: 90, vo2max: 75, anaerobic: 60 };

/** Splits the weeks before the event week (the taper) into base, build and specialty. */
export function phaseLengths(weeksBeforeTaper: number): { base: number; build: number; specialty: number } {
  const r = Math.max(0, weeksBeforeTaper);
  if (r <= 2) return { base: 0, build: 0, specialty: r };
  const specialty = Math.min(4, Math.round(r * 0.25));
  const build = Math.min(8, Math.round((r - specialty) * 0.6));
  return { base: r - specialty - build, build, specialty };
}

/** Monday of the week containing `date`. */
export function weekStart(date: string): string {
  const weekday = (new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7;
  return addDays(date, -weekday);
}

const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

export function buildPlan(input: PlanInput): Plan {
  const { today, availability } = input;
  const rampRate = input.rampRate ?? DEFAULT_RAMP_RATE;
  const favorites = input.favorites ?? [];
  const frame = input.frame ?? null;
  const upcoming = input.goals.filter((g) => g.date >= today).sort((a, b) => a.date.localeCompare(b.date));
  const thisWeek = weekStart(today);
  const schedule = frame ? framedSchedule(frame, input.goals) : unframedSchedule(today, upcoming, input.horizonWeeks ?? 6);
  const { target } = schedule;
  if (schedule.end < today) return { target, frame, weeks: [], forecast: [] };
  // Always from this week, so events before a saved plan starts still show on their days.
  const firstWeek = thisWeek;
  const weekCount = Math.min(MAX_WEEKS, daysBetween(firstWeek, weekStart(schedule.end)) / 7 + 1);

  const levels = { ...input.levels };
  let fitness = input.fitness;
  let fatigue = input.fatigue;
  const weeks: PlanWeek[] = [];
  const forecastStress: Record<string, number> = {};

  const breaks = input.breaks ?? [];
  // A break that makes a week a recovery week also covers a scheduled one in the next two weeks.
  let lastBreakRecovery = -Infinity;

  for (let w = 0; w < weekCount; w++) {
    const start = addDays(firstWeek, 7 * w);
    const scheduled = schedule.weekAt(start);
    const { phase } = scheduled;
    const week = weekAvailability(start, availability, breaks);
    const breakNote = week.daysOff >= BREAK_RECOVERY_DAYS ? "break" : reentryWeek(start, breaks) ? "reentry" : undefined;
    let recoveryWeek = scheduled.recoveryWeek;
    if (breakNote && (phase === "base" || phase === "build")) {
      recoveryWeek = true;
      if (breakNote === "break") lastBreakRecovery = w;
    } else if (recoveryWeek && w - lastBreakRecovery <= 2) recoveryWeek = false;
    const weekAvail = week.availability;
    const weekGoals = upcoming.filter((g) => g.date >= start && g.date <= addDays(start, 6) && g.date <= schedule.end);
    const zones = (phase === "specialty" || phase === "taper") && target ? specialtyZones(target) : KEY_ZONES[phase === "base" ? "base" : "build"];
    // Long events need long rides: from build on, the long ride works toward three quarters of the event's time.
    const longFloor = target && (phase === "build" || phase === "specialty") ? goalMinutes(target) * 0.75 : 60;

    const steadyWeek = 7 * fitness;
    const weekTarget =
      phase === "taper" || phase === "test" ? 0.55 * steadyWeek : recoveryWeek ? 0.6 * steadyWeek : phase === "specialty" ? 7 * (fitness + 3 * rampRate) : 7 * (fitness + 6 * rampRate);

    const days =
      phase === "taper" && target
        ? taperWeek(start, weekAvail, target, zones, levels, { focus: phaseFocus(phase, target), favorites })
        : phase === "test"
          ? testWeek(start, weekAvail, schedule.end, levels)
          : loadWeek(start, weekAvail, zones, levels, weekTarget, recoveryWeek, longFloor, week.easyOnly, { focus: phaseFocus(phase, target), favorites });
    for (const goal of weekGoals) if (goal !== target) applyEvent(days, goal, weekAvail, levels);
    // Days outside a saved plan's dates are left open, apart from the events on them.
    for (const day of days) if ((day.date < schedule.firstDay || day.date > schedule.end) && day.role !== "event") Object.assign(day, { role: "rest", session: null });
    if (target && phase === "taper") markAfterEvent(days, target, weekAvail);
    days.forEach((day, i) => {
      if (week.breaks[i]) day.break = week.breaks[i];
      // Outdoor-only days ride whatever comes, so intervals become endurance.
      if (week.easyOnly[i] && day.session && INTERVAL_ZONES.includes(day.session.zone) && day.role !== "event") {
        Object.assign(day, { role: "easy", session: buildSession("endurance", levels.endurance, day.session.duration) });
      }
    });

    for (const day of days) {
      day.stress = day.goal && day.role === "event" ? eventStress(day.goal) : (day.session?.stress ?? 0);
      if (day.date >= today) forecastStress[day.date] = day.stress;
    }
    // Levels move up as if each key session is completed, so later weeks progress.
    for (const day of days) if (day.date >= today && day.role === "key" && day.session) levels[day.session.zone] = Math.max(levels[day.session.zone], day.session.level);

    const remaining = days.filter((d) => d.date >= today);
    if (remaining.length) {
      const series = fitnessSeries(forecastStress, remaining[0].date, remaining[remaining.length - 1].date, { startingFitness: fitness, startingFatigue: fatigue });
      fitness = series[series.length - 1].fitness;
      fatigue = series[series.length - 1].fatigue;
    }
    const beforePlan = addDays(start, 6) < schedule.firstDay;
    weeks.push({ start, phase, recoveryWeek, ...(breakNote ? { breakNote } : {}), ...(beforePlan ? { beforePlan: true as const } : {}), target: Math.round(weekTarget), stress: Math.round(days.reduce((s, d) => s + d.stress, 0)), days });
  }

  const end = weeks.length ? addDays(weeks[weeks.length - 1].start, 6) : today;
  const forecast = fitnessSeries(forecastStress, today, end, { startingFitness: input.fitness, startingFatigue: input.fatigue });
  return { target, frame, weeks, forecast };
}

/** Where a plan runs and what phase each week is in. */
interface Schedule {
  target: Goal | null;
  /** First day with sessions, and the Monday of its week. */
  firstDay: string;
  firstWeek: string;
  /** Last day of the plan. */
  end: string;
  weekAt: (monday: string) => { phase: Phase; recoveryWeek: boolean };
}

/** Without a saved plan: this week to the next A event, or a few weeks of base. */
function unframedSchedule(today: string, upcoming: Goal[], horizonWeeks: number): Schedule {
  const target = upcoming.find((g) => g.priority === "A") ?? null;
  const firstWeek = weekStart(today);
  if (!target) {
    // Without a goal, every fourth calendar week is a recovery week.
    return { target, firstDay: firstWeek, firstWeek, end: addDays(firstWeek, 7 * horizonWeeks - 1), weekAt: (m) => ({ phase: "base", recoveryWeek: weekIndex(m) % 4 === 3 }) };
  }
  return { target, firstDay: firstWeek, firstWeek, end: addDays(weekStart(target.date), 6), weekAt: peakWeeks(firstWeek, weekStart(target.date)) };
}

/** A saved plan: its own dates, with phases counted from its first week so they stay put as weeks pass. */
function framedSchedule(frame: PlanFrame, goals: Goal[]): Schedule {
  const firstWeek = weekStart(frame.start);
  const event = frame.goal === "event" ? (goals.find((g) => g.id === frame.goalId) ?? null) : null;
  const end = event ? event.date : frame.end;
  const lastWeek = weekStart(end);
  const total = daysBetween(firstWeek, lastWeek) / 7 + 1;
  const base = { target: event, firstDay: frame.start, firstWeek };
  if (event) {
    // After the event, the plan runs out the week with recovery spins.
    return { ...base, end: addDays(lastWeek, 6), weekAt: peakWeeks(firstWeek, lastWeek) };
  }
  const indexOf = (monday: string) => daysBetween(firstWeek, monday) / 7;
  if (frame.goal === "ftp") {
    // Base then build, with the last week easy and a ramp test at the end of it. Recovery weeks every
    // fourth week back from the test week, which is itself an easy week.
    const r = total - 1;
    const build = r <= 3 ? r : Math.min(8, Math.round(r * 0.55));
    return {
      ...base,
      end,
      weekAt: (m) => {
        const i = indexOf(m);
        const back = total - 1 - i;
        if (back === 0) return { phase: "test", recoveryWeek: false };
        return { phase: back <= build ? "build" : "base", recoveryWeek: back % 4 === 0 };
      },
    };
  }
  // Fitness: mostly base then build, no peak. Base: all base. Recovery every fourth week of the plan.
  const build = frame.goal === "fitness" && total >= 6 ? Math.round(total * 0.4) : 0;
  return {
    ...base,
    end,
    weekAt: (m) => {
      const i = indexOf(m);
      return { phase: i >= total - build ? "build" : "base", recoveryWeek: i % 4 === 3 };
    },
  };
}

/** Base, build, specialty and taper back from the event week, as in phaseLengths. */
function peakWeeks(firstWeek: string, eventWeek: string): Schedule["weekAt"] {
  const lengths = phaseLengths(daysBetween(firstWeek, eventWeek) / 7);
  return (monday) => {
    const k = daysBetween(monday, eventWeek) / 7;
    const phase: Phase = k === 0 ? "taper" : k <= lengths.specialty ? "specialty" : k <= lengths.specialty + lengths.build ? "build" : "base";
    // A recovery week closes each block: the week before specialty, then every fourth week back.
    return { phase, recoveryWeek: (phase === "base" || phase === "build") && (k - lengths.specialty) % 4 === 1 };
  };
}

/** A week's minutes per day with breaks applied, which days are outdoor only, and days off the bike. */
function weekAvailability(start: string, availability: Availability, breaks: Break[]) {
  const result = { availability: [...availability] as Availability, easyOnly: Array<boolean>(7).fill(false), daysOff: 0, breaks: Array<Break | undefined>(7).fill(undefined) };
  for (let i = 0; i < 7; i++) {
    const date = addDays(start, i);
    const b = breaks.find((x) => x.start <= date && date <= x.end);
    if (!b) continue;
    result.breaks[i] = b;
    if (b.riding === "off") {
      result.availability[i] = 0;
      result.daysOff++;
    } else if (b.riding === "limited") {
      result.availability[i] = Math.min(availability[i], b.minutes ?? 0);
      if (result.availability[i] < MIN_SESSION_MINUTES) result.daysOff++;
    } else result.easyOnly[i] = true;
  }
  return result;
}

/** Minutes you have on a day once breaks are applied, and whether it's an outdoor-only day (no intervals). */
export function dayMinutes(date: string, availability: Availability, breaks: Break[] = []): { minutes: number; easyOnly: boolean } {
  const week = weekAvailability(weekStart(date), availability, breaks);
  const i = daysBetween(weekStart(date), date);
  return { minutes: week.availability[i], easyOnly: week.easyOnly[i] };
}

/**
 * True when this is the first week back after at least REENTRY_DAYS off the bike: the week of the
 * first day back when that's Monday to Thursday, else the week after.
 */
function reentryWeek(start: string, breaks: Break[]): boolean {
  return breaks.some((b) => {
    if (b.riding !== "off" || daysBetween(b.start, b.end) + 1 < REENTRY_DAYS) return false;
    const back = addDays(b.end, 1);
    const week = weekStart(back);
    return start === (daysBetween(week, back) <= 3 ? week : addDays(week, 7));
  });
}

function emptyWeek(start: string): PlanDay[] {
  return Array.from({ length: 7 }, (_, i) => ({ date: addDays(start, i), role: "rest" as DayRole, session: null, stress: 0 }));
}

/**
 * A normal week: a long ride on the day with the most time, key interval sessions on the next
 * longest days that aren't back to back, and endurance riding on the rest, sized to hit the
 * week's target. At least one rest day.
 */
function loadWeek(
  start: string,
  availability: Availability,
  zones: Zone[],
  levels: Levels,
  target: number,
  recoveryWeek: boolean,
  longFloorMinutes = 60,
  easyOnly: boolean[] = [],
  prefer: Picking = { focus: [], favorites: [] },
): PlanDay[] {
  const days = emptyWeek(start);
  let open = availability.flatMap((m, i) => (m >= MIN_SESSION_MINUTES ? [i] : []));
  if (open.length === 7) {
    // Rest on the shortest day, Monday first on a tie.
    const rest = open.reduce((best, i) => (availability[i] < availability[best] ? i : best), 0);
    open = open.filter((i) => i !== rest);
  }
  if (open.length === 0) return days;

  // Latest day wins a tie, so the long ride lands on the weekend.
  const long = open.reduce((best, i) => (availability[i] >= availability[best] ? i : best), open[0]);
  const keyCount = recoveryWeek ? 1 : open.length <= 2 ? open.length - 1 : open.length === 3 ? 2 : Math.min(3, open.length - 2);
  const keys = pickKeyDays(open.filter((i) => i !== long && !easyOnly[i]), availability, keyCount, long);

  let stress = 0;
  keys.forEach((i, n) => {
    const zone = zones[n % zones.length];
    const level = recoveryWeek ? Math.max(MIN_LEVEL, levels[zone] - 1) : nextLevel(levels[zone]);
    const minutes = Math.min(availability[i], KEY_CAP_MINUTES[zone], recoveryWeek ? 60 : Infinity);
    const session = keySession(zone, level, minutes * 60, prefer, start, n);
    days[i] = { ...days[i], role: "key", session };
    stress += session.stress;
  });

  // Endurance fills the rest of the target: the long ride first, then the easy days.
  const easy = open.filter((i) => i !== long && !keys.includes(i));
  const endurance = (m: number) => buildSession("endurance", levels.endurance, m * 60);
  const perMinute = endurance(60).stress / 60;
  let remaining = Math.max(0, target - stress);
  const longMinutes = clampMinutes(Math.max((remaining * 0.45) / perMinute, longFloorMinutes), availability[long], recoveryWeek ? 90 : Infinity);
  days[long] = { ...days[long], role: "long", session: endurance(longMinutes) };
  remaining -= days[long].session!.stress;

  // Shortest easy days drop to rest first when the target doesn't need them.
  const sorted = [...easy].sort((a, b) => availability[a] - availability[b]);
  for (let n = 0; n < sorted.length; n++) {
    const share = remaining / (sorted.length - n) / perMinute;
    const i = sorted[n];
    if (share < MIN_SESSION_MINUTES) continue;
    const minutes = clampMinutes(share, availability[i], recoveryWeek ? 60 : Infinity);
    days[i] = { ...days[i], role: "easy", session: endurance(minutes) };
    remaining -= days[i].session!.stress;
  }
  return days;
}

/**
 * Key days by most time available. Never two back to back (fewer keys is better than that), and not
 * the day before the long ride when there's a choice.
 */
function pickKeyDays(candidates: number[], availability: Availability, count: number, long: number): number[] {
  const byTime = [...candidates].sort((a, b) => availability[b] - availability[a] || a - b);
  const picked: number[] = [];
  const clash = (i: number, strict: boolean) => picked.some((p) => Math.abs(p - i) === 1) || (strict && i === long - 1);
  for (const strict of [true, false]) {
    for (const i of byTime) {
      if (picked.length >= count) break;
      if (!picked.includes(i) && !clash(i, strict)) picked.push(i);
    }
  }
  return picked.sort((a, b) => a - b);
}

/** Event week of the A goal: one shortened key session early, openers two days out, then the event. */
function taperWeek(start: string, availability: Availability, goal: Goal, zones: Zone[], levels: Levels, prefer: Picking): PlanDay[] {
  const days = emptyWeek(start);
  const eventIndex = daysBetween(start, goal.date);
  days[eventIndex] = { ...days[eventIndex], role: "event", goal };
  const open = (i: number) => i >= 0 && i < eventIndex && availability[i] >= MIN_SESSION_MINUTES;

  const openerDay = [eventIndex - 2, eventIndex - 1, eventIndex - 3].find(open);
  if (openerDay !== undefined) days[openerDay] = { ...days[openerDay], role: "openers", session: openers(Math.min(availability[openerDay], 60) * 60) };
  const keyDay = [...Array(eventIndex).keys()].find((i) => open(i) && i <= eventIndex - 4);
  if (keyDay !== undefined) {
    const zone = zones[0];
    days[keyDay] = { ...days[keyDay], role: "key", session: keySession(zone, Math.max(MIN_LEVEL, levels[zone] - 1), Math.min(availability[keyDay], 60) * 60, prefer, start, 0) };
  }
  for (let i = 0; i < eventIndex - 1; i++) {
    if (days[i].role === "rest" && open(i) && i !== (keyDay ?? -9) + 1) {
      days[i] = { ...days[i], role: "easy", session: buildSession("endurance", levels.endurance, Math.min(availability[i], 60) * 60) };
    }
  }
  return days;
}

/**
 * The FTP test week: one short threshold session early, easy riding, a rest day, and a ramp test on
 * the day with the most time in the last three days of the plan.
 */
function testWeek(start: string, availability: Availability, end: string, levels: Levels): PlanDay[] {
  const days = emptyWeek(start);
  const last = Math.min(6, daysBetween(start, end));
  const open = (i: number) => i >= 0 && i <= last && availability[i] >= MIN_SESSION_MINUTES;
  const candidates = [last, last - 1, last - 2].filter(open);
  const testDay = candidates.length ? candidates.reduce((best, i) => (availability[i] > availability[best] ? i : best), candidates[0]) : last;
  days[testDay] = { ...days[testDay], role: "test", session: rampTest() };
  const keyDay = [...Array(testDay).keys()].find((i) => open(i) && i <= testDay - 3);
  if (keyDay !== undefined) {
    days[keyDay] = { ...days[keyDay], role: "key", session: buildSession("threshold", Math.max(MIN_LEVEL, levels.threshold - 1), Math.min(availability[keyDay], 60) * 60) };
  }
  for (let i = 0; i < testDay - 1; i++) {
    if (days[i].role === "rest" && open(i) && i !== (keyDay ?? -9) + 1) {
      days[i] = { ...days[i], role: "easy", session: buildSession("endurance", levels.endurance, Math.min(availability[i], 60) * 60) };
    }
  }
  return days;
}

/** A B or C event inside a normal week: the event replaces that day, and the days around it get easier. */
function applyEvent(days: PlanDay[], goal: Goal, availability: Availability, levels: Levels) {
  const i = days.findIndex((d) => d.date === goal.date);
  if (i < 0) return;
  days[i] = { ...days[i], role: "event", goal, session: null };
  const easyDay = (n: number, minutes: number) => {
    if (n < 0 || n > 6) return;
    days[n] = availability[n] >= MIN_SESSION_MINUTES ? { ...days[n], role: "easy", session: buildSession("recovery", 1, Math.min(availability[n], minutes) * 60) } : { ...days[n], role: "rest", session: null };
  };
  if (goal.priority !== "C") {
    // An A event the plan isn't peaking for is treated like a B. Openers the day before, and nothing hard in the two days before that.
    if (i - 1 >= 0) days[i - 1] = availability[i - 1] >= MIN_SESSION_MINUTES ? { ...days[i - 1], role: "openers", session: openers(Math.min(availability[i - 1], 45) * 60) } : { ...days[i - 1], role: "rest", session: null };
    for (const n of [i - 2, i - 3]) if (n >= 0 && days[n].role === "key") easyDay(n, 60);
  } else if (i - 1 >= 0 && days[i - 1].role === "key") {
    days[i - 1] = { ...days[i - 1], role: "easy", session: buildSession("endurance", levels.endurance, Math.min(availability[i - 1], 60) * 60) };
  }
  easyDay(i + 1, 45);
}

/** After the A event, recovery spins for the rest of the week. */
function markAfterEvent(days: PlanDay[], goal: Goal, availability: Availability) {
  const i = days.findIndex((d) => d.date === goal.date);
  for (let n = i + 1; n < 7; n++) {
    days[n] =
      availability[n] >= MIN_SESSION_MINUTES && n > i + 1
        ? { ...days[n], role: "easy", session: buildSession("recovery", 1, Math.min(availability[n], 45) * 60) }
        : { ...days[n], role: "rest", session: null };
  }
}

/** The next level to aim for in a zone: a half step beyond what you've done. */
export const nextLevel = (level: number) => Math.min(MAX_LEVEL, level + 0.5);

function clampMinutes(minutes: number, available: number, cap: number): number {
  return Math.max(MIN_SESSION_MINUTES, Math.min(Math.round(minutes / 15) * 15, available, cap));
}

/** Weeks since a fixed Monday, so "every fourth week" stays put as the days go by. */
const weekIndex = (monday: string) => Math.floor(daysBetween("1970-01-05", monday) / 7);

/** One line describing a planned day, e.g. "Threshold 3 x 11 min @ 98% · 75 min · level 4.5". */
export function describeDay(day: PlanDay): string {
  if (day.role === "event" && day.goal) return `${day.goal.name} (${day.goal.priority} event)`;
  const away = day.break ? ` (${BREAK_KIND_LABELS[day.break.kind].toLowerCase()} break${day.break.note ? `: ${day.break.note}` : ""})` : "";
  if (day.movedTo) return `Rest: the ${ZONE_LABELS[day.movedTo.session.zone].toLowerCase()} session planned here was missed and moved to ${day.movedTo.date}`;
  if (!day.session) return `Rest${away}`;
  const s = day.session;
  const level = s.zone === "recovery" || s.zone === "endurance" ? "" : ` · ${ZONE_LABELS[s.zone]} level ${s.level}`;
  const moved = day.movedFrom ? ` (moved from ${day.movedFrom.date}, which was missed${day.movedFrom.shortened ? "; shortened to fit" : ""})` : "";
  return `${s.workout.name} · ${Math.round(s.duration / 60)} min · ${Math.round(s.stress)} TSS${level}${away}${moved}`;
}
