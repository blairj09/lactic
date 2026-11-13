// What a ride analysis gets: one saved ride, cut to the groups the rider approved. Power, heart rate,
// cadence, targets and intervals come with "rides"; the GPS track only with "location" (off unless
// ticked, review S5). Streams are thinned to at most MAX_SAMPLES so the input stays small.
// Plain data, no browser APIs.
import type { MetricGroup } from "@shared/sdk";
import type { RideInput } from "./protocol";

export const MAX_SAMPLES = 20_000;

export interface SavedRide {
  startedAt: Date;
  durationSeconds: number;
  distanceMeters: number | null;
}

export interface SavedStream {
  step: number;
  watts: (number | null)[] | null;
  heartRate: (number | null)[] | null;
  cadence: (number | null)[] | null;
  target: (number | null)[] | null;
  intervals: { index: number; kind: string; planned: number; ridden: number; target: number | null; power: number | null; heartRate: number | null; cadence: number | null }[] | null;
  /** [lat, lng] or [lat, lng, ride second]. */
  route: ([number, number] | [number, number, number])[] | null;
}

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** Every n-th sample (n chosen so the stream fits), means over each chunk. */
function thin(values: (number | null)[] | null, factor: number): (number | null)[] | null {
  if (!values?.length) return null;
  if (factor <= 1) return values.map(num);
  const out: (number | null)[] = [];
  for (let i = 0; i < values.length; i += factor) {
    const chunk = values.slice(i, i + factor).map(num).filter((v): v is number => v !== null);
    out.push(chunk.length ? chunk.reduce((a, b) => a + b, 0) / chunk.length : null);
  }
  return out;
}

const KINDS = ["steady", "ramp", "freeRide"];

/** The ride a plugin may see, or null when it may not see rides at all. */
export function rideInput(ride: SavedRide, stream: SavedStream | null, granted: readonly MetricGroup[]): RideInput | null {
  if (!granted.includes("rides")) return null;
  const longest = Math.max(stream?.watts?.length ?? 0, stream?.heartRate?.length ?? 0, stream?.cadence?.length ?? 0, stream?.target?.length ?? 0);
  const factor = Math.max(1, Math.ceil(longest / MAX_SAMPLES));
  const step = Math.max(1, Number(stream?.step) || 1);
  let route: RideInput["route"] = null;
  if (granted.includes("location") && stream?.route?.length) {
    const pts = stream.route.slice(0, MAX_SAMPLES).filter((p) => Array.isArray(p) && num(p[0]) !== null && num(p[1]) !== null);
    route = { lat: pts.map((p) => p[0]), lng: pts.map((p) => p[1]), t: pts.map((p) => num(p[2])) };
  }
  return {
    startedAt: Math.round(ride.startedAt.getTime() / 1000),
    durationSeconds: ride.durationSeconds,
    distanceMeters: num(ride.distanceMeters),
    stepSeconds: step * factor,
    watts: thin(stream?.watts ?? null, factor),
    heartRate: thin(stream?.heartRate ?? null, factor),
    cadence: thin(stream?.cadence ?? null, factor),
    target: thin(stream?.target ?? null, factor),
    intervals: (stream?.intervals ?? []).slice(0, 500).map((i) => ({
      index: num(i.index) ?? 0,
      kind: (KINDS.includes(i.kind) ? i.kind : "steady") as "steady" | "ramp" | "freeRide",
      planned: num(i.planned) ?? 0,
      ridden: num(i.ridden) ?? 0,
      target: num(i.target),
      power: num(i.power),
      heartRate: num(i.heartRate),
      cadence: num(i.cadence),
    })),
    route,
  };
}
