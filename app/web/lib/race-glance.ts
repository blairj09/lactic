// Loads what a race report compares on its own (engine/race/glance), and which event's race Today
// points to (engine/race/followup). The numbers all come from the engine.

import { localDate } from "./engine/activity";
import type { Goal } from "./engine/plan";
import { addDays } from "./engine/pmc";
import type { PowerCurve } from "./engine/power";
import type { Route } from "./engine/ride-detail";
import { eventOnDay, FOLLOW_UP_DAYS, raceFollowUp, type RaceFollowUp } from "./engine/race/followup";
import { raceGlance, type Glance, type HistoryRide } from "./engine/race/glance";
import { findRow } from "./engine/race/results";
import type { Athlete, StoredRide } from "./activities";
import type { RaceData } from "./race";
import { loadGoals, rideDay, type TrainingState } from "./training";
import type { createClient } from "./supabase/server";

type Supabase = Awaited<ReturnType<typeof createClient>>;

/** Rides kept for past-course matching: this many of the closest in length. */
const HISTORY_LIMIT = 60;
const LENGTH_SLACK = 0.25;

export const RACE_PROMPTS_SETTING = "race_report_prompts";

/** The day a ride counts for, read without the whole training state: its linked plan day, else the day it was ridden. */
async function countedDay(supabase: Supabase, ride: StoredRide, timeZone: string): Promise<string> {
  const { data } = await supabase.from("plan_days").select("day").eq("activity_id", ride.id).limit(1);
  return (data?.[0]?.day as string | undefined) ?? localDate(ride.startedAt, timeZone);
}

/** The event a ride raced, if any, and records it with the race report (which also stops Today asking). */
export async function eventForRace(supabase: Supabase, ride: StoredRide, athlete: Athlete): Promise<Goal | null> {
  const [goals, day] = await Promise.all([loadGoals(supabase), countedDay(supabase, ride, athlete.timezone)]);
  const goal = eventOnDay(goals, day);
  if (goal) {
    const { data } = await supabase.from("race_reviews").select("goal_id").eq("activity_id", ride.id).maybeSingle();
    if (data?.goal_id !== goal.id) {
      const { error } = await supabase
        .from("race_reviews")
        .upsert({ activity_id: ride.id, goal_id: goal.id, updated_at: new Date().toISOString() }, { onConflict: "activity_id" });
      if (error) console.error("Couldn't link the race report to its event:", error);
    }
  }
  return goal;
}

/** A race's comparisons that need no setup: peaks against your bests, the placing, your earlier rides of the course. */
export async function loadGlance(supabase: Supabase, ride: StoredRide, athlete: Athlete, data: RaceData, bestCurve: PowerCurve | null): Promise<Glance> {
  const [{ data: stream }, history] = await Promise.all([
    supabase.from("activity_streams").select("route").eq("activity_id", ride.id).maybeSingle(),
    loadHistory(supabase, ride, athlete),
  ]);
  return raceGlance({
    race: figures(ride),
    route: (stream?.route as Route | null) ?? null,
    weightKg: athlete.weightKg,
    bestCurve,
    results: data.results,
    ownRow: findRow(data.results, data.ownName),
    history,
  });
}

const figures = (r: StoredRide) => ({
  id: r.id,
  name: r.name,
  startedAt: r.startedAt.getTime(),
  durationSeconds: r.durationSeconds,
  distanceMeters: r.distanceMeters,
  averagePower: r.averagePower,
  normalizedPower: r.normalizedPower,
  averageHr: r.averageHr,
  powerCurve: r.powerCurve,
});

/** Earlier rides about as long as this one, with their tracks, and the event each raced. */
async function loadHistory(supabase: Supabase, ride: StoredRide, athlete: Athlete): Promise<HistoryRide[]> {
  if (!ride.distanceMeters) return [];
  const [{ data, error }, goals] = await Promise.all([
    supabase
      .from("activities")
      .select("id, name, started_at, duration_seconds, distance_meters, average_power, normalized_power, average_hr, power_curve")
      .lt("started_at", ride.startedAt.toISOString())
      .gte("distance_meters", ride.distanceMeters * (1 - LENGTH_SLACK))
      .lte("distance_meters", ride.distanceMeters * (1 + LENGTH_SLACK))
      .is("duplicate_of", null)
      .order("started_at", { ascending: false })
      .limit(HISTORY_LIMIT),
    loadGoals(supabase),
  ]);
  if (error || !data?.length) return [];
  const ids = data.map((r) => r.id as string);
  const { data: streams } = await supabase.from("activity_streams").select("activity_id, route").in("activity_id", ids).not("route", "is", null);
  const routes = new Map((streams ?? []).map((s) => [s.activity_id as string, s.route as Route]));
  return data.flatMap((r) => {
    const route = routes.get(r.id as string);
    if (!route) return [];
    const startedAt = new Date(r.started_at as string);
    return [
      {
        id: r.id as string,
        name: (r.name as string | null) ?? null,
        startedAt: startedAt.getTime(),
        durationSeconds: r.duration_seconds as number,
        distanceMeters: (r.distance_meters as number | null) ?? null,
        averagePower: (r.average_power as number | null) ?? null,
        normalizedPower: (r.normalized_power as number | null) ?? null,
        averageHr: (r.average_hr as number | null) ?? null,
        powerCurve: (r.power_curve as PowerCurve | null) ?? null,
        route,
        event: eventOnDay(goals, localDate(startedAt, athlete.timezone))?.name ?? null,
      },
    ];
  });
}

/** The race Today points to a report for, if any (race reports on; checked by the caller). */
export async function loadRaceFollowUp(supabase: Supabase, state: TrainingState, dismissed: string[]): Promise<(RaceFollowUp & { rideName: string | null }) | null> {
  const from = addDays(state.today, -FOLLOW_UP_DAYS);
  const recentGoals = state.goals.filter((g) => g.date >= from && g.date <= state.today);
  if (!recentGoals.length) return null;
  const days = new Set(recentGoals.map((g) => g.date));
  const candidates = state.rides.filter((r) => !r.duplicateOf && days.has(rideDay(state, r)));
  if (!candidates.length) return null;
  const ids = candidates.map((r) => r.id);
  const [{ data: streams }, { data: reviews }] = await Promise.all([
    supabase.from("activity_streams").select("activity_id").in("activity_id", ids).not("route", "is", null),
    supabase.from("race_reviews").select("activity_id").in("activity_id", ids),
  ]);
  const routed = new Set((streams ?? []).map((s) => s.activity_id as string));
  const followUp = raceFollowUp({
    goals: recentGoals,
    rides: candidates.map((r) => ({ id: r.id, day: rideDay(state, r), durationSeconds: r.durationSeconds, hasRoute: routed.has(r.id) })),
    today: state.today,
    opened: new Set((reviews ?? []).map((r) => r.activity_id as string)),
    dismissed: new Set(dismissed),
  });
  return followUp ? { ...followUp, rideName: candidates.find((r) => r.id === followUp.rideId)?.name ?? null } : null;
}
