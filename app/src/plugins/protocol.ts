// Messages between Lactic (main thread) and the plugin worker. Approved metrics go in; the raw JSON a
// handler returned comes out, and the main thread validates it against the manifest before use.

export interface SandboxLimits {
  /** Time a handler may run per call (a ride tick). Over it, QuickJS interrupts the handler. */
  tickMs: number;
  /** Time the plugin's top-level code may take to load and register. */
  loadMs: number;
  /** Heap limit for the plugin's JavaScript engine. */
  memoryBytes: number;
  /** Stack limit, so deep recursion fails fast instead of eating the heap. */
  stackBytes: number;
  /** Largest output (JSON characters) a handler may return. */
  maxOutputBytes: number;
}

export const DEFAULT_LIMITS: SandboxLimits = {
  tickMs: 20,
  loadMs: 250,
  memoryBytes: 16 * 1024 * 1024,
  stackBytes: 64 * 1024,
  maxOutputBytes: 32 * 1024,
};

/** Why a load or call failed. `timeout` = over its time budget; `memory` = heap limit; `stack` = too
 *  deep; `error` = the plugin threw; `no-entry` = asked for a handler it didn't register; `not-loaded`
 *  = called before a successful load. */
export type FailureKind = "timeout" | "memory" | "stack" | "error" | "no-entry" | "not-loaded";
export interface Failure {
  kind: FailureKind;
  message: string;
}

export type HostToWorker =
  | { type: "load"; source: string; entries: string[]; limits: SandboxLimits }
  | { type: "call"; seq: number; entry: string; input: CallInput; budget?: CallBudget };

/** A bigger allowance for one call: ride analyses, which run once on a saved ride, never during one. */
export interface CallBudget {
  tickMs: number;
  maxOutputBytes: number;
}

/** Ride analyses: 2 s and 128 KB, in the plugin's own worker, off the main thread. */
export const ANALYSIS_BUDGET: CallBudget = { tickMs: 2000, maxOutputBytes: 128 * 1024 };

export interface CallInput {
  /** Only metrics from groups the rider approved. */
  metrics: Record<string, number | null>;
  /** Seconds since the Unix epoch, so plugins needn't read a clock. */
  now: number;
  /** For ride analyses only: the saved ride, cut to the groups the rider approved (ride-input.ts). */
  ride?: RideInput;
}

/** One saved ride as a ride analysis sees it. Numbers (and a few fixed words) only. */
export interface RideInput {
  /** Seconds since the Unix epoch. */
  startedAt: number;
  durationSeconds: number;
  distanceMeters: number | null;
  /** Seconds between samples in the streams. */
  stepSeconds: number;
  watts: (number | null)[] | null;
  heartRate: (number | null)[] | null;
  cadence: (number | null)[] | null;
  /** The workout's target watts at each sample; null on a free ride. */
  target: (number | null)[] | null;
  intervals: { index: number; kind: "steady" | "ramp" | "freeRide"; planned: number; ridden: number; target: number | null; power: number | null; heartRate: number | null; cadence: number | null }[];
  /** GPS track, only with the location permission: latitude, longitude and ride second per point. */
  route: { lat: number[]; lng: number[]; t: (number | null)[] } | null;
}

export type WorkerToHost =
  | { type: "loaded"; ok: true; ms: number }
  | { type: "loaded"; ok: false; failure: Failure; ms: number }
  | { type: "result"; seq: number; ok: true; output: string; ms: number }
  | { type: "result"; seq: number; ok: false; failure: Failure; ms: number; restarted: boolean }
  /** The engine itself broke; the host should terminate this worker and start another. */
  | { type: "fatal" };
