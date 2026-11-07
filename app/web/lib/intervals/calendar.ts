// The plan as intervals.icu calendar events: planned workouts in its workout text format, and goals as races.
// Every event carries an external id starting with PREFIX, so only events this app made are ever changed.

import { plannedStress, workoutDuration, type Segment, type Workout } from "../engine/workout";
import { outdoorRange, outdoorWorkout, type OutdoorRide } from "../engine/outdoor";
import type { Goal, GoalKind, Plan } from "../engine/plan";
import { addDays } from "../engine/pmc";

export const PREFIX = "mycoach-";
/** Days of planned workouts sent ahead, today included. Further out the plan still moves a lot. */
export const WORKOUT_DAYS = 28;

export interface CalendarEvent {
  external_id: string;
  category: "WORKOUT" | "RACE_A" | "RACE_B" | "RACE_C";
  /** Local midnight, as intervals.icu wants it. */
  start_date_local: string;
  type: RideType;
  name: string;
  description: string;
  /** Seconds; workouts only. */
  moving_time?: number;
  icu_training_load?: number;
}

/** intervals.icu's sport type for each kind of event (its types follow Strava's). The rest are plain rides. */
type RideType = "Ride" | "GravelRide" | "MountainBikeRide";
// intervals.icu added a cyclocross type in 2026 but its name isn't documented, so CX goes as a plain ride for now.
const RIDE_TYPES: Partial<Record<GoalKind, RideType>> = { gravel: "GravelRide", mountainBike: "MountainBikeRide" };

/** An event as intervals.icu lists it. */
export interface ListedEvent {
  id: number;
  external_id?: string | null;
  category?: string;
  start_date_local: string;
  type?: string | null;
  name?: string | null;
  description?: string | null;
  moving_time?: number | null;
  icu_training_load?: number | null;
}

/** 330 -> "5m30s", 3600 -> "1h". */
export function duration(seconds: number): string {
  const s = Math.round(seconds);
  const parts = [[Math.floor(s / 3600), "h"], [Math.floor((s % 3600) / 60), "m"], [s % 60, "s"]] as const;
  return parts.filter(([n]) => n > 0).map(([n, unit]) => `${n}${unit}`).join("") || "0s";
}

const percent = (fraction: number) => `${Math.round(fraction * 100)}%`;

function step(segment: Segment, outdoor: boolean): string {
  const time = duration(segment.duration);
  switch (segment.kind) {
    case "steady": {
      if (!outdoor) return `- ${time} ${percent(segment.target)}`;
      const { low, high } = outdoorRange(segment.target);
      return `- ${time} ${percent(low)}-${percent(high)}`;
    }
    case "ramp":
      return `- ${time} ramp ${percent(segment.from)}-${percent(segment.to)}`;
    case "freeRide":
      return `- ${time} freeride`;
  }
}

/**
 * intervals.icu workout text: one step per segment, power as a share of FTP. Outdoors, steady
 * targets are ranges (the workout should already have gone through outdoorWorkout).
 */
export function workoutText(workout: Workout, outdoor = false): string {
  return workout.segments
    .filter((s) => s.duration > 0)
    .map((s) => step(s, outdoor))
    .join("\n");
}

const NOTE = "Planned by My Coach. Changes here are replaced on the next sync.";
const OUTDOOR_NOTE = "Ride outside. Targets are ranges; hold them by feel through hills and traffic.";
export const OUTDOOR_SUFFIX = " (outdoor)";

/**
 * Workouts for the next WORKOUT_DAYS days, and every goal from today on. Outdoor days carry the
 * outdoor version of their workout: the plan's session, or the workout chosen for that day.
 */
export function calendarEvents(plan: Plan, goals: Goal[], today: string, outdoor: OutdoorRide[] = []): CalendarEvent[] {
  const last = addDays(today, WORKOUT_DAYS - 1);
  const outside = new Map(outdoor.map((o) => [o.date, o]));
  const workoutEvent = (date: string, workout: Workout, seconds: number, stress: number, isOutdoor: boolean): CalendarEvent => ({
    external_id: `${PREFIX}workout-${date}`,
    category: "WORKOUT",
    start_date_local: `${date}T00:00:00`,
    type: "Ride",
    name: isOutdoor ? `${workout.name}${OUTDOOR_SUFFIX}` : workout.name,
    description: isOutdoor ? `${OUTDOOR_NOTE}\n${NOTE}\n\n${workoutText(workout, true)}` : `${NOTE}\n\n${workoutText(workout)}`,
    moving_time: Math.round(seconds),
    icu_training_load: Math.round(stress),
  });
  const days = plan.weeks.flatMap((w) => w.days).filter((d) => d.date >= today && d.date <= last);
  const inPlan = new Set(days.map((d) => d.date));
  const workouts = days.flatMap((d): CalendarEvent[] => {
    const ride = outside.get(d.date);
    if (ride?.workout) {
      const workout = outdoorWorkout(ride.workout);
      return [workoutEvent(d.date, workout, workoutDuration(workout), plannedStress(workout), true)];
    }
    if (!d.session) return [];
    const workout = ride ? outdoorWorkout(d.session.workout) : d.session.workout;
    return [workoutEvent(d.date, workout, d.session.duration, d.session.stress, Boolean(ride))];
  });
  // A workout chosen for a day the plan doesn't reach still goes out.
  for (const ride of outdoor) {
    if (!ride.workout || ride.date < today || ride.date > last || inPlan.has(ride.date)) continue;
    const workout = outdoorWorkout(ride.workout);
    workouts.push(workoutEvent(ride.date, workout, workoutDuration(workout), plannedStress(workout), true));
  }
  const races = goals
    .filter((g) => g.date >= today)
    .map((g): CalendarEvent => ({
      external_id: `${PREFIX}goal-${g.id}`,
      category: `RACE_${g.priority}`,
      start_date_local: `${g.date}T00:00:00`,
      type: RIDE_TYPES[g.kind] ?? "Ride",
      name: g.name,
      description: `${g.priority} event, from My Coach.`,
    }));
  return [...workouts, ...races];
}

const same = (wanted: CalendarEvent, listed: ListedEvent) =>
  listed.category === wanted.category &&
  (listed.type ?? "Ride") === wanted.type &&
  listed.start_date_local.slice(0, 10) === wanted.start_date_local.slice(0, 10) &&
  (listed.name ?? "") === wanted.name &&
  (listed.description ?? "") === wanted.description &&
  (listed.moving_time ?? undefined) === wanted.moving_time &&
  (listed.icu_training_load ?? undefined) === wanted.icu_training_load;

/**
 * What to send, given the calendar from today on: events that are new or changed, and this app's
 * events that are no longer in the plan (a rest day now, a deleted goal). Other events are left alone.
 */
export function calendarChanges(wanted: CalendarEvent[], listed: ListedEvent[], today: string) {
  const ours = listed.filter((e) => e.external_id?.startsWith(PREFIX) && e.start_date_local.slice(0, 10) >= today);
  const byId = new Map(ours.map((e) => [e.external_id!, e]));
  const wantedIds = new Set(wanted.map((e) => e.external_id));
  return {
    upsert: wanted.filter((e) => {
      const existing = byId.get(e.external_id);
      return !existing || !same(e, existing);
    }),
    remove: ours.filter((e) => !wantedIds.has(e.external_id!)).map((e) => e.id),
  };
}
