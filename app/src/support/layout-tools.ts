// The coach's layout and plugin tools on the desktop shell: get_layout and propose_layout_change
// read and change the rider's layout (web/lib/sdk/layout.ts); list_plugins and read_plugin_metric
// read what plugins publish, numbers only and only from plugins the rider shared with the coach
// (web/lib/coach/plugins.ts). Shared by the built-in coach and the MCP server.

import { BUILTIN_TODAY_WIDGETS } from "@/lib/sdk/builtin-widgets";
import { applyLayoutChange, checkLayoutChange, describeLayoutChange, type LayoutContext } from "@/lib/sdk/layout-edit";
import { MetricRegistry } from "@/lib/sdk/metrics";
import type { WidgetManifest } from "@/lib/sdk/widgets";
import type { AppSetting } from "@/lib/coach/app-tools";
import type { Proposal } from "@/lib/coach/changes";
import type { ToolResult } from "@/lib/coach/tools";
import { layoutReport } from "@/lib/coach/layout-guide";
import { pluginList, pluginSource, readPluginMetric, type CoachChannel } from "@/lib/coach/plugins";
import { loadLayout, saveLayout } from "@/lib/layout-data";
import { isRiding } from "@/lib/live-ride";
import { createClient } from "~/db/supabase-client";

/** Lactic's cards plus the cards of plugins switched on on this computer. */
async function layoutContext(): Promise<LayoutContext> {
  const plugins = (await pluginSource()?.list().catch(() => [])) ?? [];
  const pluginWidgets: WidgetManifest[] = plugins
    .filter((p) => p.enabled)
    .flatMap((p) =>
      p.widgets.map((w) => ({ id: w.id, name: w.name, description: "", source: { kind: "plugin", pluginId: p.id, pluginName: p.name }, surfaces: ["today"], sizes: ["medium", "large", "small"], reads: [] }) as WidgetManifest),
    );
  return { widgets: [...BUILTIN_TODAY_WIDGETS, ...pluginWidgets], metrics: new MetricRegistry() };
}

export async function getLayout() {
  const [layout, ctx] = await Promise.all([loadLayout(createClient()), layoutContext()]);
  return layoutReport(layout, ctx);
}

/** Checks the edit against the current layout and makes an Apply card of it. */
export async function proposeLayoutChange(args: Record<string, unknown>): Promise<ToolResult> {
  const change = checkLayoutChange(args);
  const [layout, ctx] = await Promise.all([loadLayout(createClient()), layoutContext()]);
  applyLayoutChange(layout, change, ctx); // throws a reason the coach can act on
  const summary = describeLayoutChange(layout, change, ctx);
  const proposal: Proposal = { change: { kind: "app", setting: { setting: "layout", change, summary } }, summary, reason: typeof args.reason === "string" ? args.reason.trim().slice(0, 300) : "", status: "pending" };
  return { content: JSON.stringify({ proposed: summary, note: "Shown to the athlete with an Apply button. Nothing changes until they press it." }), proposal };
}

/** Applies a layout edit from fresh data, so it lands on whatever the layout is now. */
export async function applyLayout(setting: Extract<AppSetting, { setting: "layout" }>): Promise<void> {
  if (isRiding()) throw new Error("Layout changes wait until the ride is saved");
  const supabase = createClient();
  const [layout, ctx] = await Promise.all([loadLayout(supabase), layoutContext()]);
  await saveLayout(supabase, applyLayoutChange(layout, setting.change, ctx));
}

export async function listPlugins(via: CoachChannel) {
  const src = pluginSource();
  return pluginList(src ? await src.list() : [], via);
}

export async function pluginMetric(args: Record<string, unknown>, via: CoachChannel) {
  const src = pluginSource();
  if (!src) throw new Error("No plugins are installed");
  return readPluginMetric(src, args, via, new Date().toLocaleDateString("en-CA"));
}
