"use server";

import { revalidatePath } from "next/cache";
import { loadAthlete, recomputeStress, storeRides, type NewRide, type RideStream } from "@/lib/activities";
import { localDate, SOURCE_PRIORITY, summarizeRide } from "@/lib/engine/activity";
import { bodyComposition, bodyCompositionFromReported, type SegmentImpedance } from "@/lib/engine/body";
import * as intervals from "@/lib/intervals/client";
import { WORKOUT_DAYS } from "@/lib/intervals/calendar";
import { pushPlan } from "@/lib/intervals/push";
import { encodeRideFit } from "@/lib/fit/encode";
import { addDays } from "@/lib/engine/pmc";
import { readWorkout } from "@/lib/engine/workout-edit";
import { chartStream, MAX_ROUTE_POINTS, rideIntervals, type RoutePoint } from "@/lib/engine/ride-detail";
import { createIngestToken } from "@/lib/recovery-data";
import { loadTrainingState, ridesFor, sessionFor } from "@/lib/training";
import { firstTestDay, ftpIsGuess, retestDay } from "@/lib/engine/ftp-check";
import { rampTest } from "@/lib/engine/library";
import { dayMinutes } from "@/lib/engine/plan";
import { pushChangedPlan, writeDays } from "@/lib/plan-changes";
import { createAdminClient } from "@/lib/supabase/admin";
import { allowedEmail, isAllowedEmail } from "@/lib/supabase/config";
import { createClient } from "@/lib/supabase/server";
import { formatWeight, readUnits } from "@/lib/units";
import { deleteSecret, placeholder, saveSecret, SECRET_INTERVALS } from "~/platform/secrets";

export type ActionResult = { ok: true; message: string } | { ok: false; message: string };

const MAX_RIDE_SECONDS = 12 * 3600;

function refresh() {
  revalidatePath("/", "layout");
}

async function attempt(work: () => Promise<string>): Promise<ActionResult> {
  try {
    return { ok: true, message: await work() };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}

/** Rides read from FIT files in the browser. */
export async function importRides(rides: NewRide[]): Promise<ActionResult> {
  return attempt(async () => {
    if (!Array.isArray(rides) || rides.length > 50) throw new Error("Send at most 50 rides at a time");
    for (const ride of rides) checkRide(ride);
    const { saved, copies } = await storeRides(
      await createClient(),
      rides.map((ride) => ({ ...ride, stream: importedStream(ride.stream) })),
    );
    refresh();
    return `Imported ${saved} ride${saved === 1 ? "" : "s"}${copies ? `; ${copies} in this period are copies of rides you already had` : ""}.`;
  });
}

function checkRide(ride: NewRide) {
  const s = ride?.summary;
  const ok =
    SOURCE_PRIORITY.includes(ride.source) &&
    typeof ride.externalId === "string" &&
    ride.externalId.length <= 200 &&
    !Number.isNaN(Date.parse(ride.startedAt)) &&
    s &&
    Number.isFinite(s.durationSeconds) &&
    s.durationSeconds >= 0 &&
    s.durationSeconds <= MAX_RIDE_SECONDS;
  if (!ok) throw new Error(`Couldn't read the ride "${ride?.name ?? "unnamed"}"`);
}

/** A stream sent from the browser with a FIT import, kept only if it looks like one. */
function importedStream(stream: unknown): RideStream | undefined {
  const s = stream as Partial<RideStream> | undefined;
  if (!s || !Number.isInteger(s.step) || s.step! < 1 || s.step! > 60) return undefined;
  const points = MAX_RIDE_SECONDS / s.step!;
  const channel = (values: unknown, max: number) =>
    Array.isArray(values) && values.length <= points ? values.map((v) => (typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= max ? Math.round(v) : 0)) : null;
  const route =
    Array.isArray(s.route) && s.route.length <= MAX_ROUTE_POINTS + 1
      ? s.route.filter(
          (p): p is RoutePoint =>
            Array.isArray(p) && (p.length === 2 || p.length === 3) && p.every((v) => typeof v === "number" && Number.isFinite(v)) && Math.abs(p[0]) <= 90 && Math.abs(p[1]) <= 180,
        )
      : null;
  return { step: s.step!, watts: channel(s.watts, 3000), heartRate: channel(s.heartRate, 250), cadence: channel(s.cadence, 250), target: null, route: route && route.length > 1 ? route : null };
}

/**
 * A ride recorded on the Ride page: 1 Hz samples. `plannedWorkoutId` is the plan day (YYYY-MM-DD) it was ridden for.
 * `target` is the watts asked for each second (null in free ride) and `interval` the workout interval it was in (-1 outside one).
 */
export async function saveAppRide(input: {
  startedAt: string;
  name: string;
  watts: number[];
  heartRate: number[];
  cadence?: number[];
  target?: (number | null)[];
  interval?: number[];
  workout?: unknown;
  plannedWorkoutId?: string;
}): Promise<ActionResult & { rideId?: string }> {
  let rideId: string | undefined;
  const result = await attempt(async () => {
    const { watts, heartRate } = input;
    if (!Array.isArray(watts) || watts.length > MAX_RIDE_SECONDS || watts.length !== heartRate.length) throw new Error("Bad ride data");
    if (watts.length < 60) throw new Error("Rides under a minute aren't saved");
    const clean = (values: number[], max: number) => values.map((v) => (Number.isFinite(v) && v >= 0 && v <= max ? v : 0));
    const sameLength = <T,>(values: T[] | undefined) => (Array.isArray(values) && values.length === watts.length ? values : null);
    const stream = { watts: clean(watts, 3000), heartRate: clean(heartRate, 250) };
    const cadence = clean(sameLength(input.cadence) ?? watts.map(() => 0), 250);
    const target = sameLength(input.target)?.map((v) => (typeof v === "number" && Number.isFinite(v) && v > 0 && v <= 3000 ? Math.round(v) : null)) ?? null;
    const interval = sameLength(input.interval)?.map((v) => (Number.isInteger(v) && v >= 0 ? v : -1)) ?? null;
    const workout = input.workout ? readWorkout(input.workout) : null;
    const summary = summarizeRide({ ...stream, hasPower: stream.watts.some((w) => w > 0), hasHeartRate: stream.heartRate.some((h) => h > 0) });
    const supabase = await createClient();
    const { ids } = await storeRides(supabase, [
      {
        source: "app",
        externalId: input.startedAt,
        name: input.name.slice(0, 200),
        startedAt: input.startedAt,
        distanceMeters: null,
        summary,
        stream: {
          ...chartStream({ ...stream, cadence, target: target ?? undefined }),
          workout,
          intervals: workout && target && interval ? rideIntervals(workout, { interval, target, ...stream, cadence }) : null,
        },
      },
    ]);
    if (input.plannedWorkoutId && /^\d{4}-\d\d-\d\d$/.test(input.plannedWorkoutId)) await linkPlanDay(supabase, input.plannedWorkoutId, input.startedAt);
    // Sent on a later sync, unless Zwift sends the same ride first. The ride is saved either way.
    try {
      const icu = await intervals.loadConnection(supabase);
      if (icu?.uploadRides && ids[0]) await intervals.queueRide(supabase, ids[0], encodeRideFit({ startedAt: new Date(input.startedAt), ...stream, cadence }));
    } catch (e) {
      console.error("Couldn't queue the ride for intervals.icu:", e);
    }
    refresh();
    rideId = ids[0];
    return "Ride saved.";
  });
  return { ...result, rideId };
}

/** Marks the plan day as ridden by this app ride, so its outcome moves the zone's level. */
async function linkPlanDay(supabase: Awaited<ReturnType<typeof createClient>>, day: string, startedAt: string) {
  const { data, error } = await supabase.from("activities").select("id").eq("source", "app").eq("external_id", startedAt).maybeSingle();
  if (error) throw error;
  if (!data) return;
  const { data: updated, error: updateError } = await supabase
    .from("plan_days")
    .update({ activity_id: data.id, updated_at: new Date().toISOString() })
    .eq("day", day)
    .select("day");
  if (updateError) throw updateError;
  if (updated.length) return;
  // Ridden straight from the plan without a check-in: record it as the plan's session.
  const state = await loadTrainingState(supabase);
  const session = sessionFor(state, day, null);
  const { error: insertError } = await supabase
    .from("plan_days")
    .insert({ user_id: state.athlete.userId, day, planned: session, chosen: { option: "asPlanned", session }, activity_id: data.id });
  if (insertError) throw insertError;
}

/**
 * Sets FTP from today on and recomputes stress for every ride. The only place FTP is written: Settings,
 * Today's estimate and a ramp test all come through here, so FTP history and settings agree.
 */
export async function setFtp(watts: number, method: "criticalPower" | "twentyMinute" | "rampTest" | "manual" | "guess" = "manual", wPrime?: number): Promise<ActionResult> {
  return attempt(async () => {
    const rounded = Math.round(watts);
    if (!(rounded > 50 && rounded < 700)) throw new Error("FTP should be between 50 and 700 W");
    const supabase = await createClient();
    const athlete = await loadAthlete(supabase);
    const today = localDate(new Date(), athlete.timezone);
    // One FTP per day: a second change today replaces the first.
    const { error: deleteError } = await supabase.from("ftp_history").delete().eq("effective_date", today);
    if (deleteError) throw deleteError;
    const { error } = await supabase.from("ftp_history").insert({
      user_id: athlete.userId,
      effective_date: today,
      watts: rounded,
      method,
      w_prime_joules: wPrime === undefined ? null : Math.round(wPrime),
    });
    if (error) throw error;
    const { error: settingsError } = await supabase
      .from("athlete_settings")
      .upsert({ user_id: athlete.userId, ftp_watts: rounded, updated_at: new Date().toISOString() }, { onConflict: "user_id" });
    if (settingsError) throw settingsError;
    const changed = await recomputeStress(supabase);
    refresh();
    return `FTP set to ${rounded} W from today${changed ? `; updated stress on ${changed} rides` : ""}.`;
  });
}

/**
 * Takes back an FTP set today (the "FTP looks higher" banner's Undo): removes today's change and goes back to the
 * FTP before it, then recomputes stress.
 */
export async function undoFtp(previous: number): Promise<ActionResult> {
  return attempt(async () => {
    const supabase = await createClient();
    const athlete = await loadAthlete(supabase);
    const today = localDate(new Date(), athlete.timezone);
    const { error } = await supabase.from("ftp_history").delete().eq("effective_date", today);
    if (error) throw error;
    const before = [...athlete.ftpHistory].filter((h) => h.effectiveDate < today).sort((a, b) => b.effectiveDate.localeCompare(a.effectiveDate))[0]?.watts ?? Math.round(previous);
    const { error: settingsError } = await supabase
      .from("athlete_settings")
      .upsert({ user_id: athlete.userId, ftp_watts: before, updated_at: new Date().toISOString() }, { onConflict: "user_id" });
    if (settingsError) throw settingsError;
    await recomputeStress(supabase);
    refresh();
    return `FTP back to ${before} W.`;
  });
}

/** Puts a ramp test on the next good day this week (ftp-check.ts retestDay), in place of what was planned. */
export async function scheduleRampTest(): Promise<ActionResult> {
  return attempt(async () => {
    const supabase = await createClient();
    const state = await loadTrainingState(supabase);
    const date = retestDay(state.plan, state.today, (d) => dayMinutes(d, state.athlete.availability, state.breaks).minutes, ridesFor(state, state.today).length > 0);
    if (!date) throw new Error("No good day for a test in the next week. Pick one on the Plan page and set it to a ramp test.");
    await writeDays(supabase, state, [{ date, session: rampTest() }]);
    const pushed = await pushChangedPlan(supabase);
    refresh();
    const label = new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric", timeZone: "UTC" });
    return `Ramp test planned for ${date === state.today ? "today" : label}.${pushed}`;
  });
}

/**
 * Setup's step for riders who don't know their FTP: while FTP is still the guess from weight, the plan
 * starts with a ramp test on the first good day (ftp-check.ts firstTestDay), and the test sets FTP.
 * Does nothing once FTP has come from a test, an entry or rides.
 */
export async function scheduleFirstTest(): Promise<ActionResult> {
  return attempt(async () => {
    const supabase = await createClient();
    const state = await loadTrainingState(supabase);
    if (!ftpIsGuess(state.athlete.ftpHistory, state.today)) return "";
    // A test needs the trainer, so outdoor-only days don't count.
    const minutes = (d: string) => {
      const day = dayMinutes(d, state.athlete.availability, state.breaks);
      return day.easyOnly ? 0 : day.minutes;
    };
    const date = firstTestDay(state.plan, state.today, minutes, ridesFor(state, state.today).length > 0);
    if (!date) return "No day with time for an FTP test this week. Today will offer one once there is.";
    await writeDays(supabase, state, [{ date, session: rampTest() }]);
    const pushed = await pushChangedPlan(supabase);
    refresh();
    const label = new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric", timeZone: "UTC" });
    return `Your plan starts with an FTP test ${date === state.today ? "today" : `on ${label}`}.${pushed}`;
  });
}

export async function saveSettings(_: ActionResult | null, form: FormData): Promise<ActionResult> {
  return attempt(async () => {
    const supabase = await createClient();
    const athlete = await loadAthlete(supabase);
    const optionalNumber = (name: string, min: number, max: number) => {
      const raw = String(form.get(name) ?? "").trim();
      if (raw === "") return null;
      const n = Number(raw);
      if (!Number.isFinite(n) || n < min || n > max) throw new Error(`${name.replaceAll("_", " ")} should be between ${min} and ${max}`);
      return n;
    };
    const timezone = String(form.get("timezone") ?? "").trim() || athlete.timezone;
    try {
      new Intl.DateTimeFormat("en", { timeZone: timezone });
    } catch {
      throw new Error(`Unknown time zone ${timezone}`);
    }
    const thresholdHr = optionalNumber("threshold_hr", 80, 230);
    const birthDate = String(form.get("birth_date") ?? "").trim() || null;
    if (birthDate && !/^(19|20)\d\d-\d\d-\d\d$/.test(birthDate)) throw new Error("Birth date should look like 1990-05-31");
    const sex = String(form.get("sex") ?? "");
    const { error } = await supabase.from("athlete_settings").upsert(
      {
        user_id: athlete.userId,
        ftp_watts: athlete.ftp,
        threshold_hr: thresholdHr === null ? null : Math.round(thresholdHr),
        max_hr: optionalNumber("max_hr", 100, 240),
        weight_kg: optionalNumber("weight_kg", 30, 200),
        height_cm: optionalNumber("height_cm", 100, 250),
        birth_date: birthDate,
        sex: sex === "male" || sex === "female" ? sex : null,
        sleep_need_hours: optionalNumber("sleep_need_hours", 4, 12) ?? 8,
        timezone,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id" },
    );
    if (error) throw error;

    const ftp = optionalNumber("ftp_watts", 50, 700);
    // Setup sends ftp_method=guess when the rider doesn't know their FTP, so the first test can set it.
    const guess = form.get("ftp_method") === "guess";
    if (ftp !== null && (Math.round(ftp) !== athlete.ftp || (guess && !ftpIsGuess(athlete.ftpHistory, localDate(new Date(), athlete.timezone))))) {
      const result = await setFtp(ftp, guess ? "guess" : "manual");
      if (!result.ok) throw new Error(result.message);
      return `Saved. ${result.message}`;
    }
    if (thresholdHr !== athlete.thresholdHr || timezone !== athlete.timezone) await recomputeStress(supabase);
    refresh();
    return "Saved.";
  });
}

export type SyncBatchResult = ActionResult & { imported?: number; linked?: number; sent?: number; more?: boolean };

/** Saves an intervals.icu API key after checking it works. */
export async function connectIntervals(_: ActionResult | null, form: FormData): Promise<ActionResult> {
  return attempt(async () => {
    const apiKey = String(form.get("api_key") ?? "").trim();
    if (!/^[A-Za-z0-9]{10,100}$/.test(apiKey)) throw new Error("That doesn't look like an intervals.icu API key");
    const supabase = await createClient();
    const athlete = await loadAthlete(supabase);
    // The key goes in the system keychain; the database only holds a placeholder for it.
    await saveSecret(SECRET_INTERVALS, apiKey);
    try {
      await intervals.connect(supabase, athlete.userId, placeholder(SECRET_INTERVALS));
    } catch (e) {
      await deleteSecret(SECRET_INTERVALS).catch(() => {});
      throw e;
    }
    refresh();
    return "intervals.icu connected. Import your history to fill in your fitness.";
  });
}

/** One batch of intervals.icu rides: "new" for recent ones, "history" to walk back through older ones. */
/** "reimport" starts the history import over, then runs its first batch; later batches use "history". */
export async function syncIntervals(mode: "new" | "history" | "reimport"): Promise<SyncBatchResult> {
  try {
    const supabase = await createClient();
    let connection = await intervals.loadConnection(supabase);
    if (!connection) return { ok: false, message: "intervals.icu isn't connected." };
    if (mode === "reimport") {
      await intervals.restartHistory(supabase, connection);
      connection = { ...connection, backfillBeforeLocal: null, backfillDone: false };
    }
    const result = mode === "new" ? await intervals.syncNew(supabase, connection) : await intervals.syncHistory(supabase, connection);
    if (result.imported || result.linked || result.sent) refresh();
    const back = result.reachedBack
      ? ` back to ${new Date(result.reachedBack.slice(0, 10)).toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" })}`
      : "";
    const sent = result.sent ? ` Sent ${result.sent} ride${result.sent === 1 ? "" : "s"} recorded here to intervals.icu.` : "";
    const linked = result.linked ? ` Linked ${result.linked} ride${result.linked === 1 ? "" : "s"} to intervals.icu.` : "";
    const fromStrava = (n: number, when: string) =>
      ` ${n} ride${n === 1 ? "" : "s"} ${when} came to intervals.icu from Strava, which doesn't let it share them, so Lactic couldn't bring ${n === 1 ? "it" : "them"} in. Settings → intervals.icu says how to fix this.`;
    const missing = mode === "new" || connection.backfillBeforeLocal ? 0 : ((await intervals.loadConnection(supabase))?.stravaMissing?.count ?? 0);
    const strava = result.newFromStrava ? fromStrava(result.newFromStrava, "since the last sync") : missing ? fromStrava(missing, "in the last 2 years") : "";
    return {
      ok: true,
      imported: result.imported,
      linked: result.linked,
      sent: result.sent,
      more: result.more,
      message: `Imported ${result.imported} ride${result.imported === 1 ? "" : "s"}${back}.${linked}${sent}${strava}`,
    };
  } catch (e) {
    // Supabase errors are plain objects with a message, not Errors.
    const message = e instanceof Error ? e.message : typeof e === "object" && e && "message" in e ? String(e.message) : String(e);
    console.error(`intervals.icu ${mode} sync failed:`, e);
    return { ok: false, message };
  }
}

/** Whether rides recorded here go to intervals.icu. */
export async function setIntervalsUpload(on: boolean): Promise<ActionResult> {
  return attempt(async () => {
    const supabase = await createClient();
    const connection = await intervals.loadConnection(supabase);
    if (!connection) throw new Error("intervals.icu isn't connected.");
    await intervals.setUploadRides(supabase, connection, on === true);
    refresh();
    return on ? "Rides recorded here will go to intervals.icu." : "Rides recorded here stay here.";
  });
}

export async function disconnectIntervals(): Promise<ActionResult> {
  return attempt(async () => {
    const supabase = await createClient();
    const connection = await intervals.loadConnection(supabase);
    if (connection) await intervals.disconnect(supabase, connection);
    refresh();
    // Forget the API key too, so nothing of the connection is left behind.
    await deleteSecret(SECRET_INTERVALS);
    return "intervals.icu disconnected and its API key removed. Rides already imported stay.";
  });
}

/** A new token for the Apple Health shortcut. Shown once; the old token stops working. */
export async function newHealthToken(): Promise<ActionResult & { token?: string }> {
  try {
    const supabase = await createClient();
    const athlete = await loadAthlete(supabase);
    const token = await createIngestToken(supabase, athlete.userId);
    return { ok: true, message: "New token made. Paste it into the shortcut now; it won't be shown again.", token };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}

const SEGMENT_KEYS: (keyof SegmentImpedance)[] = ["rightArm", "leftArm", "trunk", "rightLeg", "leftLeg"];

function checkSegments(z: unknown): SegmentImpedance | undefined {
  if (z === undefined || z === null) return undefined;
  const record = z as Record<string, unknown>;
  if (!SEGMENT_KEYS.every((k) => typeof record[k] === "number" && Number.isFinite(record[k]) && (record[k] as number) >= 0 && (record[k] as number) < 10_000))
    throw new Error("Bad impedance data");
  return Object.fromEntries(SEGMENT_KEYS.map((k) => [k, record[k]])) as unknown as SegmentImpedance;
}

const SCALE_SOURCES = ["body_pod", "ble_scale", "mi_scale", "qn_scale", "etekcity"];

/**
 * A weigh-in from a smart scale: stores it with body composition and makes it the current weight.
 * Body fat comes from the Body Pod's segment impedance (the engine's equation) or, for standard
 * body composition scales, the scale's own number. Foot-to-foot impedance is kept raw.
 */
export async function saveWeighIn(input: {
  measuredAt: string;
  weightKg: number;
  impedance: { "50"?: unknown; "250"?: unknown };
  source?: string;
  bodyFatPercent?: number | null;
  footImpedanceOhms?: number | null;
}): Promise<ActionResult> {
  return attempt(async () => {
    const measuredAt = new Date(input?.measuredAt);
    const weightKg = Number(input?.weightKg);
    if (Number.isNaN(measuredAt.getTime()) || !(weightKg >= 20 && weightKg <= 300)) throw new Error("Bad weigh-in");
    const impedance = { "50": checkSegments(input.impedance?.["50"]), "250": checkSegments(input.impedance?.["250"]) };
    const source = SCALE_SOURCES.includes(input.source ?? "body_pod") ? (input.source ?? "body_pod") : "ble_scale";
    const reportedFat = typeof input.bodyFatPercent === "number" && Number.isFinite(input.bodyFatPercent) ? input.bodyFatPercent : null;
    const feet = typeof input.footImpedanceOhms === "number" && input.footImpedanceOhms > 0 && input.footImpedanceOhms < 10_000 ? input.footImpedanceOhms : null;

    const supabase = await createClient();
    const athlete = await loadAthlete(supabase);
    const segments = Boolean(impedance["50"] || impedance["250"]);
    if (segments && (athlete.heightCm === null || athlete.sex === null)) throw new Error("Add your height and sex in Settings first");
    const body =
      segments && athlete.heightCm !== null
        ? bodyComposition({ weightKg, heightCm: athlete.heightCm, male: athlete.sex === "male", impedance50kHz: impedance["50"] })
        : bodyCompositionFromReported({ weightKg, heightCm: athlete.heightCm, bodyFatPercent: reportedFat });
    const round = (v: number | null, places: number) => (v === null ? null : Math.round(v * 10 ** places) / 10 ** places);
    const { error } = await supabase.from("body_measurements").upsert(
      {
        user_id: athlete.userId,
        measured_at: measuredAt.toISOString(),
        source,
        weight_kg: round(weightKg, 2),
        bmi: round(body.bmi, 1),
        body_fat_pct: round(body.bodyFatPercent, 1),
        fat_free_mass_kg: round(body.fatFreeMassKg, 2),
        impedance: segments ? impedance : feet !== null ? { feet50kHz: feet } : null,
      },
      { onConflict: "user_id,measured_at" },
    );
    if (error) throw error;
    const { error: settingsError } = await supabase
      .from("athlete_settings")
      .upsert({ user_id: athlete.userId, weight_kg: round(weightKg, 2), updated_at: new Date().toISOString() }, { onConflict: "user_id" });
    if (settingsError) throw settingsError;
    refresh();
    const saved = formatWeight(weightKg, readUnits());
    if (body.bodyFatPercent !== null) return `Saved ${saved}, ${body.bodyFatPercent.toFixed(1)}% body fat.`;
    return source === "body_pod" ? `Saved ${saved}. No body composition this time: the scale needs bare, slightly damp feet and both hands on the handle.` : `Saved ${saved}.`;
  });
}

/**
 * A one-time code for signing in somewhere passkeys can't reach yet: a preview deploy, or a new device before it has
 * a passkey. Made with the Auth admin API, so no email is sent and the email rate limit doesn't apply.
 */
export async function newSignInCode(): Promise<ActionResult & { code?: string }> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const email = allowedEmail();
    if (!email || !isAllowedEmail(user?.email)) throw new Error("Sign in first.");
    const admin = createAdminClient();
    if (!admin) throw new Error("Sign-in codes need SUPABASE_SECRET_KEY set in Vercel (Production).");
    const { data, error } = await admin.auth.admin.generateLink({ type: "magiclink", email });
    if (error) throw error;
    return { ok: true, message: "Enter this on the sign-in page within the hour. It works once.", code: data.properties.email_otp };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}

/** Sends the plan's coming workouts and your goals to the intervals.icu calendar. */
export async function pushIntervalsPlan(): Promise<ActionResult> {
  try {
    const supabase = await createClient();
    const connection = await intervals.loadConnection(supabase);
    if (!connection) return { ok: false, message: "intervals.icu isn't connected." };
    const state = await loadTrainingState(supabase);
    const { sent, removed } = await pushPlan(connection.apiKey, state.plan, state.goals, state.today, state.outdoor);
    if (!sent && !removed) return { ok: true, message: "Your intervals.icu calendar already matches the plan." };
    return { ok: true, message: `Updated your intervals.icu calendar: ${sent} sent, ${removed} removed.` };
  } catch (e) {
    console.error("intervals.icu plan push failed:", e);
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}

const DAY = /^\d{4}-\d\d-\d\d$/;

/** Writes an outdoor-day change, then sends the calendar so the Karoo gets it on its next sync. */
async function changeOutdoor(
  day: string,
  write: (supabase: Awaited<ReturnType<typeof createClient>>) => Promise<{ error: { message: string } | null }>,
  done: string,
  toOutside = true,
): Promise<ActionResult> {
  try {
    const supabase = await createClient();
    // intervals.icu is the only way to the bike computer, so don't mark a day outside without it.
    if (toOutside && !(await intervals.loadConnection(supabase))) {
      return { ok: false, message: "Connect intervals.icu in Settings first. It's how the workout reaches your bike computer." };
    }
    const state = await loadTrainingState(supabase);
    if (!DAY.test(day) || day < state.today || day > addDays(state.today, WORKOUT_DAYS - 1)) {
      throw new Error(`Pick a day in the next ${WORKOUT_DAYS} days.`);
    }
    const { error } = await write(supabase);
    if (error) throw new Error(error.message);
    refresh();
    const connection = await intervals.loadConnection(supabase);
    if (!connection) return { ok: true, message: done };
    const after = await loadTrainingState(supabase);
    await pushPlan(connection.apiKey, after.plan, after.goals, after.today, after.outdoor);
    return { ok: true, message: `${done} It's on your intervals.icu calendar; your bike computer gets it on its next sync.` };
  } catch (e) {
    console.error("outdoor ride change failed:", e);
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}

/** Marks a day as ridden outside with its planned workout, or back indoors. */
export async function setOutdoor(day: string, outside: boolean): Promise<ActionResult> {
  return changeOutdoor(
    day,
    async (supabase) =>
      outside
        ? await supabase.from("outdoor_rides").upsert({ day, workout: null }, { onConflict: "user_id,day" })
        : await supabase.from("outdoor_rides").delete().eq("day", day),
    outside ? "Riding outside." : "Back indoors.",
    outside,
  );
}

/** Sends a workout from the Ride page to a day as its outdoor ride, in place of the plan's. */
export async function sendOutdoorWorkout(day: string, raw: unknown): Promise<ActionResult> {
  const workout = readWorkout(raw);
  if (!workout) return { ok: false, message: "That workout can't be sent." };
  return changeOutdoor(day, async (supabase) => await supabase.from("outdoor_rides").upsert({ day, workout }, { onConflict: "user_id,day" }), `Sent “${workout.name}”.`);
}
