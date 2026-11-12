// How an installed plugin looks to the coach's plugin tools (web/lib/coach/plugins.ts). The install
// and storage work registers a PluginSource built from these at boot; until then the coach sees no
// plugins. Only manifest text approved at install travels, and plugins.ts cleans and labels it.

import type { InstalledPlugin } from "@/lib/coach/plugins";
import type { MetricUnit } from "@/lib/sdk/metrics";
import { publishedMetricId, type PluginManifest } from "./manifest";

const UNITS: readonly string[] = ["W", "W/kg", "bpm", "rpm", "s", "km/h", "kJ", "%", "ms", "h", "kg", "score", "tss"];

/** A checked manifest plus the rider's per-device choices: switched on, and shared with the coach (off by default). */
export function installedPlugin(m: PluginManifest, state: { enabled: boolean; coachVisible?: boolean }): InstalledPlugin {
  return {
    id: m.id,
    version: m.version,
    name: m.name,
    description: m.description,
    enabled: state.enabled,
    coachVisible: state.coachVisible === true,
    reads: [...m.permissions.read],
    metrics: m.publishes.map((p) => ({
      id: publishedMetricId(m, p.id),
      label: p.label,
      unit: (p.kind === "number" && p.unit && UNITS.includes(p.unit) ? p.unit : "") as MetricUnit,
      // Published values aren't tied to a ride or day yet; the storage work decides. Per ride is the common case.
      scope: "ride",
      description: p.label,
      ...(p.kind === "choice" ? { choices: [...p.choices] } : {}),
    })),
    widgets: m.contributes.widgets.map((w) => ({ id: `plugin.${m.id}.${w.id}`, name: w.title })),
  };
}
