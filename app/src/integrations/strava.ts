// Strava: rides recorded in Lactic are posted to the rider's Strava as Lactic activities, titled
// with the workout and described with how each interval went (web/lib/strava/describe.ts).
//
// Sign-in and token refreshes happen in the Rust core (src-tauri/src/strava.rs) through the
// lactic.fit relay, which holds Strava's client secret; the tokens stay in the keychain and uploads
// carry the `keychain:strava` placeholder. Experimental for now (Settings → Experimental features).
//
// A ride is queued when it's saved and sent by the "strava" background job: upload the FIT file,
// then check back until Strava has made the activity.

import { experiments } from "@/lib/experiments";
import type { RideInterval } from "@/lib/engine/ride-detail";
import type { Workout } from "@/lib/engine/workout";
import { stravaDescription, stravaTitle } from "@/lib/strava/describe";
import { encodeRideFit } from "@/lib/fit/encode";
import { loadStream } from "@/lib/activities";
import { createClient } from "~/db/supabase-client";
import { invoke, isDesktop } from "~/platform/native";
import { placeholder } from "~/platform/secrets";
import { revalidatePath } from "~/shims/next-cache";
import { logEvent } from "~/support/log";
import { notifyChanged, registerJob } from "./background";

export const STRAVA_RELAY = "https://lactic.fit/api/strava";
export const SECRET_STRAVA = "strava";
const API = "https://www.strava.com/api/v3";
/** Strava's own orange, for the Connect with Strava button and its mark. */
export const STRAVA_ORANGE = "#FC5200";

/** Uploads that keep failing (Strava down, a file it can't read) stop being tried after this many goes. */
const MAX_TRIES = 6;
/** A send still marked as going after this long was cut off, and is tried again. */
const STALE_SEND_MS = 10 * 60_000;
/** Rides older than this when they'd go are dropped from the queue instead. */
const GIVE_UP_MS = 7 * 86_400_000;

type Db = ReturnType<typeof createClient>;

export interface StravaConnection {
  athleteId: string;
  athleteName: string;
  uploadRides: boolean;
  needsReconnect: boolean;
  connectedAt: string;
}

export interface StravaUpload {
  activityId: string;
  status: "pending" | "sending" | "processing" | "sent" | "skipped" | "failed";
  stravaId: string | null;
  error: string | null;
  updatedAt: string;
  name: string | null;
}

/** On when the Strava experiment is on. */
export const stravaOn = () => experiments().strava_upload === true;

/** The relay's public client id, or null when Strava isn't switched on for Lactic yet (or lactic.fit can't be reached). */
export async function stravaClientId(): Promise<string | null> {
  try {
    const res = await fetch(STRAVA_RELAY, { headers: { "x-lactic-client": "lactic" } });
    if (!res.ok) return null;
    const body: { clientId?: string } = await res.json();
    return body.clientId && /^\d+$/.test(body.clientId) ? body.clientId : null;
  } catch {
    return null;
  }
}

export async function loadStrava(db: Db = createClient()): Promise<StravaConnection | null> {
  const { data, error } = await db.from("strava_connections").select("*").maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return {
    athleteId: data.athlete_id,
    athleteName: data.athlete_name ?? "",
    uploadRides: data.upload_rides !== false,
    needsReconnect: data.needs_reconnect === true,
    connectedAt: data.connected_at,
  };
}

/** Opens Strava's sign-in in the browser and saves the connection once the rider allows Lactic. */
export async function connectStrava(): Promise<StravaConnection> {
  if (!isDesktop) throw new Error("Strava connects in the desktop app.");
  const clientId = await stravaClientId();
  if (!clientId) throw new Error("Strava isn't switched on for Lactic yet, or lactic.fit can't be reached. Try again later.");
  const who = await invoke<{ athleteId: string; name: string; scope: string }>("strava_connect", { clientId });
  const db = createClient();
  const { error } = await db
    .from("strava_connections")
    .upsert(
      { athlete_id: who.athleteId, athlete_name: who.name, scope: who.scope, needs_reconnect: false, connected_at: new Date().toISOString(), updated_at: new Date().toISOString() },
      { onConflict: "user_id" },
    );
  if (error) throw error;
  logEvent("strava", "info", "Connected to Strava.");
  notifyChanged("strava");
  return (await loadStrava(db))!;
}

export async function disconnectStrava() {
  if (isDesktop) await invoke("strava_disconnect").catch((e) => logEvent("strava", "error", `Couldn't sign out of Strava: ${String(e)}`));
  const db = createClient();
  const { error } = await db.from("strava_connections").delete().eq("athlete_id", (await loadStrava(db))?.athleteId ?? "");
  if (error) throw error;
  // Rides still waiting won't go anywhere now.
  await db.from("strava_uploads").update({ status: "skipped", fit_base64: null, error: "Strava was disconnected." }).in("status", ["pending", "sending"]);
  logEvent("strava", "info", "Disconnected from Strava.");
}

export async function setStravaUploads(on: boolean) {
  const db = createClient();
  const { error } = await db.from("strava_connections").update({ upload_rides: on, updated_at: new Date().toISOString() }).neq("athlete_id", "");
  if (error) throw error;
}

/** Queues a ride recorded here for Strava, when Strava is connected and posting is on. */
export async function queueStravaRide(activityId: string, fit: Uint8Array) {
  if (!stravaOn()) return;
  const db = createClient();
  const connection = await loadStrava(db);
  if (!connection?.uploadRides) return;
  const { error } = await db
    .from("strava_uploads")
    .upsert({ activity_id: activityId, fit_base64: toBase64(fit), status: "pending", tries: 0, error: null, updated_at: new Date().toISOString() }, { onConflict: "activity_id" });
  if (error) throw error;
  notifyChanged("strava");
}

/** A ride's place on the way to Strava, for its ride page: null when it was never sent. */
export async function stravaUploadFor(activityId: string): Promise<StravaUpload | null> {
  const db = createClient();
  const { data, error } = await db.from("strava_uploads").select("activity_id, status, strava_id, error, updated_at").eq("activity_id", activityId).maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return { activityId: data.activity_id, status: data.status, stravaId: data.strava_id ?? null, error: data.error ?? null, updatedAt: data.updated_at, name: null };
}

/** Sends an earlier ride recorded here to Strava (rides saved before Strava was connected, or one that failed). */
export async function postRideToStrava(activityId: string) {
  if (!stravaOn()) throw new Error("Turn on Post rides to Strava in Settings → Experimental features first.");
  const db = createClient();
  const connection = await loadStrava(db);
  if (!connection) throw new Error("Connect Strava in Settings → Connections first.");
  if (connection.needsReconnect) throw new Error("Strava signed Lactic out. Connect Strava again in Settings.");
  const { data: ride, error } = await db.from("activities").select("started_at").eq("id", activityId).maybeSingle();
  if (error) throw error;
  const stream = await loadStream(db, activityId);
  if (!ride || !stream || !(stream.watts?.length || stream.heartRate?.length)) throw new Error("This ride has no recording to send.");
  const fit = encodeRideFit({
    startedAt: new Date(ride.started_at),
    watts: stream.watts ?? [],
    heartRate: stream.heartRate ?? [],
    cadence: stream.cadence ?? [],
    stepSeconds: stream.step,
    indoor: !stream.route?.length,
    route: stream.route ?? null,
  });
  const { error: queueError } = await db
    .from("strava_uploads")
    .upsert({ activity_id: activityId, fit_base64: toBase64(fit), status: "pending", tries: 0, error: null, strava_id: null, upload_id: null, created_at: new Date().toISOString(), updated_at: new Date().toISOString() }, { onConflict: "activity_id" });
  if (queueError) throw queueError;
  notifyChanged("strava");
}

/** The latest uploads, newest first, for Settings. */
export async function recentStravaUploads(limit = 5): Promise<StravaUpload[]> {
  const db = createClient();
  const { data, error } = await db.from("strava_uploads").select("activity_id, status, strava_id, error, updated_at").order("updated_at", { ascending: false }).limit(limit);
  if (error) throw error;
  const ids = (data ?? []).map((u) => u.activity_id as string);
  const names = new Map<string, string | null>();
  if (ids.length) {
    const { data: rides } = await db.from("activities").select("id, name").in("id", ids);
    for (const r of rides ?? []) names.set(r.id as string, (r.name as string | null) ?? null);
  }
  return (data ?? []).map((u) => ({
    activityId: u.activity_id,
    status: u.status,
    stravaId: u.strava_id ?? null,
    error: u.error ?? null,
    updatedAt: u.updated_at,
    name: names.get(u.activity_id) ?? null,
  }));
}

export const stravaActivityUrl = (id: string) => `https://www.strava.com/activities/${id}`;

function toBase64(bytes: Uint8Array) {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

function fromBase64(b64: string) {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

class Reconnect extends Error {}

async function setUpload(db: Db, activityId: string, fields: Record<string, unknown>, onlyIf?: string) {
  let query = db.from("strava_uploads").update({ ...fields, updated_at: new Date().toISOString() }).eq("activity_id", activityId);
  if (onlyIf) query = query.eq("status", onlyIf);
  const { data, error } = await query.select("activity_id");
  if (error) throw error;
  return data.length > 0;
}

/** Strava's reply to an upload, and to checking on one. */
interface UploadReply {
  id?: number;
  id_str?: string;
  error?: string | null;
  status?: string;
  activity_id?: number | null;
}

async function strava(path: string, init: RequestInit = {}): Promise<Response> {
  const res = await fetch(`${API}${path}`, { ...init, headers: { ...(init.headers ?? {}), authorization: `Bearer ${placeholder(SECRET_STRAVA)}` } });
  if (res.status === 401) throw new Reconnect("Strava signed Lactic out. Connect Strava again.");
  if (res.status === 429) throw new Error("Strava's rate limit is reached. Rides go on the next try.");
  return res;
}

/** What to post: the title and description, from the stored ride. */
async function describeRide(db: Db, activityId: string) {
  const { data: ride, error } = await db
    .from("activities")
    .select("name, started_at, duration_seconds, average_power, normalized_power, training_stress, intensity_factor, average_hr")
    .eq("id", activityId)
    .maybeSingle();
  if (error) throw error;
  if (!ride) return null;
  const { data: stream } = await db.from("activity_streams").select("workout, intervals").eq("activity_id", activityId).maybeSingle();
  const posted = {
    name: ride.name ?? null,
    durationSeconds: ride.duration_seconds,
    averagePower: ride.average_power ?? null,
    normalizedPower: ride.normalized_power ?? null,
    trainingStress: ride.training_stress ?? null,
    intensityFactor: ride.intensity_factor ?? null,
    averageHr: ride.average_hr ?? null,
    workout: (stream?.workout as Workout | null) ?? null,
    intervals: (stream?.intervals as RideInterval[] | null) ?? null,
  };
  return { startedAt: ride.started_at as string, name: stravaTitle(posted), description: stravaDescription(posted) };
}

/** Sends one queued ride; resolves with what Strava said. */
async function send(db: Db, activityId: string, fitBase64: string) {
  const ride = await describeRide(db, activityId);
  if (!ride) return setUpload(db, activityId, { status: "skipped", fit_base64: null, error: "The ride was deleted." });
  const form = new FormData();
  form.append("file", new Blob([fromBase64(fitBase64) as BlobPart], { type: "application/vnd.ant.fit" }), "ride.fit");
  form.append("data_type", "fit");
  form.append("name", ride.name);
  form.append("description", ride.description);
  form.append("trainer", "1");
  form.append("external_id", `lactic-${ride.startedAt}`);
  const res = await strava("/uploads", { method: "POST", body: form });
  const reply: UploadReply = await res.json().catch(() => ({}));
  if (!res.ok || reply.error) return uploadFailed(db, activityId, res.status, reply.error ?? `Strava didn't take the ride (${res.status}).`);
  const uploadId = reply.id_str ?? (reply.id !== undefined ? String(reply.id) : null);
  if (reply.activity_id) return setUpload(db, activityId, { status: "sent", upload_id: uploadId, strava_id: String(reply.activity_id), fit_base64: null, error: null });
  return setUpload(db, activityId, { status: "processing", upload_id: uploadId, error: null });
}

/** Strava read the file and said no. A duplicate is skipped; anything else is tried again a few times. */
async function uploadFailed(db: Db, activityId: string, status: number, error: string) {
  const duplicate = /duplicate/i.test(error);
  const { data } = await db.from("strava_uploads").select("tries").eq("activity_id", activityId).maybeSingle();
  const tries = ((data?.tries as number | undefined) ?? 0) + 1;
  const final = duplicate || tries >= MAX_TRIES || (status >= 400 && status < 500 && status !== 408);
  const id = duplicate ? error.match(/activities\/(\d+)/)?.[1] ?? null : null;
  return setUpload(db, activityId, {
    status: duplicate ? "skipped" : final ? "failed" : "pending",
    tries,
    error: duplicate ? "Already on Strava." : error.slice(0, 300),
    ...(id ? { strava_id: id } : {}),
    ...(final ? { fit_base64: null } : {}),
  });
}

/** Checks on an upload Strava is still processing. */
async function check(db: Db, activityId: string, uploadId: string) {
  const res = await strava(`/uploads/${uploadId}`);
  const reply: UploadReply = await res.json().catch(() => ({}));
  if (reply.error) return uploadFailed(db, activityId, 422, reply.error);
  if (reply.activity_id) return setUpload(db, activityId, { status: "sent", strava_id: String(reply.activity_id), fit_base64: null, error: null });
}

/** The background job: refresh the token, send what's waiting, and check on what Strava is processing. */
export async function syncStrava(): Promise<{ ok: boolean; message: string } | void> {
  if (!isDesktop || !stravaOn()) return;
  const db = createClient();
  const connection = await loadStrava(db);
  if (!connection || connection.needsReconnect) return;
  const { data, error } = await db.from("strava_uploads").select("activity_id, fit_base64, status, upload_id, created_at, updated_at").in("status", ["pending", "sending", "processing"]);
  if (error) throw error;
  const now = Date.now();
  const waiting = (data ?? []).filter((u) => !(u.status === "sending" && now - Date.parse(u.updated_at) < STALE_SEND_MS));
  if (!waiting.length) return;

  try {
    await invoke("strava_refresh");
  } catch (e) {
    if (String(e).startsWith("reconnect:")) {
      await db.from("strava_connections").update({ needs_reconnect: true }).neq("athlete_id", "");
      return { ok: false, message: "Strava needs connecting again." };
    }
    throw new Error(String(e));
  }

  let sent = 0;
  try {
    for (const u of waiting) {
      if (u.status === "processing" && u.upload_id) {
        await check(db, u.activity_id, u.upload_id);
        continue;
      }
      if (now - Date.parse(u.created_at) > GIVE_UP_MS || !u.fit_base64) {
        await setUpload(db, u.activity_id, { status: "failed", fit_base64: null, error: "Couldn't post it within a week." });
        continue;
      }
      // Claim it first, so two runs at once don't both send it.
      if (!(await setUpload(db, u.activity_id, { status: "sending" }, u.status))) continue;
      try {
        await send(db, u.activity_id, u.fit_base64);
        sent++;
      } catch (e) {
        await setUpload(db, u.activity_id, { status: "pending" });
        throw e;
      }
    }
  } catch (e) {
    if (e instanceof Reconnect) {
      await db.from("strava_connections").update({ needs_reconnect: true }).neq("athlete_id", "");
      return { ok: false, message: e.message };
    }
    throw e;
  }
  const { data: still } = await db.from("strava_uploads").select("activity_id").eq("status", "processing");
  if (still?.length) checkSoon();
  revalidatePath("/settings");
  return { ok: true, message: sent ? `Posted ${sent} ride${sent === 1 ? "" : "s"} to Strava.` : "Checked rides on their way to Strava." };
}

registerJob("strava", syncStrava);

// A ride that's still processing on Strava is looked at again a minute later rather than in 20.
let followUp: ReturnType<typeof setTimeout> | null = null;
export function checkSoon() {
  if (followUp) clearTimeout(followUp);
  followUp = setTimeout(() => notifyChanged("strava"), 60_000);
}
