// Apple Health on the iPhone, read directly: no Shortcut. Health data is imported here with the
// same code the Shortcut's file goes through (it also reaches the computer: either straight from a
// background wake, or as rows on the next sync). Rides go the other way: each ride Lactic has that
// isn't in Health yet (from Zwift, a bike computer or a watch) is written there as a cycling workout.

import { healthWorkout } from "@/lib/engine/health-export";
import { ingestHealth, IPHONE_SETTING, SOURCE_SETTING, type IphoneHealth } from "~/integrations/apple-health";
import { createClient } from "~/db/supabase-client";
import { getSetting, setSetting } from "~/settings/store";
import { revalidatePath } from "~/shims/next-cache";
import { logEvent } from "~/support/log";
import { ackPending, authorizeHealth, phoneStatus, readHealth, saveWeighIn, saveWorkout, takePending } from "./plugin";

// Device-local settings ("phone." never syncs).
const IMPORTED = "phone.health.imported";
export const WRITE_RIDES = "phone.health.writeRides";
const WRITE_SINCE = "phone.health.writeSince";
const WRITTEN = "phone.health.written";
const WEIGH_INS_WRITTEN = "phone.health.weighInsWritten";
/** Which Health permissions were last asked for: asking again when this grows shows only the new ones. */
const ASKED_TYPES = "phone.health.askedTypes";
/** 2: weight and body fat, read and written. */
const HEALTH_TYPES = 2;
/** Weigh-ins from these never go to Health: it gave them to us, or intervals.icu's are a day's value, not a moment's. */
const NOT_TO_HEALTH = ["apple_health", "intervals"];
/** Rides older than this are left alone (Health has them from elsewhere, or they're history). */
const WRITE_WINDOW_DAYS = 14;

/** Shows Apple's Health permission sheet, then imports and starts listening for new data. */
export async function connectHealth(): Promise<boolean> {
  const { granted } = await authorizeHealth();
  await setSetting(ASKED_TYPES, HEALTH_TYPES);
  await setSetting(SOURCE_SETTING, "apple");
  if ((await getSetting<string | null>(WRITE_SINCE, null)) === null) {
    // Rides from the last few days count too, so today's ride shows up straight away.
    await setSetting(WRITE_SINCE, new Date(Date.now() - 3 * 86_400_000).toISOString());
  }
  await syncPhoneHealth();
  return granted;
}

let running: Promise<string | null> | null = null;

/** Imports Health (60 days the first time, then the last 3) and writes new rides to Health. */
export function syncPhoneHealth(): Promise<string | null> {
  running ??= (async () => {
    try {
      const status = await phoneStatus();
      if (!status.healthAvailable || !status.healthAsked) return null;
      // Connected before Lactic read and wrote weight: Apple's sheet asks for just the new types, once.
      if ((await getSetting<number>(ASKED_TYPES, 1)) < HEALTH_TYPES) {
        await authorizeHealth().catch(() => {});
        await setSetting(ASKED_TYPES, HEALTH_TYPES);
      }
      const first = !(await getSetting<boolean>(IMPORTED, false));
      const bodies = [await readHealth(first ? 60 : 3)];
      const pending = await takePending();
      bodies.push(...pending.map((p) => p.body));
      let latest: string | null = null;
      let nights = 0;
      let days = 0;
      for (const body of bodies) {
        const r = await ingestHealth(body);
        nights = Math.max(nights, r.nights);
        days = Math.max(days, r.days);
        latest = r.latest ?? latest;
      }
      if (pending.length) await ackPending(pending.map((p) => p.id));
      await setSetting(IMPORTED, true);
      const at = new Date().toISOString();
      await setSetting("health.lastImport", { at, nights, days, latest, failed: [], from: "iphone" });
      // Synced: the computer's Sleep and recovery card shows this as the source and its status.
      const was = await getSetting<IphoneHealth | null>(IPHONE_SETTING, null);
      await setSetting(IPHONE_SETTING, { at, nights, days, latest: latest ?? was?.latest ?? null } satisfies IphoneHealth);
      revalidatePath("/");
      await writeRides();
      await writeWeighIns();
      return latest;
    } catch (e) {
      logEvent("health", "error", `Apple Health: ${e instanceof Error ? e.message : String(e)}`);
      return null;
    } finally {
      running = null;
    }
  })();
  return running;
}

interface ActivityRow {
  id: string;
  name: string | null;
  started_at: string;
  duration_seconds: number;
  distance_meters: number | null;
  average_power: number | null;
}

interface StreamRow {
  activity_id: string;
  step_seconds: number;
  watts: (number | null)[] | null;
  heart_rate: (number | null)[] | null;
  cadence: (number | null)[] | null;
  route: unknown;
}

/** Writes each recent ride that isn't in Health yet. Each ride is tried once. */
export async function writeRides(): Promise<number> {
  if (!(await getSetting<boolean>(WRITE_RIDES, true))) return 0;
  const since = await getSetting<string | null>(WRITE_SINCE, null);
  if (!since) return 0;
  const from = new Date(Math.max(Date.parse(since), Date.now() - WRITE_WINDOW_DAYS * 86_400_000)).toISOString();
  const db = createClient();
  const { data } = await db.from("activities").select("id, name, started_at, duration_seconds, distance_meters, average_power").gte("started_at", from).is("duplicate_of", null).order("started_at");
  const written = new Set(await getSetting<string[]>(WRITTEN, []));
  const todo = ((data ?? []) as ActivityRow[]).filter((a) => !written.has(a.id) && Date.parse(a.started_at) + a.duration_seconds * 1000 < Date.now());
  let saved = 0;
  for (const a of todo) {
    const { data: s } = await db.from("activity_streams").select("activity_id, step_seconds, watts, heart_rate, cadence, route").eq("activity_id", a.id).maybeSingle();
    const stream = s as StreamRow | null;
    const workout = healthWorkout({
      id: a.id,
      name: a.name,
      startedAt: a.started_at,
      durationSeconds: a.duration_seconds,
      distanceMeters: a.distance_meters,
      averagePower: a.average_power,
      indoor: !stream?.route,
      stepSeconds: stream?.step_seconds ?? 5,
      watts: stream?.watts ?? null,
      heartRate: stream?.heart_rate ?? null,
      cadence: stream?.cadence ?? null,
    });
    try {
      if (workout) {
        const r = await saveWorkout(workout);
        if (r.saved) saved++;
        else logEvent("health", "info", `Ride ${a.name ?? a.id} not written to Health: ${r.reason}`);
      }
      written.add(a.id);
    } catch (e) {
      // Not allowed to write workouts, say: try again next time.
      logEvent("health", "error", `Couldn't write ${a.name ?? "a ride"} to Health: ${e instanceof Error ? e.message : String(e)}`);
      break;
    }
  }
  // Only recent ids matter; the window keeps the list short.
  await setSetting(WRITTEN, [...written].slice(-500));
  return saved;
}

/** Writes each recent weigh-in from a scale (on this iPhone or synced from the computer) to Health. Each is tried once. */
export async function writeWeighIns(): Promise<number> {
  if (!(await getSetting<boolean>(WRITE_RIDES, true))) return 0;
  const since = await getSetting<string | null>(WRITE_SINCE, null);
  if (!since) return 0;
  const from = new Date(Math.max(Date.parse(since), Date.now() - WRITE_WINDOW_DAYS * 86_400_000)).toISOString();
  const { data } = await createClient().from("body_measurements").select("id, measured_at, source, weight_kg, body_fat_pct").gte("measured_at", from).order("measured_at");
  const written = new Set(await getSetting<string[]>(WEIGH_INS_WRITTEN, []));
  const todo = ((data ?? []) as { id: string; measured_at: string; source: string; weight_kg: number | string; body_fat_pct: number | string | null }[]).filter(
    (m) => !written.has(m.id) && !NOT_TO_HEALTH.includes(m.source),
  );
  let saved = 0;
  for (const m of todo) {
    try {
      const r = await saveWeighIn({
        id: m.id,
        at: Date.parse(m.measured_at) / 1000,
        kg: Number(m.weight_kg),
        fatPercent: m.body_fat_pct === null ? null : Number(m.body_fat_pct),
      });
      if (r.saved) saved++;
      else logEvent("health", "info", `Weigh-in not written to Health: ${r.reason}`);
      written.add(m.id);
    } catch (e) {
      // Not allowed to write weight, say: try again next time.
      logEvent("health", "error", `Couldn't write a weigh-in to Health: ${e instanceof Error ? e.message : String(e)}`);
      break;
    }
  }
  await setSetting(WEIGH_INS_WRITTEN, [...written].slice(-500));
  return saved;
}
