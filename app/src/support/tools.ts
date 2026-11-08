// The coach's app tools (web/lib/coach/app-tools.ts), built on the desktop shell: a health check of
// Bluetooth gear, intervals.icu, Apple Health and the coach's setup; simple things to try; and
// settings changes the rider applies. Shared by the built-in coach and the MCP server.
//
// Never returned: API keys or tokens (only whether one is saved). Never done: deleting data,
// raw Bluetooth writes, trainer control. While a ride is under way, only check_app runs.

import { features } from "@/lib/features";
import { saveFeatures } from "~/settings/features";
import { readUnits, setUnits } from "@/lib/units";
import { appTools, checkAppSetting, COACH_MODE_LABELS, describeAppSetting, formatProfile, GEAR_LABELS, registerAppTools, type AppSetting, type AppTools, type GearKey } from "@/lib/coach/app-tools";
import type { Proposal } from "@/lib/coach/changes";
import type { ToolResult } from "@/lib/coach/tools";
import { connectGatt, DEVICE_KEYS, forgetDevice, findRemembered, remembered, renameDevice, type DeviceKey } from "@/lib/ble/devices";
import { GATT } from "@/lib/ble/protocol";
import { POWER_SOURCE_PREF, type SensorKind } from "@/lib/ble/sensor-hub";
import { loadConnection, setUploadRides, testKey } from "@/lib/intervals/client";
import { isRiding, liveRide } from "@/lib/live-ride";
import { coachSetup, saveCoachSetup } from "~/ai/settings";
import { knownPrice } from "~/ai/providers";
import { loadPersona } from "@/lib/coach/store";
import { DETAIL_LABELS, TONE_LABELS, toPersona } from "@/lib/coach/persona";
import { testModel } from "~/ai/test";
import type { Advert } from "~/bluetooth/backend";
import { recentAdverts, scanning, simEnabled, ble } from "~/bluetooth/web-bluetooth";
import { BODY_POD } from "@/lib/scale/bodypod";
import { identifyScale, SCALE_UUID } from "@/lib/scale/models";
import { createClient } from "~/db/supabase-client";
import { healthFolder } from "~/integrations/apple-health";
import { syncNow, syncStatus } from "~/integrations/background";
import { appInfo } from "~/platform/native";
import { secretStatus } from "~/platform/secrets";
import { getSetting } from "~/settings/store";
import { revalidatePath } from "~/shims/next-cache";
import { loadAthlete, recomputeStress } from "@/lib/activities";
import { setFtp } from "@/app/actions";
import { parseTheme, readTheme, setTheme } from "@/lib/theme";
import { GUIDE } from "./guide";
import { APP_GUIDE } from "@/lib/coach/app-guide";
import { AREAS, SUPPORT_TOOLS, type Area } from "./definitions";
import { logEvent, recentEvents, type LogArea } from "./log";

const TRY_TOOLS = new Set(["test_connection", "sync_now", "reconnect_device", "scan_for_devices", "propose_app_change"]);

const STATUS: Record<string, string> = {
  check_app: "Checking the app",
  test_connection: "Testing the connection",
  sync_now: "Syncing",
  reconnect_device: "Reaching your gear",
  scan_for_devices: "Listening for gear nearby",
  propose_app_change: "Drafting a settings change",
  set_appearance: "Changing the theme",
};

const out = (value: unknown): ToolResult => ({ content: JSON.stringify(value) });
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const ago = (iso: string | undefined | null) => (iso ? `${Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60_000))} min ago` : null);

function readPowerSource(): "trainer" | "powerMeter" {
  try {
    return localStorage.getItem(POWER_SOURCE_PREF) === "powerMeter" ? "powerMeter" : "trainer";
  } catch {
    return "trainer";
  }
}

const SERVICE_KINDS: [string, string][] = [
  [uuid(GATT.service.fitnessMachine), "trainer"],
  [uuid(GATT.service.cyclingPower), "power meter"],
  [uuid(GATT.service.heartRate), "heart rate"],
  [uuid(BODY_POD.service), "scale"],
  [uuid(SCALE_UUID.weightScale), "scale"],
  [uuid(SCALE_UUID.bodyComposition), "scale"],
];
function uuid(u: number | string) {
  if (typeof u === "number") return `0000${u.toString(16).padStart(4, "0")}-0000-1000-8000-00805f9b34fb`;
  return u.toLowerCase();
}
const kindsOf = (ad: Advert) => {
  const kinds = [...new Set(SERVICE_KINDS.filter(([u]) => ad.services.map((s) => uuid(s)).includes(u)).map(([, k]) => k))];
  // Some scales advertise no service, or a vendor one: recognise them by name or broadcast data.
  return identifyScale(ad) && !kinds.includes("scale") ? [...kinds, "scale"] : kinds;
};

async function bluetoothReport() {
  const heard = recentAdverts(120_000);
  const paired = Object.fromEntries(
    DEVICE_KEYS.map((key) => {
      const saved = remembered(key);
      if (!saved) return [key, "not paired"];
      const ad = heard.find((a) => a.id === saved.id);
      return [
        key,
        {
          name: saved.name,
          advertisedName: saved.deviceName,
          simulated: saved.id.startsWith("sim:"),
          pairedAt: saved.pairedAt ?? null,
          lastConnected: ago(saved.lastSeen),
          heardInLast2Min: ad ? { signalDbm: ad.rssi, secondsAgo: Math.round((Date.now() - ad.at) / 1000) } : false,
        },
      ];
    }),
  );
  const live = liveRide();
  const state = live?.hub.getState();
  return {
    bluetooth: await ble()
      .available()
      .catch((e) => ({ available: false, reason: e instanceof Error ? e.message : String(e) })),
    simulatedGear: simEnabled(),
    powerSource: readPowerSource(),
    paired,
    rideScreen: state
      ? {
          riding: live!.riding,
          sensors: Object.fromEntries(Object.entries(state.links).map(([k, l]) => [k, { status: l.status, name: l.name ?? null, waitingForItToWake: l.waiting === true }])),
          trainer: state.trainerStatus,
          powerSourceInUse: state.powerSource,
        }
      : "The Ride screen isn't open, so no gear is connected for riding. Gear connects when the Ride screen opens.",
  };
}

async function intervalsReport() {
  const connection = await loadConnection(createClient()).catch(() => null);
  const last = syncStatus();
  if (!connection) return { connected: false, note: "Connect in Settings → intervals.icu with an API key." };
  return {
    connected: true,
    keySaved: connection.apiKey.startsWith("keychain:") ? Boolean(await secretStatus(connection.apiKey.slice("keychain:".length)).catch(() => null)) : Boolean(connection.apiKey),
    lastSynced: ago(connection.lastSyncedAt?.toISOString()),
    syncingNow: last.running === "intervals",
    lastSync: last.last.intervals ?? null,
    historyImport: connection.backfillDone ? "done" : connection.backfillBeforeLocal ? `in progress, back to ${connection.backfillBeforeLocal.slice(0, 10)}` : "not started",
    sendRidesRecordedHere: connection.uploadRides,
  };
}

async function healthReport() {
  const last = syncStatus();
  return {
    folder: (await healthFolder().catch(() => null)) ? "set" : "not set",
    lastImport: await getSetting<unknown>("health.lastImport", null).catch(() => null),
    lastSync: last.last.health ?? null,
  };
}

async function coachReport() {
  const setup = await coachSetup();
  const info = await appInfo().catch(() => null);
  return {
    mode: setup.mode,
    provider: setup.provider ? { kind: setup.provider.kind, baseUrl: setup.provider.baseUrl, keySaved: setup.provider.hasKey } : null,
    model: setup.chat?.model ?? null,
    lastModelTest: setup.chat?.tested ?? null,
    mcpServer: setup.mode === "external" ? "on" : "off (turns on when the coach mode is an external AI app)",
    app: info ? { version: info.version, os: info.os } : null,
  };
}

export async function checkApp(area: Area | "all" = "all") {
  const areas = area === "all" ? AREAS : [area];
  const report: Record<string, unknown> = {};
  const build: Record<Area, () => Promise<unknown>> = { bluetooth: bluetoothReport, intervals: intervalsReport, health: healthReport, coach: coachReport };
  for (const a of areas) report[a] = await build[a]().catch((e) => ({ error: e instanceof Error ? e.message : String(e) }));
  report.riding = isRiding();
  // Riders choose whether to track recovery and weight; what's off is hidden on purpose, not broken.
  report.tracking = { ...features(), note: "Off means hidden by the rider's choice (Settings → What you track), not a fault." };
  report.activityLog = recentEvents({ area: area === "all" ? undefined : (area as LogArea), limit: area === "all" ? 40 : 30 }).map((e) => `${e.at} ${e.area} ${e.level}: ${e.message}`);
  report.guide = Object.fromEntries(areas.map((a) => [a, GUIDE[a] ?? []]));
  if (area === "all") report.howLacticWorks = APP_GUIDE;
  return report;
}

async function testConnection(service: string) {
  if (service === "intervals") {
    const connection = await loadConnection(createClient());
    if (!connection) return { ok: false, message: "intervals.icu isn't connected. Connect it in Settings → intervals.icu." };
    try {
      const { athleteId } = await testKey(connection.apiKey);
      return { ok: true, message: `intervals.icu accepted the key (athlete ${athleteId}).` };
    } catch (e) {
      return { ok: false, message: e instanceof Error ? e.message : String(e) };
    }
  }
  if (service === "ai") {
    const setup = await coachSetup();
    if (setup.mode !== "builtin" || !setup.chat) return { ok: false, message: "The built-in coach isn't set up (Settings → Coach)." };
    const tested = await testModel(setup, setup.chat);
    return { ok: tested.ok, usesTools: tested.tools, seconds: tested.seconds, message: tested.note ?? (tested.ok ? "The model answered." : "The model didn't answer.") };
  }
  throw new Error("service is intervals or ai");
}

async function syncService(service: string) {
  if (service !== "intervals" && service !== "health") throw new Error("service is intervals or health");
  const result = await syncNow(service);
  return result ?? { ok: false, message: service === "intervals" ? "intervals.icu isn't connected." : "No Apple Health folder is set (Settings → Health)." };
}

async function reconnect(key: DeviceKey) {
  const saved = remembered(key);
  if (!saved) return { ok: false, message: `No ${GEAR_LABELS[key]} is paired. Pair one in Settings → Bluetooth.` };
  const live = liveRide();
  if (live && key !== "scale") {
    try {
      await live.hub.connect(key as SensorKind);
      return { ok: true, message: `${saved.name} is connected for riding.` };
    } catch (e) {
      return { ok: false, message: `${saved.name} didn't answer (${e instanceof Error ? e.message : String(e)}). Lactic keeps listening and connects it when it wakes.` };
    }
  }
  const target = await findRemembered(key);
  if (!target) return { ok: false, message: `${saved.name} is paired but Lactic can't reach it from here. Pair it again in Settings → Bluetooth.` };
  try {
    await connectGatt(target, { attempts: 2 });
    target.gatt?.disconnect();
    return { ok: true, message: `${saved.name} answered.` };
  } catch (e) {
    return { ok: false, message: `${saved.name} didn't answer (${e instanceof Error ? e.message : String(e)}). It may be asleep, out of range, or connected to another app.` };
  }
}

async function scan(seconds: number) {
  const started = Date.now();
  await scanning.hold();
  try {
    await sleep(seconds * 1000);
  } finally {
    await scanning.release();
  }
  const pairedIds = new Map(DEVICE_KEYS.map((k) => [remembered(k)?.id, k] as const));
  const heard = recentAdverts(Date.now() - started + 500)
    .filter((a) => a.at >= started)
    .map((a) => ({ name: a.name ?? "(no name)", is: kindsOf(a), signalDbm: a.rssi, simulated: a.id.startsWith("sim:"), pairedAs: pairedIds.get(a.id) ?? null }))
    .sort((a, b) => Number(b.is.length > 0) - Number(a.is.length > 0) || (b.signalDbm ?? -200) - (a.signalDbm ?? -200));
  return { listenedSeconds: seconds, heard: heard.slice(0, 25), note: heard.length ? undefined : "Nothing heard. Wake the gear (spin the pedals, put the strap on) and check Bluetooth is on." };
}

async function currentValue(s: AppSetting): Promise<string | null> {
  switch (s.setting) {
    case "power_source":
      return readPowerSource() === "powerMeter" ? "power meter" : "trainer";
    case "upload_rides": {
      const c = await loadConnection(createClient()).catch(() => null);
      if (!c) throw new Error("intervals.icu isn't connected");
      return c.uploadRides ? "sending" : "not sending";
    }
    case "profile": {
      const a = await loadAthlete(createClient());
      const now = {
        ftp_watts: a.ftp,
        threshold_hr: a.thresholdHr,
        max_hr: a.maxHr,
        weight_kg: a.weightKg,
        height_cm: a.heightCm,
        sleep_need_hours: a.sleepNeedHours,
        birth_date: a.birthDate,
        sex: a.sex,
        timezone: a.timezone,
      }[s.field];
      return formatProfile(s.field, now);
    }
    case "coach_voice": {
      const p = await loadPersona(createClient());
      return `${p.name}, ${TONE_LABELS[p.tone]}, ${DETAIL_LABELS[p.detail]}${p.instructions ? ", with instructions" : ""}`;
    }
    case "coach_mode":
      return COACH_MODE_LABELS[(await coachSetup()).mode];
    case "coach_model": {
      const setup = await coachSetup();
      if (!setup.provider) throw new Error("No AI provider is set up yet. Choose one and add its key in Settings → Coach first.");
      return setup.chat?.model ?? "none chosen";
    }
    case "ai_limit": {
      const cap = (await coachSetup()).monthlyCapUsd;
      return cap === null ? "no limit" : `$${cap}`;
    }
    case "units":
      return readUnits();
    case "tracking":
      return features()[s.feature] ? "tracked" : "not tracked";
    default: {
      const saved = remembered(s.device);
      if (!saved) throw new Error(`No ${GEAR_LABELS[s.device]} is paired`);
      return saved.name;
    }
  }
}

async function propose(args: Record<string, unknown>): Promise<ToolResult> {
  const setting = checkAppSetting(args);
  const now = await currentValue(setting);
  const summary = `${describeAppSetting(setting)} (now ${now})`;
  const proposal: Proposal = { change: { kind: "app", setting }, summary, reason: typeof args.reason === "string" ? args.reason.trim().slice(0, 300) : "", status: "pending" };
  return { content: JSON.stringify({ proposed: summary, note: "Shown to the athlete with an Apply button. Nothing changes until they press it." }), proposal };
}

async function apply(setting: AppSetting): Promise<string> {
  switch (setting.setting) {
    case "power_source":
      try {
        localStorage.setItem(POWER_SOURCE_PREF, setting.value);
      } catch {}
      liveRide()?.hub.setPowerSource(setting.value);
      break;
    case "upload_rides": {
      const supabase = createClient();
      const c = await loadConnection(supabase);
      if (!c) throw new Error("intervals.icu isn't connected");
      await setUploadRides(supabase, c, setting.value);
      break;
    }
    case "units":
      setUnits(setting.value);
      break;
    case "tracking":
      await saveFeatures({ ...features(), [setting.feature]: setting.value });
      break;
    case "forget_device":
      await forgetDevice(setting.device);
      break;
    case "rename_device":
      renameDevice(setting.device, setting.name);
      break;
    case "profile": {
      // FTP goes through the same path as Settings (history from today, stress recomputed).
      if (setting.field === "ftp_watts") {
        const r = await setFtp(setting.value);
        if (!r.ok) throw new Error(r.message);
        break;
      }
      const supabase = createClient();
      const athlete = await loadAthlete(supabase);
      const { error } = await supabase.from("athlete_settings").upsert({ user_id: athlete.userId, [setting.field]: setting.value, updated_at: new Date().toISOString() }, { onConflict: "user_id" });
      if (error) throw error;
      if (setting.field === "threshold_hr" || setting.field === "timezone") await recomputeStress(supabase);
      break;
    }
    case "coach_voice": {
      const supabase = createClient();
      const next = toPersona({ ...(await loadPersona(supabase)), ...setting.voice });
      const { error } = await supabase
        .from("coach_persona")
        .upsert({ name: next.name, tone: next.tone, detail: next.detail, instructions: next.instructions, updated_at: new Date().toISOString() }, { onConflict: "user_id" });
      if (error) throw error;
      break;
    }
    case "coach_mode": {
      const setup = await coachSetup();
      if (setting.value === "builtin" && (!setup.provider || !setup.chat)) throw new Error("The built-in coach needs a provider and a model first: set them up in Settings → Coach.");
      await saveCoachSetup({ ...setup, mode: setting.value });
      break;
    }
    case "coach_model": {
      const setup = await coachSetup();
      if (!setup.provider) throw new Error("No AI provider is set up yet. Choose one and add its key in Settings → Coach first.");
      await saveCoachSetup({ ...setup, chat: { model: setting.value, price: knownPrice(setup.provider.kind, setting.value) } });
      break;
    }
    case "ai_limit":
      await saveCoachSetup({ ...(await coachSetup()), monthlyCapUsd: setting.value });
      break;
  }
  const done = describeAppSetting(setting);
  logEvent("coach", "info", `Applied: ${done}`);
  revalidatePath("/");
  return `Done: ${done}.`;
}

const THEME_WORDS = { light: "Light", dark: "Dark", system: "System (follows the computer's light or dark mode)" } as const;

/** The theme is how the app looks on this computer and is easy to change back, so it's set straight away. */
export function setAppearance(raw: unknown) {
  if (raw !== "light" && raw !== "dark" && raw !== "system") throw new Error("theme is light, dark or system");
  const before = readTheme();
  const theme = parseTheme(raw);
  setTheme(theme);
  logEvent("coach", "info", `Coach set the theme to ${theme}`);
  return { ok: true, theme, was: before, message: `Theme is now ${THEME_WORDS[theme]}. It can be changed back in Settings → Appearance.` };
}

/** Runs one support tool. Never throws: errors come back as text starting "Error:". */
export async function runSupportTool(name: string, args: Record<string, unknown>): Promise<ToolResult> {
  try {
    if (TRY_TOOLS.has(name) && isRiding()) throw new Error("A ride is under way, so the coach can only look (check_app) until it's saved or reset.");
    switch (name) {
      case "check_app": {
        const area = String(args.area ?? "all");
        return out(await checkApp((AREAS as readonly string[]).includes(area) ? (area as Area) : "all"));
      }
      case "test_connection": {
        const r = await testConnection(String(args.service ?? ""));
        logEvent("coach", r.ok ? "info" : "warn", `Coach tested ${args.service}: ${r.message}`);
        return out(r);
      }
      case "sync_now": {
        logEvent("coach", "info", `Coach ran a ${args.service} sync`);
        return out(await syncService(String(args.service ?? "")));
      }
      case "reconnect_device": {
        const key = String(args.device ?? "") as GearKey;
        if (!DEVICE_KEYS.includes(key)) throw new Error("device is one of trainer, powerMeter, heartRate, scale");
        const r = await reconnect(key);
        logEvent("coach", r.ok ? "info" : "warn", `Coach tried the ${GEAR_LABELS[key]}: ${r.message}`);
        return out(r);
      }
      case "scan_for_devices": {
        const seconds = Math.min(15, Math.max(3, Math.round(Number(args.seconds) || 8)));
        logEvent("coach", "info", `Coach listened for gear for ${seconds}s`);
        return out(await scan(seconds));
      }
      case "propose_app_change":
        return await propose(args);
      case "set_appearance":
        return out(setAppearance(args.theme));
      default:
        return { content: `Unknown tool ${name}` };
    }
  } catch (e) {
    return { content: `Error: ${e instanceof Error ? e.message : String(e)}` };
  }
}

export const supportTools: AppTools = { tools: SUPPORT_TOOLS, run: runSupportTool, apply, status: STATUS };

/** Makes the tools available to the coach and the MCP server (once, at boot). */
export function installSupportTools() {
  if (!appTools()) registerAppTools(supportTools);
}
