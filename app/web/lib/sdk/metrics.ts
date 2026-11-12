// The metric registry: every number Lactic shows, under one id that widgets, ride fields, plugins
// and the coach all ask for in the same way. The engine still computes every value; this only
// names them, says what they are and which permission group they belong to.
//
// Plain data with no browser or Node APIs, so it runs anywhere (engine rule in CLAUDE.md).

/** How often a metric changes, which decides where it can be shown. */
export type MetricScope =
  /** Live during a ride, about once a second (ride fields, the overlay). */
  | "live"
  /** One value per ride (the last ride, or a chosen one). */
  | "ride"
  /** One value per day. */
  | "day";

/**
 * Permission groups: what a plugin asks to read. Recovery (sleep, HRV, resting heart rate) and
 * location are separate because they're health and whereabouts data (review items S5).
 */
export type MetricGroup = "live" | "rides" | "fitness" | "profile" | "recovery" | "location";

export type MetricUnit = "W" | "W/kg" | "bpm" | "rpm" | "s" | "km/h" | "kJ" | "%" | "ms" | "h" | "kg" | "score" | "tss" | "";

export interface MetricDef {
  /** Dotted, lowercase: "power.3s", "ride.np", "plugin.wprime-tools.balance". */
  id: string;
  label: string;
  /** A short label for a narrow ride field ("Pwr 3s"); falls back to label. */
  short?: string;
  unit: MetricUnit;
  scope: MetricScope;
  group: MetricGroup;
  /** One plain sentence for the field picker and the coach. */
  description: string;
  /** What the rider needs for it to have a value; the picker greys it out with this reason (review U7). */
  needs?: "power" | "heartRate" | "cadence" | "workout" | "recovery" | "weight";
  /** Digits after the point when shown. Default 0. */
  decimals?: number;
}

/** A metric's value at one moment. `null` when there's nothing to show, with the reason if known. */
export interface MetricValue {
  value: number | null;
  /** Why it's empty ("No heart rate strap"), shown on tap. */
  reason?: string;
}

const live = (id: string, label: string, unit: MetricUnit, description: string, extra: Partial<MetricDef> = {}): MetricDef => ({
  id,
  label,
  unit,
  scope: "live",
  group: "live",
  description,
  ...extra,
});

/**
 * Lactic's own metrics. Ids are stable once shipped: saved layouts and plugins refer to them.
 * Add freely; never rename or reuse an id.
 */
export const LACTIC_METRICS: readonly MetricDef[] = [
  // Live, during a ride (the ride player's fields today).
  live("power", "Power", "W", "Power right now, as the trainer or power meter reports it.", { needs: "power" }),
  live("power.3s", "Power 3s", "W", "Power averaged over the last 3 seconds.", { short: "Pwr 3s", needs: "power" }),
  live("power.target", "Target", "W", "The power the workout asks for now.", { needs: "workout" }),
  live("heart_rate", "Heart rate", "bpm", "Heart rate right now.", { short: "HR", needs: "heartRate" }),
  live("cadence", "Cadence", "rpm", "Pedalling cadence right now.", { short: "Cad", needs: "cadence" }),
  live("interval.left", "Interval left", "s", "Time left in the interval under way.", { short: "Int left", needs: "workout" }),
  live("ride.elapsed", "Ride time", "s", "Time ridden so far, pauses left out."),
  live("ride.intensity", "Intensity", "%", "How hard the ride has been so far against your FTP.", { needs: "power" }),
  // Per ride.
  { id: "ride.np", label: "Normalized power", short: "NP", unit: "W", scope: "ride", group: "rides", description: "Normalized power for the ride.", needs: "power" },
  { id: "ride.tss", label: "Training stress", short: "TSS", unit: "tss", scope: "ride", group: "rides", description: "Training stress for the ride." },
  { id: "ride.duration", label: "Duration", unit: "s", scope: "ride", group: "rides", description: "How long the ride was." },
  { id: "ride.avg_hr", label: "Average heart rate", short: "Avg HR", unit: "bpm", scope: "ride", group: "rides", description: "Average heart rate for the ride.", needs: "heartRate" },
  // Per day: fitness and the plan.
  { id: "fitness.ctl", label: "Fitness", unit: "", scope: "day", group: "fitness", description: "Fitness (chronic training load): roughly the last six weeks of training." },
  { id: "fitness.atl", label: "Fatigue", unit: "", scope: "day", group: "fitness", description: "Fatigue (acute training load): roughly the last week of training." },
  { id: "fitness.tsb", label: "Form", unit: "", scope: "day", group: "fitness", description: "Form: fitness minus fatigue. Positive is fresh, negative is tired." },
  { id: "plan.week_done", label: "Week done", unit: "%", scope: "day", group: "fitness", description: "Share of this week's planned training done so far." },
  // Profile.
  { id: "profile.ftp", label: "FTP", unit: "W", scope: "day", group: "profile", description: "Your functional threshold power." },
  { id: "profile.weight", label: "Weight", unit: "kg", scope: "day", group: "profile", description: "Your latest weight.", needs: "weight", decimals: 1 },
  { id: "profile.wkg", label: "W/kg", unit: "W/kg", scope: "day", group: "profile", description: "FTP per kilogram.", needs: "weight", decimals: 2 },
  // Recovery (health data).
  { id: "recovery.score", label: "Recovery", unit: "score", scope: "day", group: "recovery", description: "This morning's recovery score, 0 to 100.", needs: "recovery" },
  { id: "recovery.hrv", label: "HRV", unit: "ms", scope: "day", group: "recovery", description: "Heart rate variability last night.", needs: "recovery" },
  { id: "recovery.resting_hr", label: "Resting HR", unit: "bpm", scope: "day", group: "recovery", description: "Resting heart rate last night.", needs: "recovery" },
  { id: "recovery.sleep", label: "Sleep", unit: "h", scope: "day", group: "recovery", description: "Hours slept last night.", needs: "recovery", decimals: 1 },
];

const ID = /^[a-z0-9_]+(\.[a-z0-9_-]+)*$/;

/** Whether a string is a well-formed metric id. */
export function isMetricId(id: unknown): id is string {
  return typeof id === "string" && id.length <= 80 && ID.test(id);
}

/** Plugin metrics live under "plugin.<plugin id>.", so they can never shadow Lactic's. */
export function pluginMetricId(pluginId: string, name: string): string {
  return `plugin.${pluginId}.${name}`;
}

export function isPluginMetric(id: string): boolean {
  return id.startsWith("plugin.");
}

/** A lookup over Lactic's metrics plus any a plugin has registered. */
export class MetricRegistry {
  private readonly byId = new Map<string, MetricDef>();

  constructor(defs: readonly MetricDef[] = LACTIC_METRICS) {
    for (const d of defs) this.add(d);
  }

  add(def: MetricDef): void {
    if (!isMetricId(def.id)) throw new Error(`Bad metric id: ${def.id}`);
    if (this.byId.has(def.id)) throw new Error(`Metric already registered: ${def.id}`);
    this.byId.set(def.id, def);
  }

  get(id: string): MetricDef | undefined {
    return this.byId.get(id);
  }

  all(): MetricDef[] {
    return [...this.byId.values()];
  }

  /** The metrics a surface can show: ride fields take live ones; Today takes ride and day ones. */
  forScope(...scopes: MetricScope[]): MetricDef[] {
    return this.all().filter((d) => scopes.includes(d.scope));
  }
}

/** Formats a value for a field: "251", "4.12", "1:05:30", "–" when empty. */
export function formatMetric(def: Pick<MetricDef, "unit" | "decimals">, value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "–";
  if (def.unit === "s") {
    const s = Math.max(0, Math.round(value));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = String(s % 60).padStart(2, "0");
    return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
  }
  return value.toFixed(def.decimals ?? 0);
}
