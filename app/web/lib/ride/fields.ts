// Ride data fields: what each field on a ride page shows, worked out once a second from the ride's
// 1 Hz samples. Covers Lactic's live metrics and the rider's no-code custom fields (a metric, a time
// window and a format: 10s power, % of FTP, this interval's average). The sums come from the engine
// (normalized power, stress, zones); this file only picks which one and over which seconds.
//
// Pure, so it runs anywhere and tests in Node.

import { normalizedPower, rideStress } from "../engine/power";
import { powerZone } from "../engine/workout";
import { hrZones } from "../engine/zones";
import type { CustomAgg, FieldRef } from "../sdk/layout";
import { formatMetric, type MetricDef, type MetricRegistry } from "../sdk/metrics";

/** The ride so far, one value per ride second. `interval` is the workout interval's index, -1 for none. */
export interface RideStreams {
  power: readonly number[];
  heartRate: readonly number[];
  cadence: readonly number[];
  interval: readonly number[];
}

export interface FieldInputs {
  streams: RideStreams;
  ftp: number;
  weightKg: number | null;
  thresholdHr: number | null;
  /** Readings right now, from the sensors (undefined when a sensor isn't sending). */
  power?: number;
  heartRate?: number;
  cadence?: number;
  /** Index of the interval under way; null in free ERG or before and after the workout. */
  interval: number | null;
  /** Seconds left in the workout; null in free ERG, where "To go" shows the time ridden instead. */
  toGo: number | null;
  elapsed: number;
}

/** A field ready to draw: value is null when there's nothing to show, with the reason when known. */
export interface FieldShown {
  label: string;
  value: string | null;
  unit: string;
  reason?: string;
}

/** What a field needs to show anything, for greying it out in the picker (review U7). */
export type FieldNeed = "power" | "heartRate" | "cadence" | "weight" | "thresholdHr" | "workout";

/** What this rider has: paired sensors and the settings some fields use. */
export interface RiderHas {
  power: boolean;
  heartRate: boolean;
  weight: boolean;
  thresholdHr: boolean;
}

/** A stable key for a field, so values can be looked up and sent to the overlay and phone. */
export function fieldKey(ref: FieldRef): string {
  if ("metric" in ref) return ref.metric;
  const c = ref.custom;
  return `custom:${c.metric}:${c.agg}:${c.window}:${c.asPercentOf ?? ""}:${c.as ?? ""}`;
}

const CUSTOM_METRICS = ["power", "heart_rate", "cadence"] as const;
export type CustomMetric = (typeof CUSTOM_METRICS)[number];
const CUSTOM_NAMES: Record<CustomMetric, string> = { power: "power", heart_rate: "HR", cadence: "cadence" };
const UNITS: Record<CustomMetric, string> = { power: "W", heart_rate: "bpm", cadence: "rpm" };

/** The name a custom field gets unless the rider changes it: "10s power", "Interval avg HR", "30s power, % FTP". */
export function customLabel(c: { metric: string; window: number; agg: CustomAgg; asPercentOf?: "ftp" | "max-hr"; as?: "wkg" | "zone" }): string {
  const what = CUSTOM_NAMES[c.metric as CustomMetric] ?? c.metric;
  const span = c.window >= 60 && c.window % 60 === 0 ? `${c.window / 60} min` : `${c.window}s`;
  const base =
    c.agg === "lap-avg"
      ? `Interval avg ${what}`
      : c.agg === "last-lap-avg"
        ? `Last interval ${what}`
        : c.agg === "ride-avg"
          ? `Ride avg ${what}`
          : c.agg === "max"
            ? `Best ${span} ${what}`
            : c.window === 0
              ? cap(what)
              : `${span} ${what}`;
  const suffix = c.asPercentOf === "ftp" ? ", % FTP" : c.as === "wkg" ? ", W/kg" : c.as === "zone" ? " zone" : "";
  return (base + suffix).slice(0, 24);
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** What a field needs: its metric's `needs`, plus weight or threshold HR for some formats. */
export function fieldNeeds(ref: FieldRef, metrics: MetricRegistry): FieldNeed[] {
  if ("metric" in ref) {
    if (ref.metric === "heart_rate.zone") return ["heartRate", "thresholdHr"];
    if (ref.metric === "power.wkg") return ["power", "weight"];
    const n = metrics.get(ref.metric)?.needs;
    return n === "power" || n === "heartRate" || n === "cadence" || n === "weight" || n === "workout" ? [n] : [];
  }
  const c = ref.custom;
  const sensor: FieldNeed = c.metric === "heart_rate" ? "heartRate" : c.metric === "cadence" ? "cadence" : "power";
  return c.as === "wkg" ? [sensor, "weight"] : [sensor];
}

/**
 * Why a field can't show anything for this rider, or null when it can. Cadence comes from the
 * trainer or power meter, so it needs one of those. A workout is always there or not per ride, so
 * it never greys a field out.
 */
export function unavailableReason(needs: readonly FieldNeed[], has: RiderHas): string | null {
  for (const n of needs) {
    if ((n === "power" || n === "cadence") && !has.power) return "No trainer or power meter paired";
    if (n === "heartRate" && !has.heartRate) return "No heart rate strap paired";
    if (n === "weight" && !has.weight) return "Add your weight in Settings";
    if (n === "thresholdHr" && !has.thresholdHr) return "Set your threshold heart rate in Settings";
  }
  return null;
}

const NO_POWER = "No power yet";
const NO_HR = "No heart rate strap connected";
const NO_CADENCE = "No cadence yet";

function stream(inp: FieldInputs, metric: CustomMetric): readonly number[] {
  return metric === "power" ? inp.streams.power : metric === "heart_rate" ? inp.streams.heartRate : inp.streams.cadence;
}

/** Mean of the values, leaving out zeros for heart rate (no reading) and cadence (coasting), as the ride totals do. */
function mean(values: readonly number[], metric: CustomMetric): number | null {
  const kept = metric === "power" ? values : values.filter((v) => v > 0);
  return kept.length ? kept.reduce((a, b) => a + b, 0) / kept.length : null;
}

/** The best average over any `window` seconds so far. */
function best(values: readonly number[], window: number): number | null {
  const w = Math.max(1, window);
  if (values.length < w) return null;
  let sum = 0;
  for (let i = 0; i < w; i++) sum += values[i];
  let top = sum;
  for (let i = w; i < values.length; i++) {
    sum += values[i] - values[i - w];
    if (sum > top) top = sum;
  }
  return top / w;
}

function inInterval(inp: FieldInputs, values: readonly number[], index: number): number[] {
  const out: number[] = [];
  inp.streams.interval.forEach((at, i) => {
    if (at === index && i < values.length) out.push(values[i]);
  });
  return out;
}

/** A custom field's raw value in the metric's own unit, before % or W/kg. */
function customRaw(inp: FieldInputs, metric: CustomMetric, agg: CustomAgg, window: number): number | null {
  const values = stream(inp, metric);
  const now = metric === "power" ? inp.power : metric === "heart_rate" ? inp.heartRate : inp.cadence;
  switch (agg) {
    case "avg":
      if (window <= 0) return now ?? null;
      return mean(values.slice(-window), metric);
    case "max":
      return best(values, window);
    case "lap-avg":
      // Free rides have no intervals, so "this interval" is the whole ride there.
      return inp.interval === null ? mean(values, metric) : mean(inInterval(inp, values, inp.interval), metric);
    case "last-lap-avg":
      return inp.interval === null || inp.interval < 1 ? null : mean(inInterval(inp, values, inp.interval - 1), metric);
    case "ride-avg":
      return mean(values, metric);
  }
}

const empty = (label: string, unit: string, reason?: string): FieldShown => ({ label, value: null, unit, ...(reason ? { reason } : {}) });

function emptyReason(metric: CustomMetric, inp: FieldInputs): string | undefined {
  if (metric === "heart_rate" && inp.heartRate === undefined) return NO_HR;
  if (metric === "power" && inp.power === undefined) return NO_POWER;
  if (metric === "cadence" && inp.cadence === undefined) return NO_CADENCE;
  return undefined;
}

function hrZone(hr: number, thresholdHr: number): number {
  return hrZones(thresholdHr).find((z) => hr >= z.low && (z.high === null || hr <= z.high))?.zone ?? 1;
}

function showCustom(c: Extract<FieldRef, { custom: unknown }>["custom"], inp: FieldInputs): FieldShown {
  const metric = (CUSTOM_METRICS as readonly string[]).includes(c.metric) ? (c.metric as CustomMetric) : null;
  if (!metric) return empty(c.label, "", "This field's metric can't be averaged");
  const unit = UNITS[metric];
  if (c.agg === "last-lap-avg" && (inp.interval === null || inp.interval < 1)) return empty(c.label, unit, "No interval before this one yet");
  const raw = customRaw(inp, metric, c.agg, c.window);
  if (raw === null) return empty(c.label, unit, emptyReason(metric, inp) ?? (c.agg === "max" ? `Needs ${c.window} seconds of riding` : undefined));
  if (metric === "power" && c.as === "zone") return inp.ftp > 0 ? { label: c.label, value: `Z${powerZone(raw / inp.ftp)}`, unit: "" } : empty(c.label, "", "Set your FTP");
  if (metric === "power" && c.as === "wkg") return inp.weightKg ? { label: c.label, value: (raw / inp.weightKg).toFixed(1), unit: "W/kg" } : empty(c.label, "W/kg", "Add your weight in Settings");
  if (c.asPercentOf === "ftp") return metric === "power" && inp.ftp > 0 ? { label: c.label, value: String(Math.round((raw / inp.ftp) * 100)), unit: "%" } : empty(c.label, "%", "Set your FTP");
  if (c.asPercentOf === "max-hr") return empty(c.label, "%", "Lactic doesn't know your max heart rate yet");
  return { label: c.label, value: String(Math.round(raw)), unit };
}

/** One registered metric's value. Unknown and non-live metrics show "–" with a reason. */
function showMetric(def: MetricDef | undefined, id: string, inp: FieldInputs): FieldShown {
  if (!def) return empty(id, "", "This field isn't available any more");
  const label = def.label;
  const unit = def.unit === "s" || def.unit === "tss" ? "" : def.unit;
  const num = (v: number | null | undefined, reason?: string): FieldShown =>
    v === null || v === undefined || !Number.isFinite(v) ? empty(label, unit, reason) : { label, value: formatMetric(def, v), unit };
  const s = inp.streams;
  const p3 = s.power.length ? mean(s.power.slice(-3), "power") : (inp.power ?? null);
  switch (id) {
    case "power":
      return num(inp.power, NO_POWER);
    case "power.3s":
      return num(p3, NO_POWER);
    case "heart_rate":
      return num(inp.heartRate, NO_HR);
    case "cadence":
      return num(inp.cadence, NO_CADENCE);
    case "ride.elapsed":
      return num(inp.elapsed);
    case "ride.intensity": {
      const np = normalizedPower([...s.power]);
      return num(np !== null && inp.ftp > 0 ? (np / inp.ftp) * 100 : null);
    }
    case "power.pct_ftp":
      return num(p3 !== null && inp.ftp > 0 ? (p3 / inp.ftp) * 100 : null, inp.ftp > 0 ? NO_POWER : "Set your FTP");
    case "power.wkg":
      return inp.weightKg ? num(p3 !== null ? p3 / inp.weightKg : null, NO_POWER) : empty(label, unit, "Add your weight in Settings");
    case "power.zone":
      return p3 === null || inp.ftp <= 0 ? empty(label, "", inp.ftp > 0 ? NO_POWER : "Set your FTP") : { label, value: `Z${powerZone(p3 / inp.ftp)}`, unit: "" };
    case "heart_rate.zone":
      if (!inp.thresholdHr) return empty(label, "", "Set your threshold heart rate in Settings");
      return inp.heartRate === undefined ? empty(label, "", NO_HR) : { label, value: `Z${hrZone(inp.heartRate, inp.thresholdHr)}`, unit: "" };
    case "interval.avg_power":
      return num(inp.interval === null ? mean(s.power, "power") : mean(inInterval(inp, s.power, inp.interval), "power"));
    case "interval.avg_hr":
      return num(inp.interval === null ? mean(s.heartRate, "heart_rate") : mean(inInterval(inp, s.heartRate, inp.interval), "heart_rate"), inp.heartRate === undefined ? NO_HR : undefined);
    case "workout.to_go":
      return inp.toGo === null ? { label: "Ride time", value: formatMetric(def, inp.elapsed), unit: "" } : num(inp.toGo);
    case "so_far.power":
      return num(roundOrNull(mean(s.power, "power")));
    case "so_far.heart_rate":
      return num(roundOrNull(mean(s.heartRate, "heart_rate")));
    case "so_far.cadence":
      return num(roundOrNull(mean(s.cadence, "cadence")));
    case "so_far.np":
      return num(normalizedPower([...s.power]));
    case "so_far.tss":
      return num(rideStress([...s.power], inp.ftp));
    case "so_far.kj":
      return num(s.power.length ? s.power.reduce((a, b) => a + b, 0) / 1000 : null);
    default:
      return empty(label, unit, def.scope === "live" ? undefined : "Not a live number");
  }
}

const roundOrNull = (v: number | null) => (v === null ? null : Math.round(v));

/** What a field shows right now. */
export function showField(ref: FieldRef, inp: FieldInputs, metrics: MetricRegistry): FieldShown {
  return "metric" in ref ? showMetric(metrics.get(ref.metric), ref.metric, inp) : showCustom(ref.custom, inp);
}

/** Every distinct field across the pages, shown, keyed by fieldKey(). Sent once a second to the views. */
export function showFields(refs: Iterable<FieldRef>, inp: FieldInputs, metrics: MetricRegistry): Record<string, FieldShown> {
  const out: Record<string, FieldShown> = {};
  for (const ref of refs) {
    const key = fieldKey(ref);
    if (!(key in out)) out[key] = showField(ref, inp, metrics);
  }
  return out;
}
