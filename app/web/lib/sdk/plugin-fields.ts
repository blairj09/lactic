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

export interface PluginFieldValue {
  value: string;
  unit: string;
  sub?: string;
  tone?: FieldTone;
}

/** A ride field is read from the saddle: a short number and a short line, never a paragraph. */
export const RIDE_FIELD_LIMITS = { value: 12, unit: 8, sub: 40 };

/**
 * The first field (or stat) in a checked kit tree, as a ride field; null if the tree has none or its
 * value is too long for a ride field. The line under it is cut to fit.
 */
export function fieldFromKit(tree: KitNode): PluginFieldValue | null {
  const queue: KitNode[] = [tree];
  while (queue.length) {
    const n = queue.shift()!;
    if (n.type === "field" || n.type === "stat") {
      const tone = n.tone ? TONES[n.tone] : undefined;
      const unit = n.type === "field" ? (n.unit ?? "") : "";
      if (n.value.length > RIDE_FIELD_LIMITS.value || unit.length > RIDE_FIELD_LIMITS.unit) return null;
      const sub = n.sub ? (n.sub.length > RIDE_FIELD_LIMITS.sub ? `${n.sub.slice(0, RIDE_FIELD_LIMITS.sub - 1)}…` : n.sub) : "";
      return { value: n.value, unit, ...(sub ? { sub } : {}), ...(tone ? { tone } : {}) };
    }
    if (n.type === "stack") queue.push(...n.children);
  }
  return null;
}
