// Fills a fresh, in-memory database with a believable rider: profile, a 12-week FTP plan, twelve
// weeks of rides, sleep, HRV and weight, the simulated trainer and heart rate strap paired, and the
// scripted coach switched on. Runs on every load, so each visit starts from the same place.

import { summarizeRide } from "@shared/engine/activity";
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

type Kind = [string, (out: number[]) => void];

async function seedHistory() {
  const supa = createLocalClient();
  const rnd = random(7);
  const block = (secs: number, frac: number, out: number[], noise = 0.04) => {
    for (let i = 0; i < secs; i++) out.push(Math.max(0, Math.round(FTP * frac * (1 + (rnd() - 0.5) * 2 * noise))));
  };
  const kinds: Record<string, Kind> = {
    ss: ["Sweet spot 3 × 12", (o) => { block(600, 0.6, o); for (let k = 0; k < 3; k++) { block(720, 0.92, o); block(300, 0.55, o); } block(600, 0.55, o); }],
    thr: ["Threshold 2 × 20", (o) => { block(900, 0.6, o); for (let k = 0; k < 2; k++) { block(1200, 1.0, o, 0.03); block(480, 0.55, o); } block(600, 0.55, o); }],
    vo2: ["VO2 max 5 × 4", (o) => { block(900, 0.6, o); for (let k = 0; k < 5; k++) { block(240, 1.2, o, 0.05); block(240, 0.5, o); } block(15, 2.9, o, 0.1); block(900, 0.55, o); }],
    end: ["Endurance 60 min", (o) => block(3600, 0.66, o, 0.08)],
    long: ["Long endurance", (o) => { block(6600, 0.68, o, 0.1); block(12, 3.3, o, 0.1); block(600, 0.6, o); }],
    rec: ["Recovery spin", (o) => block(2700, 0.5, o, 0.06)],
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
    if (rnd() < 0.08) continue;
    if (dow === 6 || dow === 0) day.setHours(8, 15, 0, 0);
    const watts: number[] = [];
    kinds[k][1](watts);
    const hr = watts.map((w, i) => Math.round(95 + (w / FTP) * 70 + Math.min(i / 600, 1) * 8));
    const summary = summarizeRide({ watts, heartRate: hr, cadence: watts.map(() => 90), hasPower: true, hasHeartRate: true });
    rides.push({ source: "zwift", externalId: `demo-${d}`, name: kinds[k][0], startedAt: day.toISOString(), distanceMeters: (watts.length / 3600) * 31000, summary });
  }
  await storeRides(supa as never, rides as never);

  const recovery = [];
  const body = [];
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
      minutes.push(v);
    }
    health.push({ day: day.toISOString().slice(0, 10), hr_minutes: minutes, steps: 6000 + Math.round(rnd() * 5000), active_kcal: 500 + Math.round(rnd() * 500), source: "apple_health" });
  }
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
