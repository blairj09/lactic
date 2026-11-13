// Plugin ride fields: their ids in a saved ride layout, the words a field shows when its plugin can't
// answer, and turning a plugin's checked kit tree into one field. The plugin only supplies the
// number, a short line under it and a tone; the name is the manifest's title, drawn by Lactic.
// Plain data, no browser APIs.
import type { KitNode, Tone as KitTone } from "./kit";

/**
 * Ride layouts refer to a plugin field as "plugin_field.<plugin id>.<field id>". It is kept apart from
 * "plugin.<id>.<name>", the numbers a plugin publishes, so the two can never be mixed up.
 */
const PREFIX = "plugin_field.";
const PART = /^[a-z0-9][a-z0-9-]{1,39}$/;

export const pluginFieldId = (pluginId: string, fieldId: string) => `${PREFIX}${pluginId}.${fieldId}`;

export function parsePluginFieldId(id: string): { pluginId: string; fieldId: string } | null {
  if (!id.startsWith(PREFIX)) return null;
  const [pluginId, fieldId, ...rest] = id.slice(PREFIX.length).split(".");
  return rest.length === 0 && PART.test(pluginId ?? "") && PART.test(fieldId ?? "") ? { pluginId, fieldId } : null;
}

export const isPluginFieldId = (id: string) => parsePluginFieldId(id) !== null;

/** One plugin field the picker can offer. Fields of a plugin that's off are listed greyed. */
export interface PluginFieldOption {
  id: string;
  title: string;
  pluginName: string;
  on: boolean;
}

/** What a plugin field shows when there's no number: Lactic's words, never the plugin's. */
export const PLUGIN_FIELD_WORDS = {
  late: "Running late",
  starting: "Starting",
  off: "Plugin switched off",
  removed: "Plugin removed",
  failed: "Plugin stopped",
  nothing: "Nothing to show",
} as const;

export type FieldTone = "positive" | "warning" | "negative";
const TONES: Partial<Record<KitTone, FieldTone>> = { good: "positive", warn: "warning", bad: "negative" };

/**
 * A small live chart under a ride field's number, drawn by Lactic: bars (zone colours with `zones`),
 * a trend line, or a 0 to 1 gauge.
 */
export type RideChart =
  | { kind: "bars"; values: number[]; labels?: string[]; zones?: true; tone?: FieldTone }
  | { kind: "line"; values: (number | null)[]; tone?: FieldTone }
  | { kind: "meter"; value: number; tone?: FieldTone };

export interface PluginFieldValue {
  /** Null when the plugin draws only a chart. */
  value: string | null;
  unit: string;
  sub?: string;
  tone?: FieldTone;
  chart?: RideChart;
}

/** A ride field is read from the saddle: a short number, a short line and a small chart, never a paragraph. */
export const RIDE_FIELD_LIMITS = { value: 12, unit: 8, sub: 40, bars: 10, barLabel: 4, linePoints: 120 };

const toneOf = (t: KitTone | undefined) => (t ? TONES[t] : undefined);

/** A kit chart cut down for a ride field, or null when it won't fit. */
function rideChart(n: KitNode): RideChart | null {
  const L = RIDE_FIELD_LIMITS;
  const tone = toneOf("tone" in n ? n.tone : undefined);
  if (n.type === "bars") {
    if (n.values.length === 0 || n.values.length > L.bars) return null;
    const labels = n.labels && n.labels.length === n.values.length && n.labels.every((l) => l.length <= L.barLabel) ? n.labels : undefined;
    return { kind: "bars", values: n.values.map((v) => (v === null ? 0 : Math.max(0, v))), ...(labels ? { labels } : {}), ...(n.palette === "zones" ? { zones: true as const } : {}), ...(tone ? { tone } : {}) };
  }
  if (n.type === "sparkline") return n.values.length < 2 ? null : { kind: "line", values: n.values.slice(-L.linePoints), ...(tone ? { tone } : {}) };
  if (n.type === "meter") return { kind: "meter", value: n.value, ...(tone ? { tone } : {}) };
  return null;
}

/**
 * A checked kit tree as a ride field: the first field (or stat) for the number and the first bars,
 * sparkline or meter for the chart. Null if it has neither, or its number is too long for a ride
 * field. The line under it is cut to fit.
 */
export function fieldFromKit(tree: KitNode): PluginFieldValue | null {
  const queue: KitNode[] = [tree];
  let num: Extract<KitNode, { type: "field" | "stat" }> | null = null;
  let chart: RideChart | null = null;
  while (queue.length) {
    const n = queue.shift()!;
    if ((n.type === "field" || n.type === "stat") && !num) num = n;
    else if ((n.type === "bars" || n.type === "sparkline" || n.type === "meter") && !chart) chart = rideChart(n);
    else if (n.type === "stack") queue.push(...n.children);
  }
  if (!num) return chart ? { value: null, unit: "", chart } : null;
  const unit = num.type === "field" ? (num.unit ?? "") : "";
  if (num.value.length > RIDE_FIELD_LIMITS.value || unit.length > RIDE_FIELD_LIMITS.unit) return null;
  const sub = num.sub ? (num.sub.length > RIDE_FIELD_LIMITS.sub ? `${num.sub.slice(0, RIDE_FIELD_LIMITS.sub - 1)}…` : num.sub) : "";
  const tone = toneOf(num.tone);
  return { value: num.value, unit, ...(sub ? { sub } : {}), ...(tone ? { tone } : {}), ...(chart ? { chart } : {}) };
}
