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
import { ackPending, authorizeHealth, phoneStatus, readHealth, removeDuplicateWorkouts, saveWorkout, takePending } from "./plugin";

// Device-local settings ("phone." never syncs).
const IMPORTED = "phone.health.imported";
/**
 * Set once 60 days were read again to put back full nights that earlier reads had cut short. The
 * second key reads them once more: a computer still on an older version could cut nights short
 * after the first re-read, and those rows synced back.
 */
const REREAD = "phone.health.reread.nights2";
export const WRITE_RIDES = "phone.health.writeRides";
const WRITE_SINCE = "phone.health.writeSince";
const WRITTEN = "phone.health.written";
/** Set once the extra copies left by the old double save were taken out of Health. */
const DEDUPED = "phone.health.duplicatesRemoved";
/** Rides older than this are left alone (Health has them from elsewhere, or they're history). */
const WRITE_WINDOW_DAYS = 14;

/** Shows Apple's Health permission sheet, then imports and starts listening for new data. */
export async function connectHealth(): Promise<boolean> {
  const { granted } = await authorizeHealth();
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
      const first = !(await getSetting<boolean>(IMPORTED, false)) || !(await getSetting<boolean>(REREAD, false));
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
      await setSetting(REREAD, true);
      const at = new Date().toISOString();
      await setSetting("health.lastImport", { at, nights, days, latest, failed: [], from: "iphone" });
      // Synced: the computer's Sleep and recovery card shows this as the source and its status.
      const was = await getSetting<IphoneHealth | null>(IPHONE_SETTING, null);
      await setSetting(IPHONE_SETTING, { at, nights, days, latest: latest ?? was?.latest ?? null } satisfies IphoneHealth);
      revalidatePath("/");
      await writeRides();
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

let writing: Promise<number> | null = null;
let writeAgain = false;

/**
 * Writes each recent ride that isn't in Health yet. Each ride is tried once. Runs one at a time:
 * a Health wake and synced rides from the computer often ask together, and two runs side by side
 * both saw the ride as new and saved it twice. A call during a run makes it go round once more.
 */
export function writeRides(): Promise<number> {
  if (writing) {
    writeAgain = true;
    return writing;
  }
  writing = (async () => {
    await removeOldDuplicates();
    let saved = 0;
    do {
      writeAgain = false;
      saved += await writeNewRides();
    } while (writeAgain);
    return saved;
  })().finally(() => {
    writing = null;
  });
  return writing;
}

/** Once: deletes the second copies of rides that older versions saved to Health twice. */
async function removeOldDuplicates(): Promise<void> {
  if (await getSetting<boolean>(DEDUPED, false)) return;
  try {
    const { removed } = await removeDuplicateWorkouts();
    if (removed) logEvent("health", "info", `Removed ${removed} duplicate ${removed === 1 ? "ride" : "rides"} from Apple Health`);
    await setSetting(DEDUPED, true);
  } catch (e) {
    // Not allowed yet, say: try again next time.
    logEvent("health", "error", `Couldn't remove duplicate rides from Health: ${e instanceof Error ? e.message : String(e)}`);
  }
}

async function writeNewRides(): Promise<number> {
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
