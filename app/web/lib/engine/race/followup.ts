// After a race: which event's ride to point the rider to a race report for. An event is a goal on
// the plan; its ride is the one that counts for the event's day (the day it was ridden, or the plan
// day the rider linked it to). The prompt stays up for a week, until the report is opened or the
// rider says not now. No browser or Node APIs, so it runs and tests anywhere.

import { addDays } from "../pmc";
import type { Goal } from "../plan";

/** How long after an event Today keeps pointing to its race report, days. */
export const FOLLOW_UP_DAYS = 7;

/** Shortest ride that can be the race itself rather than a spin to the start, seconds. */
const MIN_RACE_SECONDS = 10 * 60;

export interface EventRideCandidate {
  id: string;
  /** The day the ride counts for, YYYY-MM-DD. */
  day: string;
  durationSeconds: number;
  /** It has a GPS track, so it can have a race report. */
  hasRoute: boolean;
}

export interface RaceFollowUp {
  goal: Goal;
  rideId: string;
  /** Days since the event: 0 on the day. */
  daysAgo: number;
}

/** The event a ride raced, if its day is an event's day. Several on one day: the higher priority. */
export function eventOnDay(goals: Goal[], day: string): Goal | null {
  const on = goals.filter((g) => g.date === day);
  return on.sort((a, b) => a.priority.localeCompare(b.priority))[0] ?? null;
}

/** The ride that was the race on an event's day: the longest one with a GPS track (warm-ups are shorter). */
export function raceRide<T extends EventRideCandidate>(rides: T[], day: string): T | null {
  const on = rides.filter((r) => r.day === day && r.hasRoute && r.durationSeconds >= MIN_RACE_SECONDS);
  return on.sort((a, b) => b.durationSeconds - a.durationSeconds)[0] ?? null;
}

/**
 * The most recent event in the last week whose race ride has no report yet: what Today points to.
 * `opened` holds rides whose report has been opened; `dismissed` the ones the rider said not now to.
 */
export function raceFollowUp({
  goals,
  rides,
  today,
  opened,
  dismissed,
}: {
  goals: Goal[];
  rides: EventRideCandidate[];
  today: string;
  opened: ReadonlySet<string>;
  dismissed: ReadonlySet<string>;
}): RaceFollowUp | null {
  const from = addDays(today, -FOLLOW_UP_DAYS);
  const recent = goals.filter((g) => g.date >= from && g.date <= today).sort((a, b) => b.date.localeCompare(a.date) || a.priority.localeCompare(b.priority));
  for (const goal of recent) {
    const ride = raceRide(rides, goal.date);
    if (!ride || opened.has(ride.id) || dismissed.has(ride.id)) continue;
    return { goal, rideId: ride.id, daysAgo: daysBetween(goal.date, today) };
  }
  return null;
}

/** Days between two days, YYYY-MM-DD. */
function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000);
}
