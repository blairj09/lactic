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
import { os, phoneHealthName } from "~/platform/native";
import { ackPending, authorizeHealth, phoneStatus, readHealth, removeDuplicateWorkouts, saveWeighIn, saveWorkout, takePending } from "./plugin";

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
const WEIGH_INS_WRITTEN = "phone.health.weighInsWritten";
/** Which Health permissions were last asked for: asking again when this grows shows only the new ones. */
const ASKED_TYPES = "phone.health.askedTypes";
/** 2: weight and body fat, read and written. */
const HEALTH_TYPES = 2;
/** Weigh-ins from these never go to Health: it gave them to us, or intervals.icu's are a day's value, not a moment's. */
const NOT_TO_HEALTH = ["apple_health", "intervals"];
/** Set once the extra copies left by the old double save were taken out of Health. */
const DEDUPED = "phone.health.duplicatesRemoved";
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

/**
 * How long a call to Swift may take before Lactic gives up on it and tries again next time. A call
 * that never answers (the app was put away part-way through one, say) used to hold the read open
 * for good, so every later read joined it and Health stopped coming in until the app was quit.
 */
const READ_MS = 45_000;
const FIRST_READ_MS = 120_000;
const SAVE_MS = 90_000;
const CLEANUP_MS = 120_000;
/** Time to answer Apple's Health permission sheet. */
const ASK_MS = 120_000;
/** The whole read and import: past this, the next ask starts afresh. */
const RUN_MS = 3 * 60_000;

/** `p`, or an error once `ms` pass without an answer. */
export function within<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} didn't answer in ${Math.round(ms / 1000)} s`)), ms);
  });
  return Promise.race([p, late]).finally(() => clearTimeout(timer));
}

let running: Promise<string | null> | null = null;
let lastError: string | null = null;

/** Why the last Health read failed, or null when it worked. */
export const healthError = () => lastError;

/**
 * Imports Health (60 days the first time, then the last 3), then writes new rides and weigh-ins to
 * Health without waiting on them. Resolves with the latest night, or null when there was nothing
 * or the read failed (healthError says why).
 */
export function syncPhoneHealth(): Promise<string | null> {
  if (running) return running;
  const run = within(importHealth(), RUN_MS, "Reading Apple Health")
    .then((latest) => {
      lastError = null;
      void writeRides()
        .then(() => writeWeighIns())
        .catch(() => {});
      return latest;
    })
    .catch((e: unknown) => {
      lastError = e instanceof Error ? e.message : String(e);
      // HealthKit's words for a type iOS hasn't asked the rider about yet.
      if (/not determined/i.test(lastError)) lastError = `Lactic needs your OK to read ${phoneHealthName()}. Tap Connect ${phoneHealthName()}.`;
      logEvent("health", "error", `${phoneHealthName()}: ${lastError}`);
      return null;
    })
    .finally(() => {
      if (running === run) running = null;
    });
  running = run;
  return run;
}

async function importHealth(): Promise<string | null> {
  const status = await within(phoneStatus(), READ_MS, "The iPhone app");
  if (!status.healthAvailable || !status.healthAsked) return null;
  // iOS hasn't asked about some types yet (added since the rider answered, or the sheet never
  // showed): Apple's sheet asks for just those. Only with the app on screen, where it can show.
  if (status.healthToAsk && typeof document !== "undefined" && document.visibilityState === "visible") {
    await within(authorizeHealth(), ASK_MS, "The permission sheet").catch(() => {});
    await setSetting(ASKED_TYPES, HEALTH_TYPES);
  }
  const first = !(await getSetting<boolean>(IMPORTED, false)) || !(await getSetting<boolean>(REREAD, false));
  const fresh = await within(readHealth(first ? 60 : 3), first ? FIRST_READ_MS : READ_MS, "Apple Health");
  let latest: string | null = null;
  let nights = 0;
  let days = 0;
  const add = (r: { nights: number; days: number; latest: string | null }) => {
    nights = Math.max(nights, r.nights);
    days = Math.max(days, r.days);
    latest = r.latest ?? latest;
  };
  // Reads a background wake kept for the app. One that can't be imported is dropped (the fresh
  // read covers the same days), so it can't stop every read after it.
  const pending = await within(takePending(), READ_MS, "The iPhone app").catch(() => []);
  for (const p of pending) {
    try {
      add(await ingestHealth(p.body));
    } catch (e) {
      logEvent("health", "error", `Dropped a background Health read: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  if (pending.length) await within(ackPending(pending.map((p) => p.id)), READ_MS, "The iPhone app").catch(() => {});
  // The fresh read last: it's the newest, so its latest night wins.
  add(await ingestHealth(fresh));
  await setSetting(IMPORTED, true);
  await setSetting(REREAD, true);
  const at = new Date().toISOString();
  await setSetting("health.lastImport", { at, nights, days, latest, failed: [], from: "iphone" });
  // Synced: the computer's Sleep and recovery card shows this as the source and its status.
  const was = await getSetting<IphoneHealth | null>(IPHONE_SETTING, null);
  await setSetting(IPHONE_SETTING, { at, nights, days, latest: latest ?? was?.latest ?? null } satisfies IphoneHealth);
  revalidatePath("/");
  return latest;
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
    const { removed } = await within(removeDuplicateWorkouts(), CLEANUP_MS, "Removing duplicate rides");
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
        const r = await within(saveWorkout(workout), SAVE_MS, "Saving a ride to Health");
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
  // Health Connect on Android takes rides only for now.
  if (os() === "android") return 0;
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
      const r = await within(saveWeighIn({
        id: m.id,
        at: Date.parse(m.measured_at) / 1000,
        kg: Number(m.weight_kg),
        fatPercent: m.body_fat_pct === null ? null : Number(m.body_fat_pct),
      }), SAVE_MS, "Saving a weigh-in to Health");
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
