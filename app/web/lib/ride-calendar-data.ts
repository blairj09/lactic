import type { StoredRide } from "@/lib/activities";
import { localDate } from "@/lib/engine/activity";
import { ZONES, type Zone } from "@/lib/engine/library";
import { rideSetting, rideType, type CalendarRide } from "@/lib/engine/ride-calendar";
import { loadPlanDays } from "@/lib/training";
import type { createClient } from "@/lib/supabase/server";

type Supabase = Awaited<ReturnType<typeof createClient>>;

const isZone = (z: unknown): z is Zone => (ZONES as readonly unknown[]).includes(z);

/**
 * Every ride (copies too) as the Progress calendar shows it: where it was ridden (a GPS track
 * means outside), its type (the logged or planned workout, else a guess from intensity) and the
 * post-ride note. A copy shares the ride it copies' type and note.
 */
export async function loadCalendarRides(supabase: Supabase, rides: StoredRide[], timeZone: string): Promise<CalendarRide[]> {
  if (!rides.length) return [];
  const dates = rides.map((r) => localDate(r.startedAt, timeZone)).sort();
  const [routes, feedback, days] = await Promise.all([
    supabase
      .from("activity_streams")
      .select("activity_id")
      .not("route", "is", null)
      .then(({ data, error }) => (error ? (console.error(error), []) : data)),
    supabase
      .from("ride_feedback")
      .select("activity_id, note, session")
      .then(({ data, error }) => (error ? (console.error(error), []) : data)),
    loadPlanDays(supabase, dates[0], dates.at(-1)!).catch((e) => (console.error(e), [])),
  ]);
  const tracked = new Set(routes.map((r) => r.activity_id as string));
  const byId = new Map(rides.map((r) => [r.id, r]));
  const main = (r: StoredRide) => (r.duplicateOf && byId.has(r.duplicateOf) ? r.duplicateOf : r.id);

  const notes = new Map<string, string>();
  const logged = new Map<string, Zone>();
  for (const f of feedback) {
    const ride = byId.get(f.activity_id);
    if (!ride) continue;
    const id = main(ride);
    if (f.note) notes.set(id, f.note);
    const zone = (f.session as { zone?: unknown } | null)?.zone;
    if (isZone(zone)) logged.set(id, zone);
  }

  // A plan day's workout belongs to the ride linked to it, else the longest counted ride that day.
  const planned = new Map<string, Zone>();
  for (const day of days) {
    const zone = day.chosen ? day.chosen.session?.zone : day.planned?.zone;
    if (!isZone(zone)) continue;
    const linked = day.activityId && byId.has(day.activityId) ? main(byId.get(day.activityId)!) : null;
    const longest = rides
      .filter((r) => !r.duplicateOf && localDate(r.startedAt, timeZone) === day.day)
      .sort((a, b) => b.durationSeconds - a.durationSeconds)[0];
    const id = linked ?? longest?.id;
    if (id) planned.set(id, zone);
  }

  const copyOnIntervals = new Map(rides.flatMap((r) => (r.duplicateOf && r.intervalsId ? [[r.duplicateOf, r.intervalsId] as const] : [])));
  return rides.map((r) => {
    const id = main(r);
    const parent = byId.get(id)!;
    const type = rideType(logged.get(id) ?? planned.get(id) ?? null, parent.intensityFactor ?? r.intensityFactor, parent.name ?? r.name);
    return {
      id: r.id,
      name: r.name,
      startedAt: r.startedAt.toISOString(),
      date: localDate(r.startedAt, timeZone),
      source: r.source,
      durationSeconds: r.durationSeconds,
      distanceMeters: r.distanceMeters,
      normalizedPower: r.normalizedPower,
      trainingStress: r.trainingStress,
      stressMethod: r.stressMethod,
      duplicateOf: r.duplicateOf,
      intervalsId: r.intervalsId ?? copyOnIntervals.get(r.id) ?? null,
      setting: rideSetting(r.source, tracked.has(r.id) || (r.id !== id && tracked.has(id))),
      zone: type?.zone ?? null,
      zoneEstimated: type?.estimated ?? false,
      note: notes.get(id) ?? "",
    };
  });
}
