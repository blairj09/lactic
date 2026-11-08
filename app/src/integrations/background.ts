// Work that runs while the app is open: pulling new rides and wellness from connected services,
// and walking back through history after a first connect. One job at a time, quietly.

import { syncIntervals } from "@/app/actions";
import { loadConnection, syncWellness } from "@/lib/intervals/client";
import { createClient } from "~/db/supabase-client";
import { deleteSecret, placeholder, saveSecret, secretStatus, SECRET_INTERVALS } from "~/platform/secrets";
import { getSetting, setSetting } from "~/settings/store";
import { revalidatePath } from "~/shims/next-cache";
import { logEvent } from "~/support/log";

export type Job = "intervals" | "health";
const EVERY_MS = 20 * 60_000;
const jobs: Partial<Record<Job, () => Promise<{ ok: boolean; message: string } | void>>> = {};
const listeners = new Set<(s: SyncStatus) => void>();

export interface SyncStatus {
  running: Job | null;
  last: Partial<Record<Job, { at: string; ok: boolean; message: string }>>;
}
const status: SyncStatus = { running: null, last: {} };
const publish = () => listeners.forEach((l) => l({ ...status, last: { ...status.last } }));

export function onSyncStatus(cb: (s: SyncStatus) => void) {
  listeners.add(cb);
  cb(status);
  return () => void listeners.delete(cb);
}

/** Integrations add their own background job (Apple Health folders, for one). */
export function registerJob(job: Job, work: () => Promise<{ ok: boolean; message: string } | void>) {
  jobs[job] = work;
}

let queue: Promise<void> = Promise.resolve();
function run(job: Job) {
  const work = jobs[job];
  if (!work) return queue;
  queue = queue.then(async () => {
    status.running = job;
    publish();
    try {
      const result = await work();
      if (result) {
        status.last[job] = { at: new Date().toISOString(), ...result };
        logEvent(job, result.ok ? "info" : "error", `Sync ${result.ok ? "done" : "failed"}: ${result.message}`);
      }
    } catch (e) {
      status.last[job] = { at: new Date().toISOString(), ok: false, message: e instanceof Error ? e.message : String(e) };
      logEvent(job, "error", `Sync failed: ${status.last[job]!.message}`);
    } finally {
      status.running = null;
      publish();
    }
  });
  return queue;
}

/** Settings used to keep a pasted intervals.icu key in the database. Moves it to the keychain. */
export async function moveIntervalsKeyToKeychain() {
  const db = createClient();
  const connection = await loadConnection(db);
  // Once, after onboarding: older builds' Disconnect left the key in the keychain with no connection.
  if (!connection && (await getSetting("onboarding.done", false)) && !(await getSetting("secrets.intervalsSwept", false))) {
    if (await secretStatus(SECRET_INTERVALS)) await deleteSecret(SECRET_INTERVALS);
    await setSetting("secrets.intervalsSwept", true);
  }
  if (!connection || connection.apiKey.startsWith("keychain:")) return;
  await saveSecret(SECRET_INTERVALS, connection.apiKey);
  const { error } = await db.from("intervals_connections").update({ api_key: placeholder(SECRET_INTERVALS) }).eq("user_id", connection.userId);
  if (error) throw error;
}

registerJob("intervals", async () => {
  await moveIntervalsKeyToKeychain().catch((e) => logEvent("intervals", "error", `Couldn't move the API key to the keychain: ${e instanceof Error ? e.message : String(e)}`));
  const connection = await loadConnection(createClient());
  if (!connection) return;
  const fresh = await syncIntervals("new");
  let { ok, message } = fresh;
  // History in batches, a few per pass so the app stays responsive.
  for (let i = 0; ok && !connection.backfillDone && i < 6; i++) {
    const batch = await syncIntervals("history");
    ok = batch.ok;
    message = batch.message;
    if (!batch.more) break;
  }
  // Sleep, HRV and resting HR from whatever watch or ring feeds intervals.icu (Garmin, Oura, WHOOP, ...).
  try {
    const w = await syncWellness(createClient(), connection);
    if (w.mornings || w.weighIns) {
      const parts = [w.mornings && `${w.mornings} morning${w.mornings === 1 ? "" : "s"} of recovery data`, w.weighIns && `${w.weighIns} weigh-in${w.weighIns === 1 ? "" : "s"}`].filter(Boolean);
      message = `${message} Wellness: ${parts.join(" and ")}.`;
    }
  } catch (e) {
    ok = false;
    message = `${message} Wellness failed: ${e instanceof Error ? e.message : typeof e === "object" && e && "message" in e ? String(e.message) : String(e)}`;
  }
  revalidatePath("/");
  return { ok, message };
});

/** Something changed (a service was connected): sync it now. */
export function notifyChanged(job: Job) {
  void run(job);
}

/** Syncs one service now and resolves with how it went (null when it isn't set up). */
export async function syncNow(job: Job): Promise<{ at: string; ok: boolean; message: string } | null> {
  if (!jobs[job]) return null;
  const before = status.last[job];
  await run(job);
  const after = status.last[job];
  return after && after !== before ? after : null;
}

/** The latest status: what's running and how each job last went. */
export function syncStatus(): SyncStatus {
  return { ...status, last: { ...status.last } };
}

/** Starts the timers; returns a stop function. */
export function startBackground() {
  const all = () => (Object.keys(jobs) as Job[]).forEach((j) => void run(j));
  const first = setTimeout(all, 3000);
  const timer = setInterval(all, EVERY_MS);
  const onFocus = () => {
    const last = status.last.intervals?.at;
    if (!last || Date.now() - Date.parse(last) > 5 * 60_000) all();
  };
  window.addEventListener("focus", onFocus);
  return () => {
    clearTimeout(first);
    clearInterval(timer);
    window.removeEventListener("focus", onFocus);
  };
}
