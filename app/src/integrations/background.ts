// Work that runs while the app is open: pulling new rides and wellness from connected services,
// and walking back through history after a first connect. One job at a time, quietly.

import { syncIntervals } from "@/app/actions";
import { loadConnection } from "@/lib/intervals/client";
import { createClient } from "~/db/supabase-client";
import { revalidatePath } from "~/shims/next-cache";

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
      if (result) status.last[job] = { at: new Date().toISOString(), ...result };
    } catch (e) {
      status.last[job] = { at: new Date().toISOString(), ok: false, message: e instanceof Error ? e.message : String(e) };
    } finally {
      status.running = null;
      publish();
    }
  });
  return queue;
}

registerJob("intervals", async () => {
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
  revalidatePath("/");
  return { ok, message };
});

/** Something changed (a service was connected): sync it now. */
export function notifyChanged(job: Job) {
  void run(job);
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
