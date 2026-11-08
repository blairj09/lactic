// intervals.icu access with a personal API key: rides come in as their original FIT files.

import { gunzipSync } from "node:zlib";
import { rideTimes, saveIntervalsLinks, storeRides, unlinkedRides, type NewRide, type UnlinkedRide } from "../activities";
import { decodeFit, FIT_SPORT_CYCLING } from "../fit/decode";
import { rideFromFit } from "../fit/ride";
import type { createClient } from "../supabase/server";
import { matchActivities, missingStravaRides, nextBatch, sameRide, stravaRides, type IntervalsActivity } from "./batch";
import { mergeWellness, WELLNESS_SOURCE, wellnessDays, type IntervalsWellness, type RecoveryRow } from "../engine/wellness";

type Supabase = Awaited<ReturnType<typeof createClient>>;

const API = "https://intervals.icu/api/v1";
/** How far back a history import goes. */
export const BACKFILL_YEARS = 2;
/** Activities per sync call at most. Each ride is one file download. */
const RIDES_PER_CALL = 25;
/** A call stops downloading after this long, well inside the page's 60 second limit, and the next call carries on. */
const CALL_BUDGET_MS = 35_000;
/** One slow file download mustn't use up the whole call. */
const DOWNLOAD_TIMEOUT_MS = 15_000;
/** Files downloaded at once. */
const PARALLEL_DOWNLOADS = 4;

export class IntervalsError extends Error {}

async function request(apiKey: string, path: string, timeoutMs = 20_000, init: RequestInit = {}): Promise<Response> {
  const response = await fetch(`${API}${path}`, {
    ...init,
    signal: AbortSignal.timeout(timeoutMs),
    headers: {
      authorization: `Basic ${Buffer.from(`API_KEY:${apiKey}`).toString("base64")}`,
      // intervals.icu sits behind Cloudflare, which challenges anonymous clients.
      "user-agent": "MyCoach/1.0 (+https://coach.jamesblair.me)",
    },
    cache: "no-store",
  });
  if (response.status === 401 || response.status === 403) throw new IntervalsError("intervals.icu didn't accept the API key.");
  if (response.status === 429) throw new IntervalsError("intervals.icu's rate limit is reached. Try again in 15 minutes.");
  return response;
}

async function getJson<T>(apiKey: string, path: string): Promise<T> {
  const response = await request(apiKey, path);
  if (!response.ok) throw new IntervalsError(`intervals.icu request failed (${response.status})`);
  return response.json();
}

/** Asks intervals.icu who the key belongs to: resolves with the athlete id, or throws why it failed. */
export async function testKey(apiKey: string): Promise<{ athleteId: string }> {
  const athlete = await getJson<{ id: string }>(apiKey, "/athlete/0");
  return { athleteId: String(athlete.id) };
}

/** Checks the key and saves the connection. */
export async function connect(supabase: Supabase, userId: string, apiKey: string) {
  const athlete = await getJson<{ id: string }>(apiKey, "/athlete/0");
  const { error } = await supabase
    .from("intervals_connections")
    .upsert({ user_id: userId, athlete_id: String(athlete.id), api_key: apiKey, connected_at: new Date().toISOString() }, { onConflict: "user_id" });
  if (error) throw error;
}

export interface IntervalsConnection {
  userId: string;
  apiKey: string;
  newestSyncedLocal: string | null;
  backfillBeforeLocal: string | null;
  backfillDone: boolean;
  lastSyncedAt: Date | null;
  /** Rides recorded here go to intervals.icu unless Zwift or the Karoo sent them. */
  uploadRides: boolean;
  /** Rides in the last two years that came to intervals.icu from Strava and aren't here; null before the first count. */
  stravaMissing: StravaMissing | null;
}

export interface StravaMissing {
  /** How many rides. */
  count: number;
  /** Local start dates (YYYY-MM-DD) of the oldest and newest of them. */
  oldest: string | null;
  newest: string | null;
}

export async function loadConnection(supabase: Supabase): Promise<IntervalsConnection | null> {
  const { data, error } = await supabase.from("intervals_connections").select("*").maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return {
    userId: data.user_id,
    apiKey: data.api_key,
    newestSyncedLocal: data.newest_synced_local,
    backfillBeforeLocal: data.backfill_before_local,
    backfillDone: data.backfill_done,
    lastSyncedAt: data.last_synced_at ? new Date(data.last_synced_at) : null,
    uploadRides: data.upload_rides !== false,
    stravaMissing:
      data.strava_missing === null || data.strava_missing === undefined
        ? null
        : { count: data.strava_missing, oldest: data.strava_missing_oldest ?? null, newest: data.strava_missing_newest ?? null },
  };
}

const day = (d: Date) => d.toISOString().slice(0, 10);

const listActivities = (apiKey: string, oldest: string, newest: string) =>
  getJson<IntervalsActivity[]>(apiKey, `/athlete/0/activities?oldest=${oldest.slice(0, 10)}&newest=${newest.slice(0, 10)}`);

/** Downloads an activity's original file and reads it as a ride; null when it isn't a cycling FIT file. */
async function rideFrom(apiKey: string, activity: IntervalsActivity): Promise<NewRide | null> {
  try {
    const response = await request(apiKey, `/activity/${encodeURIComponent(activity.id)}/file`, DOWNLOAD_TIMEOUT_MS);
    if (!response.ok) return null;
    let bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes[0] === 0x1f && bytes[1] === 0x8b) bytes = new Uint8Array(gunzipSync(bytes));
    const fit = decodeFit(bytes);
    if (fit.sport !== undefined && fit.sport !== FIT_SPORT_CYCLING) return null;
    return { ...rideFromFit(fit, activity.name ?? ""), intervalsId: activity.id };
  } catch (e) {
    // A bad key or the rate limit stops the whole sync; anything else (GPX and TCX originals, a damaged
    // file, a download that timed out) only skips this ride.
    if (e instanceof IntervalsError) throw e;
    return null;
  }
}

/**
 * Reads a batch's rides in order, a few at a time, until the time budget runs out.
 * Returns the rides and how many activities of the batch it got through.
 */
async function ridesFrom(apiKey: string, activities: IntervalsActivity[], deadline: number) {
  const rides: NewRide[] = [];
  let done = 0;
  while (done < activities.length && Date.now() < deadline) {
    const group = activities.slice(done, done + PARALLEL_DOWNLOADS);
    for (const ride of await Promise.all(group.map((a) => rideFrom(apiKey, a)))) if (ride) rides.push(ride);
    done += group.length;
  }
  return { rides, done };
}

/** Runs a batch within the time budget; when it stops early, the cursor is the last activity it read. */
async function readBatch(apiKey: string, next: ReturnType<typeof nextBatch>) {
  const { rides, done } = await ridesFrom(apiKey, next.batch, Date.now() + CALL_BUDGET_MS);
  const finished = done === next.batch.length;
  return {
    rides,
    cursor: finished ? next.cursor : next.batch[done - 1]?.start_date_local ?? null,
    more: next.more || !finished,
  };
}

export interface SyncResult {
  imported: number;
  /** Rides already stored that were matched to their intervals.icu activity. */
  linked: number;
  /** True when there is more to fetch in this direction. */
  more: boolean;
  /** For a history import: the local start time it has reached back to. */
  reachedBack?: string;
  /** On a history import's first call: rides in range that came from Strava, which can't be imported. */
  fromStrava?: number;
  /** On a regular sync: new rides that came from Strava and couldn't be read. */
  newFromStrava?: number;
  /** Rides recorded here that were sent to intervals.icu. */
  sent?: number;
}

async function update(supabase: Supabase, connection: IntervalsConnection, fields: Record<string, unknown>) {
  const { error } = await supabase.from("intervals_connections").update(fields).eq("user_id", connection.userId);
  if (error) throw error;
}

const backfillCutoff = () => {
  const cutoff = new Date();
  cutoff.setFullYear(cutoff.getFullYear() - BACKFILL_YEARS);
  return cutoff;
};

/**
 * Links stored rides that have no intervals.icu activity yet (imported as FIT files, or before the id
 * was kept) to the listed activity that starts at the same time.
 */
async function linkRides(supabase: Supabase, listed: IntervalsActivity[], rides?: UnlinkedRide[]) {
  const unlinked = rides ?? (await unlinkedRides(supabase, backfillCutoff()));
  return saveIntervalsLinks(supabase, unlinked, matchActivities(unlinked, listed));
}

/**
 * Counts the Strava rides in a two-year listing that no stored ride covers, and saves the count so
 * Settings can say plainly what's missing and how to bring it in.
 */
async function countStravaMissing(supabase: Supabase, connection: IntervalsConnection, listed: IntervalsActivity[]): Promise<IntervalsActivity[]> {
  const missing = missingStravaRides(listed, await rideTimes(supabase, backfillCutoff()));
  await update(supabase, connection, {
    strava_missing: missing.length,
    strava_missing_oldest: missing[0]?.start_date_local.slice(0, 10) ?? null,
    strava_missing_newest: missing.at(-1)?.start_date_local.slice(0, 10) ?? null,
  });
  return missing;
}

const historyRange = () => [day(backfillCutoff()), day(new Date(Date.now() + 86_400_000))] as const;

/** Rides newer than the newest one synced, a batch at a time, oldest first. */
export async function syncNew(supabase: Supabase, connection: IntervalsConnection): Promise<SyncResult> {
  // First sync: start from a week back; the history import covers the rest.
  const after = connection.newestSyncedLocal ?? `${day(new Date(Date.now() - 7 * 86_400_000))}T00:00:00`;
  const listed = await listActivities(connection.apiKey, after, day(new Date(Date.now() + 86_400_000)));
  // Rides sent from here are already stored as the app ride.
  const ours = await sentIds(supabase, listed);
  const next = nextBatch(listed, { after }, RIDES_PER_CALL);
  const { rides, cursor, more } = await readBatch(connection.apiKey, { ...next, batch: next.batch.filter((a) => !ours.has(a.id)) });
  const { saved } = await storeRides(supabase, rides);
  // Rides stored without their intervals.icu id get it from one listing of the history: a single request,
  // made while any ride from the last BACKFILL_YEARS is unlinked (some, like FIT files intervals.icu never got, stay so).
  const unlinked = await unlinkedRides(supabase, backfillCutoff());
  // Strava rides in the stretch this sync walked, or ones still missing (a FIT import may have filled
  // them in since), mean a fresh count.
  const walked = cursor ? listed.filter((a) => a.start_date_local > after && a.start_date_local <= cursor) : [];
  const recount = stravaRides(walked) > 0 || (connection.stravaMissing?.count ?? 0) > 0;
  const history = unlinked.length || recount ? await listActivities(connection.apiKey, ...historyRange()) : [];
  const linked = unlinked.length ? await linkRides(supabase, history, unlinked) : 0;
  const missing = recount ? await countStravaMissing(supabase, connection, history) : [];
  const walkedIds = new Set(walked.map((a) => a.id));
  const newFromStrava = missing.filter((a) => walkedIds.has(a.id)).length;
  const sent = connection.uploadRides ? await sendRides(supabase, connection) : 0;
  await update(supabase, connection, { newest_synced_local: cursor ?? after, last_synced_at: new Date().toISOString() });
  return { imported: saved, linked, more, sent, ...(newFromStrava ? { newFromStrava } : {}) };
}

/** Walks back through history, a batch at a time, until BACKFILL_YEARS ago. */
export async function syncHistory(supabase: Supabase, connection: IntervalsConnection): Promise<SyncResult> {
  if (connection.backfillDone) return { imported: 0, linked: 0, more: false };
  const cutoff = backfillCutoff();
  const before = connection.backfillBeforeLocal ?? "9999-12-31T00:00:00";
  const newest = connection.backfillBeforeLocal ?? day(new Date(Date.now() + 86_400_000));
  const listed = await listActivities(connection.apiKey, day(cutoff), newest);
  const next = nextBatch(listed, { before }, RIDES_PER_CALL);
  const { rides, cursor, more } = await readBatch(connection.apiKey, next);
  const { saved } = await storeRides(supabase, rides);
  // Each call lists the whole range anyway, so the first one links every stored ride it can.
  const linked = connection.backfillBeforeLocal ? 0 : await linkRides(supabase, listed);
  if (!connection.backfillBeforeLocal) await countStravaMissing(supabase, connection, listed);

  const fields: Record<string, unknown> = { backfill_before_local: cursor ?? before, backfill_done: !more };
  // History also counts as seen, so the next regular sync doesn't refetch it.
  if (!connection.newestSyncedLocal) {
    const newestSeen = listed.reduce((latest, a) => (a.start_date_local > latest ? a.start_date_local : latest), "");
    if (newestSeen) fields.newest_synced_local = newestSeen;
  }
  await update(supabase, connection, fields);
  return {
    imported: saved,
    linked,
    more,
    reachedBack: cursor ?? undefined,
    fromStrava: connection.backfillBeforeLocal ? undefined : stravaRides(listed),
  };
}

/** intervals.icu ids among `listed` that are rides sent from here. */
async function sentIds(supabase: Supabase, listed: IntervalsActivity[]): Promise<Set<string>> {
  if (!listed.length) return new Set();
  const { data, error } = await supabase
    .from("intervals_uploads")
    .select("intervals_id")
    .eq("status", "sent")
    .in("intervals_id", listed.map((a) => a.id));
  if (error) throw error;
  return new Set(data.map((r) => r.intervals_id));
}

/** Zwift and the Karoo send their file when the ride ends; a ride recorded here waits this long after it ends for theirs. */
const UPLOAD_WAIT_MS = 15 * 60_000;
/** Rides still waiting after this long (intervals.icu kept refusing them) stop being tried. */
const UPLOAD_GIVE_UP_MS = 7 * 86_400_000;
/** A send still marked as going after this long was cut off, and is tried again. */
const STALE_SEND_MS = 10 * 60_000;

/** Queues a ride recorded here to go to intervals.icu on a later sync. */
export async function queueRide(supabase: Supabase, activityId: string, fit: Uint8Array) {
  const { error } = await supabase
    .from("intervals_uploads")
    .upsert({ activity_id: activityId, fit_base64: Buffer.from(fit).toString("base64"), status: "pending", updated_at: new Date().toISOString() }, { onConflict: "activity_id" });
  if (error) throw error;
}

async function setUpload(supabase: Supabase, activityId: string, fields: Record<string, unknown>, onlyIf?: string) {
  let query = supabase.from("intervals_uploads").update({ ...fields, updated_at: new Date().toISOString() }).eq("activity_id", activityId);
  if (onlyIf) query = query.eq("status", onlyIf);
  const { data, error } = await query.select("activity_id");
  if (error) throw error;
  return data.length > 0;
}

/**
 * Sends queued rides recorded here that are old enough, skipping any that Zwift, the Karoo or Strava
 * already brought to intervals.icu. Returns how many it sent.
 */
async function sendRides(supabase: Supabase, connection: IntervalsConnection): Promise<number> {
  const { data, error } = await supabase
    .from("intervals_uploads")
    .select("activity_id, fit_base64, status, created_at, updated_at, activities(name, started_at, duration_seconds)")
    .in("status", ["pending", "sending"]);
  if (error) throw error;
  const now = Date.now();
  const waiting = data.flatMap((u) => {
    const ride = Array.isArray(u.activities) ? u.activities[0] : u.activities;
    if (u.status === "sending" && now - Date.parse(u.updated_at) < STALE_SEND_MS) return [];
    if (!ride || !u.fit_base64) return [];
    const startedAt = new Date(ride.started_at);
    const ends = startedAt.getTime() + ride.duration_seconds * 1000;
    return [{ id: u.activity_id as string, status: u.status as string, fit: u.fit_base64 as string, name: ride.name as string, startedAt, durationSeconds: ride.duration_seconds as number, ends, created: Date.parse(u.created_at) }];
  });
  for (const u of waiting.filter((u) => now - u.created > UPLOAD_GIVE_UP_MS)) await setUpload(supabase, u.id, { status: "skipped", fit_base64: null });
  const due = waiting.filter((u) => now - u.created <= UPLOAD_GIVE_UP_MS && now - u.ends >= UPLOAD_WAIT_MS);
  if (!due.length) return 0;

  const from = new Date(Math.min(...due.map((u) => u.startedAt.getTime())) - 86_400_000);
  const listed = await listActivities(connection.apiKey, day(from), day(new Date(now + 86_400_000)));
  let sent = 0;
  for (const u of due) {
    const same = sameRide(u, listed);
    if (same) {
      await setUpload(supabase, u.id, { status: "skipped", intervals_id: same.id, fit_base64: null });
      continue;
    }
    // Claim it first, so two syncs at once don't both send it.
    if (!(await setUpload(supabase, u.id, { status: "sending" }, u.status))) continue;
    try {
      const result = await uploadFit(connection.apiKey, u.name, u.startedAt, Buffer.from(u.fit, "base64"));
      if (result === "refused") {
        // intervals.icu read the file and said no (a duplicate, say): trying again won't change that.
        await setUpload(supabase, u.id, { status: "skipped", fit_base64: null });
        continue;
      }
      await setUpload(supabase, u.id, { status: "sent", intervals_id: result.id, fit_base64: null });
      sent++;
      // The ride's link to its intervals.icu page; a ride without one is still sent.
      if (result.id) {
        const { error: linkError } = await supabase.from("activities").update({ intervals_id: result.id }).eq("id", u.id);
        if (linkError) console.error(`Couldn't link ride ${u.id} to intervals.icu:`, linkError);
      }
    } catch (e) {
      await setUpload(supabase, u.id, { status: "pending" });
      // A bad key or the rate limit stops the sync; anything else (intervals.icu down, a timeout) waits for the next one.
      if (e instanceof IntervalsError) throw e;
      console.error(`intervals.icu upload of ride ${u.id} failed:`, e);
    }
  }
  return sent;
}

/** Uploads a FIT file as a new activity: its intervals.icu id, or "refused" when intervals.icu turned the file down. */
async function uploadFit(apiKey: string, name: string, startedAt: Date, fit: Uint8Array): Promise<{ id: string | null } | "refused"> {
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(fit)], { type: "application/vnd.ant.fit" }), "ride.fit");
  const query = new URLSearchParams({ name, external_id: `mycoach-${startedAt.toISOString()}` });
  const response = await request(apiKey, `/athlete/0/activities?${query}`, 30_000, { method: "POST", body: form });
  if (response.status >= 400 && response.status < 500) {
    console.error(`intervals.icu refused the ride "${name}" (${response.status}):`, await response.text().catch(() => ""));
    return "refused";
  }
  if (!response.ok) throw new Error(`intervals.icu upload failed (${response.status})`);
  const body: { id?: string; activities?: { id?: string }[] } = await response.json().catch(() => ({}));
  return { id: body.id ?? body.activities?.[0]?.id ?? null };
}

/** Turns sending rides recorded here on or off. */
export async function setUploadRides(supabase: Supabase, connection: IntervalsConnection, on: boolean) {
  await update(supabase, connection, { upload_rides: on });
}

/** Starts the history import over, so every ride is read again (to fill in data added since it was imported). */
export async function restartHistory(supabase: Supabase, connection: IntervalsConnection) {
  await update(supabase, connection, { backfill_before_local: null, backfill_done: false });
}

export async function disconnect(supabase: Supabase, connection: IntervalsConnection) {
  const { error } = await supabase.from("intervals_connections").delete().eq("user_id", connection.userId);
  if (error) throw error;
}

/** Days of wellness read on each sync: enough for the recovery baseline, in one request. */
const WELLNESS_DAYS = 90;

export interface WellnessResult {
  /** Mornings written or filled in. */
  mornings: number;
  /** Weigh-ins added. */
  weighIns: number;
}

/**
 * Reads intervals.icu's wellness (sleep, HRV, resting HR, breathing and weight from Garmin, Oura, WHOOP,
 * Polar, Coros and others) into recovery_days and body_measurements. Other sources' numbers win;
 * intervals.icu fills what they left empty.
 */
export async function syncWellness(supabase: Supabase, connection: IntervalsConnection): Promise<WellnessResult> {
  const oldest = day(new Date(Date.now() - WELLNESS_DAYS * 86_400_000));
  const newest = day(new Date(Date.now() + 86_400_000));
  const records = await getJson<IntervalsWellness[]>(connection.apiKey, `/athlete/0/wellness?oldest=${oldest}&newest=${newest}`);
  const days = wellnessDays(Array.isArray(records) ? records : []);
  if (!days.length) return { mornings: 0, weighIns: 0 };

  const { data: existing, error } = await supabase
    .from("recovery_days")
    .select("day, hrv_ms, hrv_kind, resting_hr, sleep_hours, respiratory_rate, source")
    .in("day", days.map((d) => d.day));
  if (error) throw error;
  const prior = new Map(((existing ?? []) as RecoveryRow[]).map((r) => [String(r.day).slice(0, 10), r]));
  const rows = days.flatMap((d) => mergeWellness(prior.get(d.day), d) ?? []);
  if (rows.length) {
    const { error: upsertError } = await supabase.from("recovery_days").upsert(rows, { onConflict: "user_id,day" });
    if (upsertError) throw upsertError;
  }

  // Weight only on days with no weigh-in from anywhere else (the Body Pod, say), so a scale isn't counted twice.
  const weights = days.filter((d) => d.weightKg !== null);
  let weighIns = 0;
  if (weights.length) {
    const { data: measured, error: bodyError } = await supabase
      .from("body_measurements")
      .select("measured_at")
      .gte("measured_at", `${weights[0].day}T00:00:00Z`);
    if (bodyError) throw bodyError;
    const weighed = new Set(((measured ?? []) as { measured_at: string }[]).map((m) => new Date(m.measured_at).toISOString().slice(0, 10)));
    const fresh = weights
      .filter((d) => !weighed.has(d.day))
      .map((d) => ({ measured_at: `${d.day}T12:00:00Z`, weight_kg: d.weightKg, body_fat_pct: d.bodyFatPct, source: WELLNESS_SOURCE }));
    if (fresh.length) {
      const { error: insertError } = await supabase.from("body_measurements").insert(fresh);
      if (insertError) throw insertError;
      weighIns = fresh.length;
    }
  }
  return { mornings: rows.length, weighIns };
}
