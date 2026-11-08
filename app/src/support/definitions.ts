// The coach's app tools as the model sees them: names, descriptions and arguments. Kept apart from
// tools.ts (which needs the desktop shell) so the coach evals can offer the same tools.

import type { FnTool } from "@/lib/coach/app-tools";
import { DEVICE_KEYS } from "@/lib/ble/devices";

export const AREAS = ["bluetooth", "intervals", "health", "coach"] as const;
export type Area = (typeof AREAS)[number];

const fn = (name: string, description: string, properties: Record<string, unknown> = {}, required: string[] = []): FnTool => ({
  type: "function",
  function: { name, description, parameters: { type: "object", properties, required } },
});

const device = { type: "string", enum: DEVICE_KEYS, description: "trainer, powerMeter, heartRate or scale" };

export const SUPPORT_TOOLS: FnTool[] = [
  fn(
    "check_app",
    "How the app itself is running, for troubleshooting: Bluetooth (on and allowed, each paired device, when it was last seen, signal, live connection state and power source while the Ride screen is open), intervals.icu (connected, key saved, last sync and its error), Apple Health import, the coach's AI setup and MCP server, the recent activity log (connects, drops, syncs, errors), and a troubleshooting guide. Read only. Call it before giving advice about gear or a connected service.",
    { area: { type: "string", enum: [...AREAS, "all"], description: "Default all" } },
  ),
  fn("test_connection", "Tries a connected service once and says whether it answered: intervals.icu (checks the API key) or ai (the built-in coach's model). Changes nothing.", { service: { type: "string", enum: ["intervals", "ai"] } }, ["service"]),
  fn("sync_now", "Runs a sync now and returns how it went: intervals.icu (new rides and wellness, plus history still to import) or health (the Apple Health folder).", { service: { type: "string", enum: ["intervals", "health"] } }, ["service"]),
  fn("reconnect_device", "Tries to reach a paired device. With the Ride screen open it reconnects it for riding; otherwise it connects once to show it answers, then lets go. Changes no setting.", { device }, ["device"]),
  fn("scan_for_devices", "Listens for Bluetooth gear nearby for a few seconds and lists what it hears: name, what it is (trainer, power meter, heart rate, scale), signal strength and whether it's the paired one. Changes nothing.", {
    seconds: { type: "integer", minimum: 3, maximum: 15, description: "Default 8" },
  }),
  fn(
    "propose_app_change",
    "Proposes a settings change, shown to the athlete with Apply and Dismiss; nothing changes until they apply it. setting is one of: power_source (value trainer or powerMeter: whose power is shown, recorded and steered by), upload_rides (value true/false: send rides recorded in Lactic to intervals.icu), units (value metric or imperial: kg/cm/km/°C or lb/in/mi/°F everywhere in the app), forget_device (device), rename_device (device, name). Pairing new gear and API keys can't be proposed: point the athlete to Settings.",
    {
      setting: { type: "string", enum: ["power_source", "upload_rides", "units", "forget_device", "rename_device"] },
      value: { description: "For power_source: trainer or powerMeter. For upload_rides: true or false. For units: metric or imperial." },
      device,
      name: { type: "string" },
      reason: { type: "string", description: "One sentence to the athlete on why" },
    },
    ["setting", "reason"],
  ),
];

