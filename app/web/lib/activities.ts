import { cache } from "react";
import {
  assignCopies,
  ftpOn,
  localDate,
  rideStressFromSummary,
  type ActivitySource,
  type FtpChange,
  type RideSummary,
} from "@/lib/engine/activity";
import { DEFAULT_AVAILABILITY, DEFAULT_RAMP_RATE, type Availability } from "@/lib/engine/plan";
import type { PowerCurve } from "@/lib/engine/power";
import type { ChartStream, RideInterval } from "@/lib/engine/ride-detail";
import type { Workout } from "@/lib/engine/workout";
import type { createClient } from "@/lib/supabase/server";

type Supabase = Awaited<ReturnType<typeof createClient>>;

export interface Athlete {
  userId: string;
  ftp: number | null;
  thresholdHr: number | null;
  maxHr: number | null;
  weightKg: number | null;
  heightCm: number | null;
  /** YYYY-MM-DD. */
  birthDate: string | null;
  sex: "male" | "female" | null;
  sleepNeedHours: number;
  timezone: string;
  ftpHistory: FtpChange[];
  /** Minutes available to train per weekday, Monday first. */
  availability: Availability;
  rampRate: number;
}

export interface NewRide {
  source: ActivitySource;
  externalId: string;
  name: string;
  /** ISO timestamp. */
  startedAt: string;
  distanceMeters: number | null;
  summary: RideSummary;
  /** The intervals.icu activity it came from. */
  intervalsId?: string;
  /** Channels for the ride's page; missing for rides read without their streams. */
  stream?: RideStream;
}

/** What a ride's page charts, plus, for rides ridden here, the workout and how each interval went. */
export interface RideStream extends ChartStream {
  workout?: Workout | null;
  intervals?: RideInterval[] | null;
}

export interface StoredRide {
  id: string;
  source: ActivitySource;
  name: string | null;
  startedAt: Date;
  durationSeconds: number;
  distanceMeters: number | null;
  averagePower: number | null;
  normalizedPower: number | null;
  intensityFactor: number | null;
  trainingStress: number | null;
  stressMethod: "power" | "heartRate" | null;
  averageHr: number | null;
  powerCurve: PowerCurve | null;
  /** Seconds per 10 W bin; null for rides stored before it was kept, or without power. */
  powerHistogram: number[] | null;
  duplicateOf: string | null;
  intervalsId: string | null;
}

/**
 * Settings and FTP history for the signed-in athlete. Memoized per server render (React `cache`), so a page and the
 * loaders it calls share one load. The user comes from the session's JWT (`getClaims` checks its signature without a
 * round trip to Supabase Auth when the project signs with asymmetric keys, else it asks Auth); the settings queries
 * run alongside it, since row level security scopes them to the same user.
 */
export const loadAthlete = cache(async (supabase: Supabase): Promise<Athlete> => {
  const [{ data: auth }, { data: settings, error }, { data: history, error: historyError }] = await Promise.all([
    supabase.auth.getClaims(),
    supabase.from("athlete_settings").select("*").maybeSingle(),
    supabase.from("ftp_history").select("effective_date, watts").order("effective_date"),
  ]);
  const userId = auth?.claims.sub;
  if (!userId) throw new Error("Not signed in");
  if (error) throw error;
  if (historyError) throw historyError;
  return {
    userId,
    ftp: settings?.ftp_watts ?? null,
    thresholdHr: settings?.threshold_hr ?? null,
    maxHr: settings?.max_hr ?? null,
    weightKg: settings?.weight_kg === null || settings?.weight_kg === undefined ? null : Number(settings.weight_kg),
    heightCm: settings?.height_cm === null || settings?.height_cm === undefined ? null : Number(settings.height_cm),
    birthDate: settings?.birth_date ?? null,
    sex: settings?.sex ?? null,
    sleepNeedHours: settings ? Number(settings.sleep_need_hours) : 8,
    timezone: settings?.timezone ?? "America/Los_Angeles",
    ftpHistory: (history ?? []).map((h) => ({ effectiveDate: h.effective_date, watts: h.watts })),
    availability: Array.isArray(settings?.availability) && settings.availability.length === 7 ? (settings.availability as Availability) : DEFAULT_AVAILABILITY,
    rampRate: settings ? Number(settings.ramp_rate ?? DEFAULT_RAMP_RATE) : DEFAULT_RAMP_RATE,
  };
});

/** Training stress columns for a ride, from the FTP in effect on the ride's day. */
function stressColumns(athlete: Athlete, startedAt: Date, summary: Pick<RideSummary, "durationSeconds" | "normalizedPower" | "averageHeartRate">) {
  const ftp = ftpOn(localDate(startedAt, athlete.timezone), athlete.ftpHistory, athlete.ftp);
  const stress = rideStressFromSummary(summary, ftp, athlete.thresholdHr);
  return {
    training_stress: stress ? round(stress.trainingStress, 1) : null,
    intensity_factor: stress ? round(stress.intensityFactor, 3) : null,
    stress_method: stress?.method ?? null,
    ftp_used: stress?.method === "power" ? ftp : null,
  };
}

/** Saves rides (re-importing the same ride updates it) and marks copies of the same ride. */
export async function storeRides(supabase: Supabase, rides: NewRide[]): Promise<{ saved: number; copies: number; ids: string[] }> {
  if (rides.length === 0) return { saved: 0, copies: 0, ids: [] };
  const athlete = await loadAthlete(supabase);
  // One upsert can't touch a row twice, and the same file can arrive twice in a batch (say, an
  // activity duplicated in intervals.icu), so keep the first of each.
  const seen = new Set<string>();
  const unique = rides.filter((ride) => {
    const key = `${ride.source}/${ride.externalId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const rows = unique.map((ride) => {
    const startedAt = new Date(ride.startedAt);
    const s = ride.summary;
    return {
      user_id: athlete.userId,
      source: ride.source,
      external_id: ride.externalId,
      name: ride.name,
      started_at: startedAt.toISOString(),
      duration_seconds: s.durationSeconds,
      distance_meters: ride.distanceMeters === null ? null : round(ride.distanceMeters, 1),
      average_power: s.averagePower === null ? null : round(s.averagePower, 1),
      normalized_power: s.normalizedPower === null ? null : round(s.normalizedPower, 1),
      average_hr: s.averageHeartRate === null ? null : round(s.averageHeartRate, 1),
      power_curve: s.powerCurve ? roundCurve(s.powerCurve) : null,
      power_histogram: s.powerHistogram,
      // Only rides from intervals.icu carry it, so a FIT import of the same file keeps the link.
      ...(ride.intervalsId ? { intervals_id: ride.intervalsId } : {}),
      ...stressColumns(athlete, startedAt, s),
    };
  });
  const { data: saved, error } = await supabase.from("activities").upsert(rows, { onConflict: "user_id,source,external_id" }).select("id, source, external_id");
  if (error) throw error;
  await storeStreams(supabase, athlete.userId, unique, saved);

  const starts = rows.map((r) => Date.parse(r.started_at));
  const day = 86_400_000;
  const copies = await refreshCopies(supabase, new Date(Math.min(...starts) - day), new Date(Math.max(...starts) + day));
  return { saved: rows.length, copies, ids: saved.map((r) => r.id) };
}

async function storeStreams(supabase: Supabase, userId: string, rides: NewRide[], saved: { id: string; source: string; external_id: string }[]) {
  const ids = new Map(saved.map((r) => [`${r.source}/${r.external_id}`, r.id]));
  const rows = rides.flatMap((ride) => {
    const id = ids.get(`${ride.source}/${ride.externalId}`);
    const s = ride.stream;
    if (!id || !s) return [];
    return [
      {
        activity_id: id,
        user_id: userId,
        step_seconds: s.step,
        watts: s.watts,
        heart_rate: s.heartRate,
        cadence: s.cadence,
        target: s.target,
        workout: s.workout ?? null,
        intervals: s.intervals ?? null,
        route: s.route ?? null,
      },
    ];
  });
  // A few at a time: each row carries a ride's worth of numbers.
  for (let i = 0; i < rows.length; i += 10) {
    const { error } = await supabase.from("activity_streams").upsert(rows.slice(i, i + 10), { onConflict: "activity_id" });
    // Before the table exists the ride still saves; its page just has no charts.
    if (error) console.error(error);
  }
}

export interface StoredStream extends RideStream {
  activityId: string;
}

export async function loadStream(supabase: Supabase, activityId: string): Promise<StoredStream | null> {
  const { data, error } = await supabase.from("activity_streams").select("*").eq("activity_id", activityId).maybeSingle();
  if (error) return (console.error(error), null);
  if (!data) return null;
  return {
    activityId: data.activity_id,
    step: data.step_seconds,
    watts: data.watts,
    heartRate: data.heart_rate,
    cadence: data.cadence,
    target: data.target,
    workout: data.workout,
    intervals: data.intervals,
    route: data.route ?? null,
  };
}

/** One ride by id, copies included. */
export async function loadRide(supabase: Supabase, id: string): Promise<StoredRide | null> {
  const { data, error } = await supabase.from("activities").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  return data ? toStoredRide(data) : null;
}

/** The intervals.icu id held by a copy of this ride (e.g. Zwift's upload of a ride recorded here). */
export async function copyIntervalsId(supabase: Supabase, id: string): Promise<string | null> {
  const { data, error } = await supabase
    .from("activities")
    .select("intervals_id")
    .eq("duplicate_of", id)
    .not("intervals_id", "is", null)
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data?.intervals_id ?? null;
}

export interface UnlinkedRide {
  id: string;
  userId: string;
  source: ActivitySource;
  startedAt: Date;
  durationSeconds: number;
}

/** Rides not linked to an intervals.icu activity yet, other than ones ridden here (their copy carries the link). */
export async function unlinkedRides(supabase: Supabase, since: Date): Promise<UnlinkedRide[]> {
  const { data, error } = await supabase
    .from("activities")
    .select("id, user_id, source, started_at, duration_seconds")
    .is("intervals_id", null)
    .neq("source", "app")
    .gte("started_at", since.toISOString());
  if (error) throw error;
  return data.map((r) => ({ id: r.id, userId: r.user_id, source: r.source, startedAt: new Date(r.started_at), durationSeconds: r.duration_seconds }));
}

/** Saves intervals.icu activity ids (ride id -> activity id) on those rides. Returns how many it linked. */
export async function saveIntervalsLinks(supabase: Supabase, rides: UnlinkedRide[], links: Map<string, string>): Promise<number> {
  // Upsert needs the not-null columns even though only intervals_id changes.
  const rows = rides.flatMap((r) => {
    const intervalsId = links.get(r.id);
    return intervalsId
      ? [{ id: r.id, user_id: r.userId, source: r.source, started_at: r.startedAt.toISOString(), duration_seconds: r.durationSeconds, intervals_id: intervalsId }]
      : [];
  });
  for (let i = 0; i < rows.length; i += 200) {
    const { error } = await supabase.from("activities").upsert(rows.slice(i, i + 200), { onConflict: "id" });
    if (error) throw error;
  }
  return rows.length;
}

/** Re-runs copy detection for rides starting in [from, through]. Returns how many rides are copies. */
async function refreshCopies(supabase: Supabase, from: Date, through: Date): Promise<number> {
  const { data, error } = await supabase
    .from("activities")
    .select("id, source, started_at, duration_seconds, duplicate_of")
    .gte("started_at", from.toISOString())
    .lte("started_at", through.toISOString());
  if (error) throw error;
  const assigned = assignCopies(
    data.map((r) => ({ id: r.id, source: r.source, startedAt: new Date(r.started_at), durationSeconds: r.duration_seconds })),
  );
  let copies = 0;
  for (const row of data) {
    const keeper = assigned.get(row.id) ?? null;
    if (keeper) copies++;
    if (keeper !== row.duplicate_of) {
      const { error: updateError } = await supabase.from("activities").update({ duplicate_of: keeper }).eq("id", row.id);
      if (updateError) throw updateError;
    }
  }
  return copies;
}

/** Recomputes every ride's stress, e.g. after FTP or threshold HR changes. Returns how many changed. */
export async function recomputeStress(supabase: Supabase): Promise<number> {
  const athlete = await loadAthlete(supabase);
  const { data, error } = await supabase
    .from("activities")
    .select("id, source, started_at, duration_seconds, normalized_power, average_hr, training_stress, stress_method, ftp_used");
  if (error) throw error;
  const changed = data.flatMap((row) => {
    const columns = stressColumns(athlete, new Date(row.started_at), {
      durationSeconds: row.duration_seconds,
      normalizedPower: row.normalized_power === null ? null : Number(row.normalized_power),
      averageHeartRate: row.average_hr === null ? null : Number(row.average_hr),
    });
    const same =
      columns.stress_method === row.stress_method &&
      columns.ftp_used === row.ftp_used &&
      columns.training_stress === (row.training_stress === null ? null : Number(row.training_stress));
    // Upsert needs the not-null columns even though only the stress columns change.
    return same
      ? []
      : [{ id: row.id, user_id: athlete.userId, source: row.source, started_at: row.started_at, duration_seconds: row.duration_seconds, ...columns }];
  });
  for (let i = 0; i < changed.length; i += 200) {
    const { error: upsertError } = await supabase.from("activities").upsert(changed.slice(i, i + 200), { onConflict: "id" });
    if (upsertError) throw upsertError;
  }
  return changed.length;
}

/** Rides from `since` on, newest first. Copies of other rides are left out unless asked for. */
export async function loadRides(supabase: Supabase, since?: Date, { includeCopies = false } = {}): Promise<StoredRide[]> {
  let query = supabase.from("activities").select("*").order("started_at", { ascending: false });
  if (since) query = query.gte("started_at", since.toISOString());
  if (!includeCopies) query = query.is("duplicate_of", null);
  const { data, error } = await query;
  if (error) throw error;
  return data.map(toStoredRide);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toStoredRide(r: any): StoredRide {
  return {
    id: r.id,
    source: r.source,
    name: r.name,
    startedAt: new Date(r.started_at),
    durationSeconds: r.duration_seconds,
    distanceMeters: num(r.distance_meters),
    averagePower: num(r.average_power),
    normalizedPower: num(r.normalized_power),
    intensityFactor: num(r.intensity_factor),
    trainingStress: num(r.training_stress),
    stressMethod: r.stress_method,
    averageHr: num(r.average_hr),
    powerCurve: r.power_curve,
    powerHistogram: r.power_histogram ?? null,
    duplicateOf: r.duplicate_of,
    intervalsId: r.intervals_id ?? null,
  };
}

const num = (value: number | string | null): number | null => (value === null ? null : Number(value));
const round = (value: number, digits: number) => Math.round(value * 10 ** digits) / 10 ** digits;
const roundCurve = (curve: PowerCurve): PowerCurve => Object.fromEntries(Object.entries(curve).map(([d, w]) => [d, round(w, 1)]));
