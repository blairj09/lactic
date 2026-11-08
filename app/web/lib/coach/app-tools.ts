// Tools for looking after the app itself, not the training: checking Bluetooth gear, intervals.icu
// sync and the coach's own setup, trying simple fixes, and proposing settings changes. They need the
// desktop shell (Bluetooth, the keychain, background jobs), so the shell registers them at boot and
// this layer only knows their shape. The built-in coach and the MCP server both use them.
//
// Three levels: looking is always allowed; trying (sync now, test a connection, reconnect, scan)
// runs straight away but changes no saved setting; changing a setting is a proposal the rider
// applies with a button. Nothing here reads or returns an API key, and while a ride is under way
// only looking is allowed.

import type { ToolResult } from "./tools";
import type { UnitSystem } from "../units";

export type GearKey = "trainer" | "powerMeter" | "heartRate" | "scale";

/** A settings change the coach can propose. */
export type AppSetting =
  | { setting: "power_source"; value: "trainer" | "powerMeter" }
  | { setting: "forget_device"; device: GearKey }
  | { setting: "rename_device"; device: GearKey; name: string }
  | { setting: "upload_rides"; value: boolean }
  | { setting: "units"; value: UnitSystem };

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
    case "forget_device":
      return { setting, device: needDevice() };
    case "rename_device": {
      const name = String(raw.name ?? "").trim();
      if (!name) throw new Error("Give the new name");
      if (name.length > MAX_NAME) throw new Error(`Keep the name under ${MAX_NAME} characters`);
      return { setting, device: needDevice(), name };
    }
    default:
      throw new Error("setting is one of power_source, upload_rides, units, forget_device, rename_device");
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
    case "forget_device":
      return `Forget the paired ${GEAR_LABELS[s.device]} (pair it again from Settings)`;
    case "rename_device":
      return `Call the ${GEAR_LABELS[s.device]} "${s.name}"`;
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
