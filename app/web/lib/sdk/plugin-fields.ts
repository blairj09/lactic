// Plugin ride fields: their ids in a saved ride layout, the words a field shows when its plugin can't
// answer, and turning a plugin's checked kit tree into one field. The plugin only supplies the
// number, a short line under it and a tone; the name is the manifest's title, drawn by Lactic.
// Plain data, no browser APIs.
import type { KitNode, Tone as KitTone } from "./kit";
import { BLOCK_TYPES, formatNumber, rideBlock, shownNumber, type BlockNode, type UnitSystem, type Zone } from "./blocks";

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
  /** The choices it offers, shown under the picker when the field is selected. */
  options?: FieldOption[];
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

export type FieldTone = "positive" | "warning" | "negative" | "accent";
const TONES: Partial<Record<KitTone, FieldTone>> = { good: "positive", warn: "warning", bad: "negative", accent: "accent" };

/**
 * A small live chart under a ride field's number, drawn by Lactic: bars (zone colours with `zones`),
 * a trend line, or a 0 to 1 gauge.
 */
export type RideChart =
  | { kind: "bars"; values: number[]; labels?: string[]; zones?: true; tone?: FieldTone; target?: number; highlight?: number }
  | { kind: "line"; values: (number | null)[]; tone?: FieldTone; fill?: true; band?: [number, number]; ref?: number; marker?: "last"; min?: number; max?: number }
  | { kind: "meter"; value: number; tone?: FieldTone }
  /** A built-in block (gauge, ring, zone bar, …), drawn by Lactic; most show the field's number themselves. */
  | { kind: "block"; block: BlockNode };

/** Blocks that draw the field's number themselves, so the field doesn't draw it again. A ring without words doesn't. */
export const blockOwnsNumber = (b: BlockNode) => b.type !== "ring" || !!b.text;

/** How a plugin field's number looks beyond its tone: the line under it, a zone colour, emphasis, a change arrow. */
export interface FieldLook {
  subTone?: FieldTone;
  /** The number in this zone's colour (1 to 7), instead of a tone. */
  zone?: Zone;
  /** "flash" rings the field briefly (Lactic limits how often); "quiet" dims it. */
  emphasis?: "flash" | "quiet";
  /** An arrow after the number, coloured by whether the move is good. */
  change?: { dir: "up" | "down"; tone?: FieldTone };
}

/** One of a few labeled numbers in a field (a plugin's `values` node), e.g. "1 min" 402. */
export interface FieldValue {
  label: string;
  value: string;
  tone?: FieldTone;
}

export interface PluginFieldValue {
  /** Null when the plugin draws only a chart, or several numbers (`values`). */
  value: string | null;
  unit: string;
  sub?: string;
  tone?: FieldTone;
  chart?: RideChart;
  /** 2 to 4 labeled numbers in one field, drawn by Lactic to fit the field's size. */
  values?: FieldValue[];
  look?: FieldLook;
}

/** A ride field is read from the saddle: a short number, a short line and a small chart, never a paragraph. */
export const RIDE_FIELD_LIMITS = { value: 12, unit: 8, sub: 40, bars: 10, barLabel: 4, linePoints: 120, values: 4, valuesLabel: 8, valuesValue: 7 };

const toneOf = (t: KitTone | undefined) => (t ? TONES[t] : undefined);

/** A kit chart cut down for a ride field, or null when it won't fit. */
function rideChart(n: KitNode): RideChart | null {
  const L = RIDE_FIELD_LIMITS;
  const tone = toneOf("tone" in n ? n.tone : undefined);
  if (n.type === "bars") {
    if (n.values.length === 0 || n.values.length > L.bars) return null;
    const labels = n.labels && n.labels.length === n.values.length && n.labels.every((l) => l.length <= L.barLabel) ? n.labels : undefined;
    const highlight = n.highlight !== undefined && n.highlight < n.values.length ? n.highlight : undefined;
    return {
      kind: "bars",
      values: n.values.map((v) => (v === null ? 0 : Math.max(0, v))),
      ...(labels ? { labels } : {}),
      ...(n.palette === "zones" ? { zones: true as const } : {}),
      ...(tone ? { tone } : {}),
      ...(n.target !== undefined ? { target: n.target } : {}),
      ...(highlight !== undefined ? { highlight } : {}),
    };
  }
  if (n.type === "sparkline") {
    if (n.values.length < 2) return null;
    const { fill, band, ref, marker, min, max } = n;
    return { kind: "line", values: n.values.slice(-L.linePoints), ...(tone ? { tone } : {}), ...(fill ? { fill: true as const } : {}), ...(band ? { band } : {}), ...(ref !== undefined ? { ref } : {}), ...(marker ? { marker } : {}), ...(min !== undefined ? { min } : {}), ...(max !== undefined ? { max } : {}) };
  }
  if (n.type === "meter") return { kind: "meter", value: n.value, ...(tone ? { tone } : {}) };
  if ((BLOCK_TYPES as readonly string[]).includes(n.type)) {
    const block = rideBlock(n as BlockNode);
    return block ? { kind: "block", block } : null;
  }
  return null;
}

/**
 * A checked kit tree as a ride field. A `values` node, if there is one, makes the field several
 * labeled numbers (up to 4) and nothing else. Otherwise: the first field (or stat) for the number and
 * the first chart or block (bars, sparkline, meter, gauge, ring, …) under it. A block that shows its
 * own number (a gauge, a status word) takes the number's place. Null if there's nothing to show, or
 * the number is too long for a ride field. The line under it is cut to fit. Numbers sent as numbers
 * are written by Lactic in the rider's `units`.
 */
export function fieldFromKit(tree: KitNode, units: UnitSystem = "metric"): PluginFieldValue | null {
  const queue: KitNode[] = [tree];
  let num: Extract<KitNode, { type: "field" | "stat" }> | null = null;
  let chart: RideChart | null = null;
  let charted = false;
  let several: Extract<KitNode, { type: "values" }> | null = null;
  while (queue.length) {
    const n = queue.shift()!;
    if (n.type === "values" && !several) several = n;
    else if ((n.type === "field" || n.type === "stat") && !num) num = n;
    else if (n.type === "stack") queue.push(...n.children);
    else if (!charted && (n.type === "bars" || n.type === "sparkline" || n.type === "meter" || (BLOCK_TYPES as readonly string[]).includes(n.type))) {
      charted = true;
      chart = rideChart(n);
    }
  }
  // Several numbers take the whole field: the first 4, each short enough to read from the saddle.
  if (several) {
    const L = RIDE_FIELD_LIMITS;
    const unit = several.unit ?? "";
    const items = several.items.slice(0, L.values);
    if (unit.length > L.unit || items.some((it) => it.label.length > L.valuesLabel || it.value.length > L.valuesValue)) return null;
    return { value: null, unit, values: items.map((it) => ({ label: it.label, value: it.value, ...(toneOf(it.tone) ? { tone: toneOf(it.tone) } : {}) })) };
  }
  const owns = chart?.kind === "block" && blockOwnsNumber(chart.block);
  if (!num) return chart ? { value: null, unit: "", chart } : null;
  const shown = typeof num.value === "number" ? shownNumber(num.value, num.unit, num, units) : { text: num.value, unit: num.unit ?? "" };
  if (shown.text.length > RIDE_FIELD_LIMITS.value || shown.unit.length > RIDE_FIELD_LIMITS.unit) return null;
  const sub = num.sub ? (num.sub.length > RIDE_FIELD_LIMITS.sub ? `${num.sub.slice(0, RIDE_FIELD_LIMITS.sub - 1)}…` : num.sub) : "";
  const tone = toneOf(num.tone);
  const look = lookOf(num);
  const changeSub = num.type === "field" && num.change && !sub ? changeWords(num.change, num) : "";
  return {
    value: owns ? null : shown.text,
    unit: owns ? "" : shown.unit,
    ...(sub || changeSub ? { sub: sub || changeSub } : {}),
    ...(tone ? { tone } : {}),
    ...(chart ? { chart } : {}),
    ...(look ? { look } : {}),
  };
}

/** "+1.1 since 20 min": a change as the line under the number, when the plugin didn't write one. */
function changeWords(c: { by: number; since?: string }, opts: { decimals?: number; format?: "number" | "duration" | "percent" }): string {
  const n = formatNumber(Math.abs(c.by), opts);
  const sign = c.by > 0 ? "+" : c.by < 0 ? "−" : "±";
  return `${sign}${n}${c.since ? ` since ${c.since}` : ""}`;
}

function lookOf(n: Extract<KitNode, { type: "field" | "stat" }>): FieldLook | null {
  const look: FieldLook = {};
  const subTone = toneOf(n.subTone);
  if (subTone) look.subTone = subTone;
  if (n.zone) look.zone = n.zone;
  if (n.type === "field") {
    if (n.emphasis) look.emphasis = n.emphasis;
    if (n.change && n.change.by !== 0) {
      const dir = n.change.by > 0 ? "up" : "down";
      look.change = { dir, ...(n.change.good ? { tone: n.change.good === dir ? "positive" : "warning" } : {}) };
    }
  }
  return Object.keys(look).length ? look : null;
}

// ---- Field options: simple choices a plugin offers for a field, picked in the field editor ----

/**
 * One option a plugin field offers, from its manifest: a few fixed choices, of which the rider picks
 * up to `max` (1 when left out). Never free text, so nothing the rider types reaches the plugin.
 */
export interface FieldOption {
  id: string;
  label: string;
  choices: string[];
  /** What a field starts with: 1 to `max` of the choices. */
  default: string[];
  max?: number;
}

export const FIELD_OPTION_LIMITS = { options: 4, choices: 12, choice: 16, label: 24, max: 8 } as const;
export const OPTION_ID = /^[a-z][a-z0-9_]{0,23}$/;

/** The rider's picks, by plugin field id, then option id. Kept in the layout (`ride.options`). */
export type FieldOptionPicks = Record<string, Record<string, string[]>>;

/**
 * What a field's handler gets as `input.options`: for each option the rider's picks still on offer,
 * in the manifest's order and no more than `max`, or its default when there are none.
 */
export function resolveOptions(options: readonly FieldOption[] | undefined, picked: Record<string, string[]> | undefined): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const o of options ?? []) {
    const mine = picked?.[o.id] ?? [];
    const kept = o.choices.filter((c) => mine.includes(c)).slice(0, o.max ?? 1);
    out[o.id] = kept.length ? kept : [...o.default];
  }
  return out;
}

/** Turns one choice on or off. With `max` 1 a pick replaces the old one; past `max` nothing changes. */
export function toggleChoice(option: FieldOption, current: readonly string[], choice: string): string[] {
  const max = option.max ?? 1;
  if (max === 1) return [choice];
  if (current.includes(choice)) return current.length > 1 ? current.filter((c) => c !== choice) : [...current];
  if (current.length >= max) return [...current];
  return option.choices.filter((c) => c === choice || current.includes(c));
}

/** Picks from untrusted input (a saved or synced layout): plugin field ids, option ids, short choices. */
export function parseOptionPicks(v: unknown): FieldOptionPicks | null {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return null;
  const out: FieldOptionPicks = {};
  for (const [field, opts] of Object.entries(v).slice(0, 64)) {
    if (!isPluginFieldId(field) || typeof opts !== "object" || opts === null || Array.isArray(opts)) continue;
    const o: Record<string, string[]> = {};
    for (const [id, picks] of Object.entries(opts).slice(0, FIELD_OPTION_LIMITS.options)) {
      if (!OPTION_ID.test(id) || !Array.isArray(picks)) continue;
      const ok = picks.filter((c): c is string => typeof c === "string" && c.length > 0 && c.length <= FIELD_OPTION_LIMITS.choice).slice(0, FIELD_OPTION_LIMITS.max);
      if (ok.length) o[id] = ok;
    }
    if (Object.keys(o).length) out[field] = o;
  }
  return Object.keys(out).length ? out : null;
}
