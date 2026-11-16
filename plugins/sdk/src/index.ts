// @lactic/sdk: what a Lactic plugin can see and send back. Mirrors the app's own types (app/web/lib/sdk
// and app/src/plugins/manifest.ts); app/src/plugins/sdk-package.test.ts keeps the two in step.

// ---- The kit: what a plugin asks Lactic to draw ----

/** What a value means; Lactic picks the colour. `accent` is Lactic blue. There are no other colours. */
export type Tone = "default" | "good" | "warn" | "bad" | "muted" | "accent";

/** A step on Lactic's zone ramp (the colours of power and heart rate zones), 1 to 7. */
export type Zone = 1 | 2 | 3 | 4 | 5 | 6 | 7;

/**
 * How Lactic writes a number you send as a number: `duration` as a clock (724 → 12:04), `percent`
 * from 0 to 1 (0.72 → 72%), otherwise with `decimals` (0 to 3). Send metric units (km/h, km, m, kg,
 * °C): Lactic converts them for riders who use imperial.
 */
export type NumberFormat = "number" | "duration" | "percent";

/** How a number moved: `by` (signed) since `since` ("20 min"), and which way is good. Lactic draws ▲ or ▼. */
export type KitChange = { by: number; since?: string; good?: "up" | "down" };

/** A band on a gauge, up to `to`. Coloured by `tone` or `zone`, else Lactic's zone ramp. */
export type GaugeBand = { to: number; tone?: Tone; zone?: Zone };

export type StatusIcon = "check" | "alert" | "up" | "down" | "pause" | "dot" | "half";

/** Options every number shares. `subTone` colours the line under it; `zone` colours the number like a zone. */
type NumberLook = { decimals?: number; format?: NumberFormat; subTone?: Tone; zone?: Zone };

/**
 * Built-in blocks. You describe the numbers; Lactic draws them to fit the phone, a big field, a wide
 * desktop field, the Zwift overlay strip and a ride's page. Except a ring without `text`, each one shows
 * the field's number itself, so a ride field needs nothing else.
 */
export type BlockNode =
  /** A dial between `min` and `max`. `ticks` labels every step; `needle` adds a needle; `target` a mark. */
  | { type: "gauge"; value: number; min: number; max: number; label?: string; unit?: string; decimals?: number; format?: NumberFormat; zones?: GaugeBand[]; ticks?: number; needle?: boolean; shape?: "dial" | "half"; target?: number; tone?: Tone; zone?: Zone }
  /** How far through something, 0 to 1, with up to 6 characters in the middle. */
  | { type: "ring"; value: number; label?: string; text?: string; tone?: Tone; zone?: Zone }
  /** Where `value` sits among bands. `bands` are the edges low to high (2 to 8, so 1 to 7 bands); `names` one per band. */
  | { type: "zonebar"; value: number; bands: number[]; label?: string; names?: string[]; tones?: Tone[] }
  /** A value against a target: good while within `within` (2% of the target when left out). */
  | { type: "target"; value: number; target: number; within?: number; label?: string; unit?: string; decimals?: number; format?: NumberFormat }
  /** Labelled rows, each with its own tone. As a ride field: 5 rows, labels 16 and values 12 characters. */
  | { type: "list"; label?: string; rows: { label: string; value: string; tone?: Tone }[] }
  /** A word for a state, not a number ("Too hot", "Fuel now"); 20 characters in a ride field. */
  | { type: "status"; text: string; tone?: Tone; icon?: StatusIcon; sub?: string; label?: string }
  /** Time to `until` or since `since` (seconds since 1970, e.g. `input.now + 258`). Lactic ticks it every second. */
  | { type: "countdown"; until?: number; since?: number; sub?: string; label?: string; tone?: Tone }
  /** Two sides of one thing, e.g. left/right power, centred at 50/50. */
  | { type: "balance"; left: number; right: number; label?: string };

/** Plugin buttons can only open the plugin's own detail view. */
export type KitAction = { kind: "open-detail" };

export type KitNode =
  /** A big number with a label, like a bike computer field. */
  /** `emphasis: "flash"` rings the field for 3 s (at most every 30 s); `"quiet"` dims it. */
  | ({ type: "field"; label: string; value: string | number; unit?: string; sub?: string; tone?: Tone; lead?: boolean; emphasis?: "flash" | "quiet"; change?: KitChange } & NumberLook)
  /** A smaller number with a label and a line under it. */
  | ({ type: "stat"; label: string; value: string | number; unit?: string; sub?: string; tone?: Tone } & NumberLook)
  /**
   * A few short labeled numbers in one ride field, e.g. best 5 s, 1 min, 5 min and 20 min power. One
   * unit for all. As a ride field: 2 to 4 items, labels up to 8 characters, values up to 7.
   */
  | { type: "values"; label?: string; unit?: string; items: { label: string; value: string; tone?: Tone }[] }
  | { type: "text"; text: string; tone?: Tone; size?: "sm" | "md" | "lg"; weight?: "normal" | "medium" | "semibold" }
  /** A small trend line, scaled to fit (or to `min`/`max`). `fill` shades under it, `band` marks a good range, `ref` a dashed line, `marker: "last"` dots the latest point. */
  | { type: "sparkline"; values: (number | null)[]; tone?: Tone; fill?: boolean; band?: [number, number]; ref?: number; marker?: "last"; min?: number; max?: number }
  /** Simple bars, e.g. per day; labels optional. */
  /** `palette: "zones"` colours bar 1 as zone 1, bar 2 as zone 2 and so on (up to 7), in Lactic's zone colours. */
  /** `target` draws a dashed line across; `highlight` (a bar's index) dims the others, e.g. to show the interval you're in. */
  | { type: "bars"; values: (number | null)[]; labels?: string[]; tone?: Tone; palette?: "zones"; target?: number; highlight?: number }
  /** A 0 to 1 bar. */
  | { type: "meter"; value: number; label?: string; tone?: Tone }
  | { type: "stack"; direction?: "row" | "column"; gap?: "sm" | "md"; children: KitNode[] }
  /** A small table of text cells, e.g. one row per interval. Up to 8 columns and 200 rows, 60 characters a cell. */
  | { type: "table"; columns: string[]; rows: string[][]; align?: ("left" | "right")[] }
  /** A line over a ride against time (s) or distance (km), up to 2000 points, with up to 40 marked stretches. */
  | { type: "profile"; x: number[]; y: (number | null)[]; xUnit?: "s" | "km"; yUnit?: string; tone?: Tone; marks?: { from: number; to: number; label?: string; tone?: Tone }[] }
  | { type: "button"; label: string; action: KitAction }
  | BlockNode;

/** Limits Lactic enforces on a tree; anything over them is refused for that call. */
export const KIT_LIMITS = { nodes: 200, depth: 6, text: 280, points: 400, profilePoints: 2000, marks: 40, values: 8, columns: 8, rows: 200, cell: 60 } as const;

// ---- Metrics ----

/** Permission groups. `recovery` is health data; `location` is a separate opt-in, off by default. */
export type MetricGroup = "live" | "rides" | "fitness" | "profile" | "recovery" | "location";

/** Lactic's own metric ids, by the group a plugin needs to read them. */
export const METRICS = {
  live: [
    "power",
    "power.3s",
    "power.target",
    "heart_rate",
    "cadence",
    "interval.left",
    "ride.elapsed",
    "ride.intensity",
    "power.pct_ftp",
    "power.wkg",
    "power.zone",
    "heart_rate.zone",
    "interval.avg_power",
    "interval.avg_hr",
    "workout.to_go",
    "so_far.power",
    "so_far.heart_rate",
    "so_far.cadence",
    "so_far.np",
    "so_far.tss",
    "so_far.kj",
  ],
  rides: ["ride.np", "ride.tss", "ride.duration", "ride.avg_hr"],
  fitness: ["fitness.ctl", "fitness.atl", "fitness.tsb", "plan.week_done"],
  profile: ["profile.ftp", "profile.weight", "profile.wkg"],
  recovery: ["recovery.score", "recovery.hrv", "recovery.resting_hr", "recovery.sleep"],
  location: [],
} as const satisfies Record<MetricGroup, readonly string[]>;

export type LacticMetricId = (typeof METRICS)[keyof typeof METRICS][number];

// ---- Handlers ----

/** One saved ride, for ride analyses. Streams are sampled every `stepSeconds`; null where there was no reading. */
export interface RideInput {
  /** Seconds since the Unix epoch. */
  startedAt: number;
  durationSeconds: number;
  distanceMeters: number | null;
  stepSeconds: number;
  watts: (number | null)[] | null;
  heartRate: (number | null)[] | null;
  cadence: (number | null)[] | null;
  /** The workout's target watts per sample; null on a free ride. */
  target: (number | null)[] | null;
  /** The workout's intervals as ridden (empty on a free ride). */
  intervals: { index: number; kind: "steady" | "ramp" | "freeRide"; planned: number; ridden: number; target: number | null; power: number | null; heartRate: number | null; cadence: number | null }[];
  /** GPS track, only if the rider ticked "where you ride": latitude, longitude, ride second. */
  route: { lat: number[]; lng: number[]; t: (number | null)[] } | null;
}

export interface HandlerInput {
  /** Only metrics from groups the rider approved. null when there's no value (no power meter, no ride). */
  metrics: Partial<Record<LacticMetricId, number | null>> & Record<string, number | null>;
  /** Seconds since the Unix epoch. Plugins have no clock of their own. */
  now: number;
  /** Only for ride analyses: the saved ride. */
  ride?: RideInput;
  /** Only for ride fields with `options`: the rider's picks by option id, always from its `choices` (the default until changed). */
  options?: Record<string, string[]>;
}

export interface HandlerOutput {
  tree?: KitNode;
  /** Short names from the manifest's `publishes` ("balance"), each a finite number or one of its choices. */
  metrics?: Record<string, number | string | null>;
}

/**
 * Fields run once per tick (about once a second on the ride screen), synchronously,
 * within 20 ms. Ride analyses run once on a saved ride, within 2 s, and may return up to 128 KB.
 */
export type Handler = (input: HandlerInput) => HandlerOutput | null | undefined;

declare global {
  // Provided by Lactic inside the sandbox.
  // eslint-disable-next-line no-var
  var lactic: { apiVersion: 1; register(handlers: Record<string, Handler>): void };
}

/** Register the plugin's handlers. Call once, at the top level. Names must match the manifest's `entry` values. */
export function definePlugin<H extends Record<string, Handler>>(handlers: H): H {
  globalThis.lactic.register(handlers);
  return handlers;
}

// ---- The manifest ----

export type PublishedMetric =
  | { id: string; label: string; unit?: string; kind: "number" }
  | { id: string; label: string; kind: "choice"; choices: string[] };

/**
 * A choice the rider makes for a ride field in Lactic's field editor, e.g. which durations to show.
 * Up to 4 per field; 2 to 12 choices of up to 16 characters; the rider picks 1 to `max` (default 1).
 */
export interface FieldOption {
  /** Lowercase letters, digits and underscores, starting with a letter. */
  id: string;
  label: string;
  choices: string[];
  /** 1 to `max` of the choices, used until the rider picks. */
  default: string[];
  max?: number;
}

export interface Contribution {
  /** Lowercase letters, digits and dashes. */
  id: string;
  title: string;
  /** The handler name passed to definePlugin. */
  entry: string;
  /** Ride fields only: choices the rider picks, handed to the handler as `input.options`. */
  options?: FieldOption[];
}

export interface PluginManifest {
  apiVersion: 1;
  /** Lowercase letters, digits and dashes, 2 to 40 characters; can't contain "lactic". */
  id: string;
  /** Shown to the rider; can't look like Lactic's own name. */
  name: string;
  version: string;
  description: string;
  author?: string;
  /** An https link to the plugin's source. */
  homepage?: string;
  main: string;
  permissions: { read: MetricGroup[] };
  publishes?: PublishedMetric[];
  /** `analyses` need "rides" in permissions.read. */
  /** Ride fields and ride page sections only; plugins add nothing else. */
  contributes: { fields?: Contribution[]; analyses?: Contribution[] };
}
