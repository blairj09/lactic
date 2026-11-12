// @lactic/sdk: what a Lactic plugin can see and send back. Mirrors the app's own types (app/web/lib/sdk
// and app/src/plugins/manifest.ts); app/src/plugins/sdk-package.test.ts keeps the two in step.

// ---- The kit: what a plugin asks Lactic to draw ----

export type Tone = "default" | "good" | "warn" | "bad" | "muted";

/** Plugin buttons can only open the plugin's own detail view. */
export type KitAction = { kind: "open-detail" };

export type KitNode =
  /** A big number with a label, like a head-unit field. */
  | { type: "field"; label: string; value: string; unit?: string; sub?: string; tone?: Tone; lead?: boolean }
  /** A smaller number with a label and a line under it. */
  | { type: "stat"; label: string; value: string; sub?: string; tone?: Tone }
  | { type: "text"; text: string; tone?: Tone; size?: "sm" | "md" | "lg"; weight?: "normal" | "medium" | "semibold" }
  /** A small trend line; values only, scaled to fit. */
  | { type: "sparkline"; values: (number | null)[]; tone?: Tone }
  /** Simple bars, e.g. per day; labels optional. */
  | { type: "bars"; values: (number | null)[]; labels?: string[]; tone?: Tone }
  /** A 0 to 1 bar. */
  | { type: "meter"; value: number; label?: string; tone?: Tone }
  | { type: "stack"; direction?: "row" | "column"; gap?: "sm" | "md"; children: KitNode[] }
  | { type: "button"; label: string; action: KitAction };

/** Limits Lactic enforces on a tree; anything over them is refused for that call. */
export const KIT_LIMITS = { nodes: 200, depth: 6, text: 280, points: 400 } as const;

// ---- Metrics ----

/** Permission groups. `recovery` is health data; `location` is a separate opt-in, off by default. */
export type MetricGroup = "live" | "rides" | "fitness" | "profile" | "recovery" | "location";

/** Lactic's own metric ids, by the group a plugin needs to read them. */
export const METRICS = {
  live: ["power", "power.3s", "power.target", "heart_rate", "cadence", "interval.left", "ride.elapsed", "ride.intensity"],
  rides: ["ride.np", "ride.tss", "ride.duration", "ride.avg_hr"],
  fitness: ["fitness.ctl", "fitness.atl", "fitness.tsb", "plan.week_done"],
  profile: ["profile.ftp", "profile.weight", "profile.wkg"],
  recovery: ["recovery.score", "recovery.hrv", "recovery.resting_hr", "recovery.sleep"],
  location: [],
} as const satisfies Record<MetricGroup, readonly string[]>;

export type LacticMetricId = (typeof METRICS)[keyof typeof METRICS][number];

// ---- Handlers ----

export interface HandlerInput {
  /** Only metrics from groups the rider approved. null when there's no value (no power meter, no ride). */
  metrics: Partial<Record<LacticMetricId, number | null>> & Record<string, number | null>;
  /** Seconds since the Unix epoch. Plugins have no clock of their own. */
  now: number;
}

export interface HandlerOutput {
  tree?: KitNode;
  /** Short names from the manifest's `publishes` ("balance"), each a finite number or one of its choices. */
  metrics?: Record<string, number | string | null>;
}

/** A handler runs once per tick (about once a second on the ride screen), synchronously, within 20 ms. */
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

export interface Contribution {
  /** Lowercase letters, digits and dashes. */
  id: string;
  title: string;
  /** The handler name passed to definePlugin. */
  entry: string;
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
  contributes: { widgets?: Contribution[]; fields?: Contribution[] };
}
