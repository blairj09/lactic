// A pretend desktop shell for the troubleshooting scenarios: the coach's app tools (check_app, the
// "try" tools and propose_app_change) answer from a scripted state instead of real Bluetooth and
// services. They follow the real tools' rules (src/support/tools.ts): only check_app during a ride,
// settings changes are proposals, and no key is ever shown.
//
// The coach reads the registered tools through a module-level registry, so one dispatcher is
// registered and each run's state travels with it in AsyncLocalStorage; runs can go in parallel.

import { AsyncLocalStorage } from "node:async_hooks";
import { checkAppSetting, describeAppSetting, registerAppTools, type AppTools } from "@shared/coach/app-tools";
import type { Proposal } from "@shared/coach/changes";
import type { ToolResult } from "@shared/coach/tools";
import { SUPPORT_TOOLS } from "~/support/definitions";
import { GUIDE } from "~/support/guide";
import { BUILTIN_TODAY_WIDGETS } from "@shared/sdk/builtin-widgets";
import { parseLayout } from "@shared/sdk/layout";
import { applyLayoutChange, checkLayoutChange, describeLayoutChange, type LayoutContext } from "@shared/sdk/layout-edit";
import { MetricRegistry } from "@shared/sdk/metrics";
import { layoutReport } from "@shared/coach/layout-guide";
import { pluginList, readPluginMetric, type InstalledPlugin, type PluginPoint } from "@shared/coach/plugins";

export interface AppState {
  riding?: boolean;
  /** What check_app reports per area, over the healthy defaults. */
  bluetooth?: Record<string, unknown>;
  intervals?: Record<string, unknown>;
  health?: Record<string, unknown>;
  coach?: Record<string, unknown>;
  /** Activity log lines, newest last. */
  log?: string[];
  /** What a try tool answers, by "tool" or "tool:argument" (e.g. "test_connection:intervals"). */
  results?: Record<string, unknown>;
  /** Current values for propose_app_change summaries. */
  powerSource?: "trainer" | "powerMeter";
  /** The theme before set_appearance. */
  theme?: "light" | "dark" | "system";
  /** The rider's saved layout (parseLayout input); the default when missing. */
  layout?: unknown;
  /** Installed plugins, and what each metric has published. */
  plugins?: InstalledPlugin[];
  pluginValues?: Record<string, PluginPoint[]>;
  /** The channel the coach is on: an outside AI app over MCP sees fewer plugins. */
  via?: "chat" | "mcp";
}

const HEALTHY = {
  bluetooth: {
    bluetooth: { available: true },
    simulatedGear: false,
    powerSource: "trainer",
    paired: {
      trainer: { name: "KICKR CORE 5A1B", advertisedName: "KICKR CORE 5A1B", pairedAt: "2026-09-02", lastConnected: "1440 min ago", heardInLast2Min: false },
      powerMeter: { name: "Assioma DUO", advertisedName: "ASSIOMA43210", pairedAt: "2026-09-02", lastConnected: "1440 min ago", heardInLast2Min: false },
      heartRate: { name: "HRM-Pro", advertisedName: "HRM-Pro:123456", pairedAt: "2026-09-02", lastConnected: "1440 min ago", heardInLast2Min: false },
      scale: "not paired",
    },
    rideScreen: "The Ride screen isn't open, so no gear is connected for riding. Gear connects when the Ride screen opens.",
  },
  intervals: { connected: true, keySaved: true, lastSynced: "12 min ago", syncingNow: false, lastSync: { ok: true, at: "12 min ago", newRides: 0 }, historyImport: "done", sendRidesRecordedHere: true },
  health: { folder: "set", lastImport: { at: "2026-10-29T13:05:00Z", days: 1 }, lastSync: { ok: true } },
  coach: { mode: "builtin", provider: { kind: "openrouter", baseUrl: "", keySaved: true }, model: "eval-model", lastModelTest: { ok: true, tools: true }, mcpServer: "off (turns on when the coach mode is an external AI app)", app: { version: "0.1.0", os: "macos" } },
};

const AREAS = ["bluetooth", "intervals", "health", "coach"] as const;
const TRY = new Set(["test_connection", "sync_now", "reconnect_device", "scan_for_devices", "propose_app_change", "propose_layout_change"]);
const STATUS = Object.fromEntries(SUPPORT_TOOLS.map((t) => [t.function.name, t.function.name]));

const current = new AsyncLocalStorage<AppState>();

function layoutContext(state: AppState): LayoutContext {
  const plugins = (state.plugins ?? []).filter((p) => p.enabled);
  const widgets: LayoutContext["widgets"] = plugins.flatMap((p) => p.widgets.map((w) => ({ id: w.id, name: w.name, sizes: ["medium", "large", "small"], source: { kind: "plugin", pluginId: p.id, pluginName: p.name } })));
  return { widgets: [...BUILTIN_TODAY_WIDGETS, ...widgets], metrics: new MetricRegistry() };
}

async function run(state: AppState, name: string, args: Record<string, unknown>): Promise<ToolResult> {
  const out = (v: unknown): ToolResult => ({ content: JSON.stringify(v) });
  try {
    if (TRY.has(name) && state.riding) throw new Error("A ride is under way, so the coach can only look (check_app) until it's saved or reset.");
    switch (name) {
      case "check_app": {
        const area = String(args.area ?? "all");
        const areas = (AREAS as readonly string[]).includes(area) ? [area as (typeof AREAS)[number]] : [...AREAS];
        const report: Record<string, unknown> = {};
        for (const a of areas) report[a] = { ...HEALTHY[a], ...(state[a] ?? {}) };
        report.riding = Boolean(state.riding);
        report.activityLog = state.log ?? ["2026-10-28T01:28:00Z bluetooth info: Connected KICKR CORE 5A1B", "2026-10-28T02:45:00Z intervals info: Sync: 1 new ride"];
        report.guide = Object.fromEntries(areas.map((a) => [a, GUIDE[a] ?? []]));
        return out(report);
      }
      case "propose_app_change": {
        const setting = checkAppSetting(args);
        const now = setting.setting === "power_source" ? ((state.powerSource ?? "trainer") === "powerMeter" ? "power meter" : "trainer") : setting.setting === "upload_rides" ? "sending" : setting.setting === "profile" ? "set" : "paired";
        const summary = `${describeAppSetting(setting)} (now ${now})`;
        const proposal: Proposal = { change: { kind: "app", setting }, summary, reason: typeof args.reason === "string" ? args.reason : "", status: "pending" };
        return { content: JSON.stringify({ proposed: summary, note: "Shown to the athlete with an Apply button. Nothing changes until they press it." }), proposal };
      }
      case "get_layout":
        return out(layoutReport(parseLayout(state.layout ?? null), layoutContext(state)));
      case "propose_layout_change": {
        const change = checkLayoutChange(args);
        const layout = parseLayout(state.layout ?? null);
        const ctx = layoutContext(state);
        applyLayoutChange(layout, change, ctx);
        const summary = describeLayoutChange(layout, change, ctx);
        const proposal: Proposal = { change: { kind: "app", setting: { setting: "layout", change, summary } }, summary, reason: typeof args.reason === "string" ? args.reason : "", status: "pending" };
        return { content: JSON.stringify({ proposed: summary, note: "Shown to the athlete with an Apply button. Nothing changes until they press it." }), proposal };
      }
      case "list_plugins":
        return out(pluginList(state.plugins ?? [], state.via ?? "chat"));
      case "read_plugin_metric": {
        const source = { list: async () => state.plugins ?? [], read: async (metric: string) => state.pluginValues?.[metric] ?? [] };
        return out(await readPluginMetric(source, args, state.via ?? "chat", "2026-10-29"));
      }
      case "set_appearance": {
        const theme = args.theme;
        if (theme !== "light" && theme !== "dark" && theme !== "system") throw new Error("theme is light, dark or system");
        return out({ ok: true, theme, was: state.theme ?? "system", message: `Theme is now ${theme}.` });
      }
      case "test_connection":
      case "sync_now":
      case "reconnect_device":
      case "scan_for_devices": {
        const arg = String(args.service ?? args.device ?? "");
        const scripted = state.results?.[`${name}:${arg}`] ?? state.results?.[name];
        if (scripted !== undefined) return out(scripted);
        if (name === "scan_for_devices") return out({ listenedSeconds: 8, heard: [], note: "Nothing heard. Wake the gear (spin the pedals, put the strap on) and check Bluetooth is on." });
        return out({ ok: true, message: "It answered." });
      }
      default:
        return { content: `Unknown tool ${name}` };
    }
  } catch (e) {
    return { content: `Error: ${e instanceof Error ? e.message : String(e)}` };
  }
}

const dispatcher: AppTools = {
  tools: SUPPORT_TOOLS,
  run: async (name, args) => run(current.getStore() ?? {}, name, args),
  apply: async (setting) => `Done: ${describeAppSetting(setting)}.`,
  status: STATUS,
};

/** Runs `fn` with the app in `state`; the coach's app tools answer from it. */
export function withApp<T>(state: AppState, fn: () => Promise<T>): Promise<T> {
  registerAppTools(dispatcher);
  return current.run(state, fn);
}
