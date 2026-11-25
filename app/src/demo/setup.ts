// Fills a fresh, in-memory database with a believable rider: profile, a 12-week FTP plan, twelve
// weeks of rides, sleep, HRV and weight, the simulated trainer and heart rate strap paired, and the
// scripted coach switched on. Runs on every load, so each visit starts from the same place.

import { summarizeRide } from "@shared/engine/activity";
import { chartStream, rideIntervals } from "@shared/engine/ride-detail";
import { targetAt, workoutDuration, type Workout } from "@shared/engine/workout";
import { libraryWorkout } from "@shared/engine/workout-library";
import { storeRides } from "@shared/activities";
import { rememberDevice, DEVICE_KEYS, forgetDevice } from "@shared/ble/devices";
import { createLocalClient } from "~/db/supa";
import { setSetting } from "~/settings/store";
import { saveProfile } from "~/setup/profile";
import { defaultWeek, saveWeek } from "~/setup/week";
import { grant } from "~/bluetooth/web-bluetooth";
import { addRoute } from "~/platform/fetch";
import { DEFAULT_SETUP } from "~/ai/settings";

const FTP = 268;

function random(seed: number) {
  return () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
}

type Kind = [string, (out: number[]) => void, Workout];

const localDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** A believable night: 90-minute cycles of core, deep (early in the night), core and REM, with a few short wakes. */
function sleepSegments(start: Date, end: Date, rnd: () => number): [number, number, string][] {
  const out: [number, number, string][] = [];
  let t = start.getTime() / 1000;
  const stop = end.getTime() / 1000;
  const push = (minutes: number, stage: string) => {
    if (t >= stop) return;
    const next = Math.min(t + minutes * 60, stop);
    out.push([Math.round(t), Math.round(next), stage]);
    t = next;
  };
  for (let cycle = 0; t < stop; cycle++) {
    push(15 + rnd() * 15, "core");
    push(cycle < 2 ? 30 + rnd() * 20 : cycle < 4 ? 10 + rnd() * 10 : 0, "deep");
    push(15 + rnd() * 10, "core");
    push(10 + cycle * 5 + rnd() * 10, "rem");
    if (rnd() < 0.4) push(2 + rnd() * 6, "awake");
  }
  return out.filter(([a, b]) => b > a);
}

async function seedHistory() {
  const supa = createLocalClient();
  const rnd = random(7);
  // The rides have their own sequence, so changing a workout leaves sleep, HRV and weight as they were.
  const pedal = random(3);
  // Every sample ride is a workout from the library, ridden on target with a little wobble.
  const ride = (id: string, noise: number): Kind => {
    const { workout } = libraryWorkout(id)!;
    return [workout.name, (out) => {
      for (let t = 0, n = workoutDuration(workout); t < n; t++) out.push(Math.max(0, Math.round(FTP * (targetAt(workout, t) ?? 0.6) * (1 + (pedal() - 0.5) * 2 * noise))));
    }, workout];
  };
  const kinds: Record<string, Kind> = {
    ss: ride("sweetspot-3x15", 0.04),
    thr: ride("threshold-2x20", 0.03),
    vo2: ride("vo2-5x5", 0.05),
    end: ride("endurance-60", 0.08),
    long: ride("endurance-120", 0.1),
    rec: ride("recovery-openers-45", 0.06),
  };
  const weekPlan: Record<number, string> = { 2: "ss", 3: "end", 4: "thr", 6: "long", 0: "end" };
  const now = new Date();
  const rides = [];
  for (let d = 84; d >= 1; d--) {
    const day = new Date(now);
    day.setDate(now.getDate() - d);
    day.setHours(17, 30, 0, 0);
    const dow = day.getDay();
    let k = weekPlan[dow];
    const week = Math.floor((84 - d) / 7);
    if (!k) continue;
    if (week % 4 === 3 && week < 11 && k !== "long") k = "rec";
    if (k === "thr" && week % 2 === 1) k = "vo2";
    if (pedal() < 0.08) continue;
    if (dow === 6 || dow === 0) day.setHours(8, 15, 0, 0);
    const watts: number[] = [];
    kinds[k][1](watts);
    // Heart rate chases the power with a lag: up in about half a minute, back down more slowly,
    // and faster to recover as the weeks of training go by.
    const fall = 55 - week * 1.5;
    let beat = 95;
    const hr = watts.map((w, i) => {
      const aim = 95 + (w / FTP) * 70 + Math.min(i / 600, 1) * 8;
      beat += (aim - beat) / (aim > beat ? 25 : fall);
      return Math.round(beat);
    });
    const summary = summarizeRide({ watts, heartRate: hr, cadence: watts.map(() => 90), hasPower: true, hasHeartRate: true });
    // Each block of the workout, as a ride recorded here keeps them.
    const workout = kinds[k][2];
    const interval: number[] = [];
    workout.segments.forEach((s, i) => { for (let t = 0; t < s.duration; t++) interval.push(i); });
    const intervals = rideIntervals(workout, { interval, target: watts.map((_, t) => Math.round(FTP * (targetAt(workout, t) ?? 0))), watts, heartRate: hr, cadence: watts.map(() => 90) });
    rides.push({ source: "zwift", externalId: `demo-${d}`, name: kinds[k][0], startedAt: day.toISOString(), distanceMeters: (watts.length / 3600) * 31000, summary, stream: { ...chartStream({ watts, heartRate: hr, cadence: watts.map(() => 90) }), workout, intervals } });
  }
  await storeRides(supa as never, rides as never);

  const recovery = [];
  const body = [];
  // A second sequence, so these extras leave the rest of the sample data as it was.
  const extra = random(11);
  for (let d = 84; d >= 0; d--) {
    const day = new Date(now);
    day.setDate(now.getDate() - d);
    const iso = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`;
    const sleep = 7.1 + rnd() * 1.2;
    const start = new Date(day);
    start.setDate(day.getDate() - 1);
    start.setHours(22, 40 + Math.round(rnd() * 40), 0, 0);
    const end = new Date(start.getTime() + (sleep + 0.4) * 3600e3);
    recovery.push({
      day: iso,
      hrv_ms: Math.round(58 + (rnd() - 0.5) * 18 + (84 - d) * 0.06),
      hrv_kind: "sdnn",
      resting_hr: Math.round(50 + (rnd() - 0.5) * 6),
      sleep_hours: +sleep.toFixed(2),
      sleep_deep_hours: +(sleep * 0.16).toFixed(2),
      sleep_rem_hours: +(sleep * 0.22).toFixed(2),
      sleep_core_hours: +(sleep * 0.62).toFixed(2),
      sleep_awake_hours: 0.4,
      sleep_start: start.toISOString(),
      sleep_end: end.toISOString(),
      respiratory_rate: +(14 + (extra() - 0.5) * 0.8).toFixed(1),
      wrist_temp_c: +(35.9 + (extra() - 0.5) * 0.3).toFixed(2),
      sleep_segments: d <= 30 ? sleepSegments(start, end, extra) : null,
      source: "shortcut",
    });
    const morning = new Date(day);
    morning.setHours(7, 5, 0, 0);
    if (d % 2 === 0 || d < 7) body.push({ measured_at: morning.toISOString(), source: "manual", weight_kg: +(75.6 - (84 - d) * 0.018 + (rnd() - 0.5) * 0.6).toFixed(1) });
  }
  const health = [];
  for (let d = 40; d >= 1; d--) {
    const day = new Date(now);
    day.setDate(now.getDate() - d);
    const minutes: number[] = [];
    for (let m = 0; m < 1440; m++) {
      const awake = m > 420 && m < 1380;
      let v = awake ? 68 + Math.round(rnd() * 14) : 50 + Math.round(rnd() * 5);
      if (m > 1050 && m < 1130 && day.getDay() % 2 === 0) v = 135 + Math.round(rnd() * 25);
      // A walk at lunch, longer some days.
      if (m > 730 && m < 760 + (d % 4) * 15) v = 104 + (m % 9);
      minutes.push(v);
    }
    health.push({ day: day.toISOString().slice(0, 10), hr_minutes: minutes, steps: 6000 + Math.round(rnd() * 5000), active_kcal: 500 + Math.round(rnd() * 500), source: "apple_health" });
  }
  // This morning so far: heart rate up to now.
  const nowMinute = now.getHours() * 60 + now.getMinutes();
  health.push({
    day: localDay(now),
    hr_minutes: Array.from({ length: 1440 }, (_, m) => (m > nowMinute ? null : m > 420 ? 70 + Math.round(rnd() * 14) : 50 + Math.round(rnd() * 5))),
    steps: 1500,
    active_kcal: 120,
    source: "apple_health",
  });
  await supa.from("health_days").upsert(health, { onConflict: "user_id,day" });
  await supa.from("recovery_days").upsert(recovery, { onConflict: "user_id,day" });
  await supa.from("body_measurements").insert(body);
}

export async function setupDemo() {
  addRoute(/^\/api\/demo-coach\//, () => import("./coach"));

  // Gear: the simulated trainer and heart rate strap, paired.
  for (const key of DEVICE_KEYS) await forgetDevice(key);
  rememberDevice("trainer", grant("sim:trainer", "Lactic Sim Trainer"));
  rememberDevice("heartRate", grant("sim:hr", "Lactic Sim HR"));

  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  await saveProfile({ ftp: String(FTP), ftpUnknown: false, weight: "74", units: "metric", maxHr: "188", birthDate: "1988-05-14", sex: "", height: "180", timezone: zone });
  await seedHistory();
  await saveWeek({ ...defaultWeek(), goal: "ftp" });
  // A steady ramp the default week has time for.
  await createLocalClient().from("athlete_settings").update({ ramp_rate: 3 }).not("user_id", "is", null);

  await setSetting("onboarding.done", true);
  await setSetting("tour.done", true);
  await setSetting("coach.setup", {
    ...DEFAULT_SETUP,
    mode: "builtin",
    provider: { kind: "custom", baseUrl: "/api/demo-coach", hasKey: false },
    chat: { model: "Demo coach" },
    monthlyCapUsd: null,
  });
}
