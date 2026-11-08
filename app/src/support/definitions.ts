// The coach's app tools as the model sees them: names, descriptions and arguments. Kept apart from
// tools.ts (which needs the desktop shell) so the coach evals can offer the same tools.

import { APP_SETTINGS, PROFILE_FIELDS, type FnTool } from "@/lib/coach/app-tools";
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
    "set_appearance",
    "Sets Lactic's theme on this computer straight away: light, dark, or system (follow the computer's light or dark mode). Use it when the athlete asks for light mode, dark mode or to match their system. It's the same as Settings → Appearance and they can change it back there.",
    { theme: { type: "string", enum: ["light", "dark", "system"] } },
    ["theme"],
  ),
  fn(
    "propose_app_change",
    "Proposes a settings change, shown to the athlete with Apply and Dismiss; nothing changes until they apply it. Use it whenever they ask to change a setting. setting is one of: power_source (value trainer or powerMeter: whose power is shown, recorded and steered by); upload_rides (value true/false: send rides recorded in Lactic to intervals.icu); units (value metric or imperial: kg/cm/km/°C or lb/in/mi/°F everywhere in the app); tracking (feature recovery or weight, value true/false: whether Lactic tracks sleep and recovery, or weight, showing or hiding it on Today, Health, setup and to you); forget_device (device); rename_device (device, name); profile (field and value: ftp_watts, threshold_hr, max_hr, weight_kg, height_cm, sleep_need_hours as numbers in kg and cm (when the athlete gives pounds or inches, pass that number with unit lb or in and Lactic converts it), birth_date as YYYY-MM-DD, sex as male/female/null, timezone as a name like America/Denver; only a value the athlete gave you or a tool returned, never one you worked out); coach_voice (voice: any of name, tone direct/encouraging/analytical/calm, detail brief/balanced/thorough, instructions); coach_mode (value builtin, external or none); coach_model (value: the model id for the provider already set up); ai_limit (value: US dollars a month, or null for none). Can't be proposed: API keys, pairing new gear, the Apple Health folder (they pick these in Settings), and the theme (use set_appearance).",
    {
      setting: { type: "string", enum: [...APP_SETTINGS] },
      value: { description: "The new value: see setting" },
      field: { type: "string", enum: [...PROFILE_FIELDS], description: "For profile" },
      unit: { type: "string", enum: ["lb", "in"], description: "For profile weight_kg or height_cm given in pounds or inches" },
      device,
      feature: { type: "string", enum: ["recovery", "weight"], description: "For tracking" },
      name: { type: "string", description: "For rename_device" },
      voice: {
        type: "object",
        description: "For coach_voice: only the parts that change",
        properties: {
          name: { type: "string" },
          tone: { type: "string", enum: ["direct", "encouraging", "analytical", "calm"] },
          detail: { type: "string", enum: ["brief", "balanced", "thorough"] },
          instructions: { type: "string" },
        },
      },
      reason: { type: "string", description: "One sentence to the athlete on why" },
    },
    ["setting", "reason"],
  ),
];

