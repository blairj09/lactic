// Tools for looking after the app itself, not the training: checking Bluetooth gear, intervals.icu
// sync and the coach's own setup, trying simple fixes, and proposing settings changes. They need the
// desktop shell (Bluetooth, the keychain, background jobs), so the shell registers them at boot and
// this layer only knows their shape. The built-in coach and the MCP server both use them.
//
// Three levels: looking is always allowed; trying (sync now, test a connection, reconnect, scan)
// runs straight away but changes no saved setting; changing a setting is a proposal the rider
// applies with a button (any setting except keys, pairing and folders, which need the rider's hands).
// The theme (set_appearance) is the exception: it's only how the app looks and is changed back in one
// click, so it's set straight away. Nothing here reads or returns an API key, and while a ride is
// under way only looking (and the theme) is allowed.

import type { ToolResult } from "./tools";
import { DETAIL_LABELS, TONE_LABELS, type Persona } from "./persona";
import { heightToCm, weightToKg, type UnitSystem } from "../units";
import { FEATURE_LABELS, type Feature } from "../features";

export type GearKey = "trainer" | "powerMeter" | "heartRate" | "scale";

/** A settings change the coach can propose. */
export type AppSetting =
  | { setting: "power_source"; value: "trainer" | "powerMeter" }
  | { setting: "forget_device"; device: GearKey }
  | { setting: "rename_device"; device: GearKey; name: string }
  | { setting: "upload_rides"; value: boolean }
  | { setting: "units"; value: UnitSystem }
  | { setting: "tracking"; feature: Feature; value: boolean }
  | { setting: "profile"; field: ProfileNumber; value: number }
  | { setting: "profile"; field: "birth_date" | "timezone"; value: string }
  | { setting: "profile"; field: "sex"; value: "male" | "female" | null }
  | { setting: "coach_voice"; voice: Partial<Persona> }
  | { setting: "coach_mode"; value: CoachMode }
  | { setting: "coach_model"; value: string }
  | { setting: "ai_limit"; value: number | null };

export const APP_SETTINGS = ["power_source", "upload_rides", "units", "tracking", "forget_device", "rename_device", "profile", "coach_voice", "coach_mode", "coach_model", "ai_limit"] as const;

export type CoachMode = "none" | "builtin" | "external";
export const COACH_MODE_LABELS: Record<CoachMode, string> = { builtin: "the built-in coach", external: "an AI app you already use (MCP)", none: "no coach" };

/** Profile numbers the coach can propose, with the same limits as Settings → Profile. */
export const PROFILE_NUMBERS = {
  ftp_watts: { label: "FTP", unit: "W", min: 50, max: 700, step: 1 },
  threshold_hr: { label: "Threshold heart rate", unit: "bpm", min: 80, max: 230, step: 1 },
  max_hr: { label: "Max heart rate", unit: "bpm", min: 100, max: 240, step: 1 },
  weight_kg: { label: "Weight", unit: "kg", min: 30, max: 200, step: 0.1 },
  height_cm: { label: "Height", unit: "cm", min: 100, max: 250, step: 0.5 },
  sleep_need_hours: { label: "Sleep need", unit: "hours", min: 4, max: 12, step: 0.25 },
} as const;
export type ProfileNumber = keyof typeof PROFILE_NUMBERS;
const NUMBER_KEYS = Object.keys(PROFILE_NUMBERS) as ProfileNumber[];
export const PROFILE_FIELDS = [...NUMBER_KEYS, "birth_date", "sex", "timezone"] as const;
export type ProfileField = (typeof PROFILE_FIELDS)[number];
const PROFILE_LABELS: Record<ProfileField, string> = {
  ...(Object.fromEntries(NUMBER_KEYS.map((k) => [k, PROFILE_NUMBERS[k].label])) as Record<ProfileNumber, string>),
  birth_date: "Birth date",
  sex: "Sex",
  timezone: "Time zone",
};

/** A profile value as Settings shows it. */
export function formatProfile(field: ProfileField, value: number | string | null | undefined): string {
  if (value === null || value === undefined || value === "") return "not set";
  return field in PROFILE_NUMBERS ? `${value} ${PROFILE_NUMBERS[field as ProfileNumber].unit}` : String(value);
}

const TONES = ["direct", "encouraging", "analytical", "calm"] as const;
const DETAILS = ["brief", "balanced", "thorough"] as const;
const MAX_INSTRUCTIONS = 2000;

function checkProfile(raw: Record<string, unknown>): AppSetting {
  const field = String(raw.field ?? "") as ProfileField;
  if (!PROFILE_FIELDS.includes(field)) throw new Error(`field is one of ${PROFILE_FIELDS.join(", ")}`);
  if (field === "birth_date") {
    const v = String(raw.value ?? "").trim();
    if (!/^(19|20)\d\d-\d\d-\d\d$/.test(v) || Number.isNaN(Date.parse(v))) throw new Error("Birth date looks like 1990-05-31");
    return { setting: "profile", field, value: v };
  }
  if (field === "timezone") {
    const v = String(raw.value ?? "").trim();
    if (!v) throw new Error("Give the time zone, like America/Denver");
    try {
      new Intl.DateTimeFormat("en", { timeZone: v });
    } catch {
      throw new Error(`Unknown time zone ${v}; use a name like America/Denver`);
    }
    return { setting: "profile", field, value: v };
  }
  if (field === "sex") {
    const v = raw.value === null || raw.value === "" ? null : String(raw.value);
    if (v !== null && v !== "male" && v !== "female") throw new Error("sex is male, female or null (not set)");
    return { setting: "profile", field, value: v };
  }
  const f = PROFILE_NUMBERS[field];
  const given = typeof raw.value === "string" ? Number(raw.value) : raw.value;
  if (typeof given !== "number" || !Number.isFinite(given)) throw new Error("value is a number");
  // Riders on imperial give pounds and inches; Lactic stores kg and cm.
  let n = given;
  if (raw.unit === "lb" && field === "weight_kg") n = weightToKg(given, "imperial");
  else if (raw.unit === "in" && field === "height_cm") n = heightToCm(given, "imperial");
  else if (raw.unit !== undefined && raw.unit !== null && raw.unit !== "" && raw.unit !== f.unit) throw new Error("unit is lb (for weight_kg) or in (for height_cm)");
  if (n < f.min || n > f.max) throw new Error(`${f.label} should be between ${f.min} and ${f.max} ${f.unit}`);
  return { setting: "profile", field, value: Number((Math.round(n / f.step) * f.step).toFixed(2)) };
}

function checkVoice(raw: Record<string, unknown>): AppSetting {
  const v = (raw.voice && typeof raw.voice === "object" ? raw.voice : raw) as Record<string, unknown>;
  const voice: Partial<Persona> = {};
  if (v.name !== undefined) {
    const name = String(v.name).trim();
    if (!name || name.length > MAX_NAME) throw new Error(`The coach's name is 1 to ${MAX_NAME} characters`);
    voice.name = name;
  }
  if (v.tone !== undefined) {
    if (!TONES.includes(v.tone as never)) throw new Error(`tone is one of ${TONES.join(", ")}`);
    voice.tone = v.tone as Persona["tone"];
  }
  if (v.detail !== undefined) {
    if (!DETAILS.includes(v.detail as never)) throw new Error(`detail is one of ${DETAILS.join(", ")}`);
    voice.detail = v.detail as Persona["detail"];
  }
  if (v.instructions !== undefined) {
    const text = String(v.instructions).trim();
    if (text.length > MAX_INSTRUCTIONS) throw new Error(`Keep the instructions under ${MAX_INSTRUCTIONS} characters`);
    voice.instructions = text;
  }
  if (!Object.keys(voice).length) throw new Error("Give at least one of name, tone, detail or instructions");
  return { setting: "coach_voice", voice };
}

export const GEAR_LABELS: Record<GearKey, string> = { trainer: "trainer", powerMeter: "power meter", heartRate: "heart rate monitor", scale: "scale" };
const GEAR_KEYS = Object.keys(GEAR_LABELS) as GearKey[];
const MAX_NAME = 40;

/** Checks a setting the model sent, or throws with what's wrong. */
export function checkAppSetting(raw: Record<string, unknown>): AppSetting {
  const setting = String(raw.setting ?? "");
  const device = String(raw.device ?? "") as GearKey;
  const needDevice = () => {
    if (!GEAR_KEYS.includes(device)) throw new Error(`device is one of ${GEAR_KEYS.join(", ")}`);
    return device;
  };
  const bool = () => {
    if (typeof raw.value !== "boolean") throw new Error("value is true or false");
    return raw.value;
  };
  switch (setting) {
    case "power_source":
      if (raw.value !== "trainer" && raw.value !== "powerMeter") throw new Error("value is trainer or powerMeter");
      return { setting, value: raw.value };
    case "upload_rides":
      return { setting, value: bool() };
    case "units":
      if (raw.value !== "metric" && raw.value !== "imperial") throw new Error("value is metric or imperial");
      return { setting, value: raw.value };
    case "tracking": {
      const feature = String(raw.feature ?? "") as Feature;
      if (feature !== "recovery" && feature !== "weight") throw new Error("feature is recovery or weight");
      return { setting, feature, value: bool() };
    }
    case "forget_device":
      return { setting, device: needDevice() };
    case "rename_device": {
      const name = String(raw.name ?? "").trim();
      if (!name) throw new Error("Give the new name");
      if (name.length > MAX_NAME) throw new Error(`Keep the name under ${MAX_NAME} characters`);
      return { setting, device: needDevice(), name };
    }
    case "profile":
      return checkProfile(raw);
    case "coach_voice":
      return checkVoice(raw);
    case "coach_mode":
      if (raw.value !== "builtin" && raw.value !== "external" && raw.value !== "none") throw new Error("value is builtin, external or none");
      return { setting, value: raw.value };
    case "coach_model": {
      const model = String(raw.value ?? "").trim();
      if (!model || model.length > 200 || /\s/.test(model)) throw new Error("value is the model's id, like anthropic/claude-haiku-5.5");
      return { setting, value: model };
    }
    case "ai_limit": {
      if (raw.value === null || raw.value === "none") return { setting, value: null };
      const n = Number(raw.value);
      if (raw.value === "" || !Number.isFinite(n) || n < 0 || n > 1000) throw new Error("value is US dollars a month from 0 to 1000, or null for no limit");
      return { setting, value: Math.round(n * 100) / 100 };
    }
    default:
      throw new Error(`setting is one of ${APP_SETTINGS.join(", ")}`);
  }
}

/** What the change does, in words, without the current value (the card's summary adds that when it can). */
export function describeAppSetting(s: AppSetting): string {
  switch (s.setting) {
    case "power_source":
      return `Power source: ${s.value === "powerMeter" ? "power meter" : "trainer"}`;
    case "upload_rides":
      return `${s.value ? "Send" : "Stop sending"} rides recorded in Lactic to intervals.icu`;
    case "units":
      return s.value === "imperial" ? "Units: imperial (lb, in, mi, °F)" : "Units: metric (kg, cm, km, °C)";
    case "tracking":
      return `${s.value ? "Track" : "Stop tracking"} ${FEATURE_LABELS[s.feature]}${s.value ? "" : " (hides it on Today, Health and in setup; saved data stays)"}`;
    case "forget_device":
      return `Forget the paired ${GEAR_LABELS[s.device]} (pair it again from Settings)`;
    case "rename_device":
      return `Call the ${GEAR_LABELS[s.device]} "${s.name}"`;
    case "profile":
      return `${PROFILE_LABELS[s.field]}: ${formatProfile(s.field, s.value)}${s.field === "ftp_watts" ? " from today" : ""}`;
    case "coach_voice": {
      const v = s.voice;
      const parts = [
        v.name !== undefined && `name "${v.name}"`,
        v.tone !== undefined && `tone ${TONE_LABELS[v.tone]}`,
        v.detail !== undefined && `detail ${DETAIL_LABELS[v.detail]}`,
        v.instructions !== undefined && (v.instructions ? `instructions "${v.instructions.length > 80 ? `${v.instructions.slice(0, 80)}…` : v.instructions}"` : "no extra instructions"),
      ].filter(Boolean);
      return `How the coach talks: ${parts.join(", ")}`;
    }
    case "coach_mode":
      return `Coach: ${COACH_MODE_LABELS[s.value]}`;
    case "coach_model":
      return `Coach model: ${s.value}`;
    case "ai_limit":
      return s.value === null ? "Monthly AI limit: none" : `Monthly AI limit: $${s.value}`;
  }
}

export interface FnTool {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
}

export interface AppTools {
  tools: FnTool[];
  /** Runs one tool. Errors come back as text starting "Error:". */
  run(name: string, args: Record<string, unknown>): Promise<ToolResult>;
  /** Applies a proposed setting once the rider presses Apply. Returns what was done. */
  apply(setting: AppSetting): Promise<string>;
  /** Short status lines for the chat while each tool runs. */
  status: Record<string, string>;
}

let registered: AppTools | null = null;

/** The desktop shell registers its tools once at boot. */
export function registerAppTools(tools: AppTools | null) {
  registered = tools;
}

export function appTools(): AppTools | null {
  return registered;
}
