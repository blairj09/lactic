// The made-up rider and ride a plugin preview runs on, so a rider can see what a plugin draws before
// adding it, without the plugin ever seeing their own data. Same numbers every time (seeded noise).
// Plain data, no browser APIs.
import { liveNumbers, type RideStreams } from "@/lib/ride/fields";
import type { RideInput } from "./protocol";

export const SAMPLE_RIDER = { ftp: 250, weightKg: 72, thresholdHr: 168 };

/** A Sunday-morning sweet spot session: warm-up, 3 × 6 min at 92% with easy spins, cool-down. */
const SEGMENTS: {
  seconds: number;
  from: number;
  to: number;
  cadence: number;
}[] = [
  { seconds: 300, from: 120, to: 185, cadence: 86 },
  { seconds: 360, from: 230, to: 230, cadence: 92 },
  { seconds: 180, from: 140, to: 140, cadence: 84 },
  { seconds: 360, from: 230, to: 230, cadence: 92 },
  { seconds: 180, from: 140, to: 140, cadence: 84 },
  { seconds: 360, from: 230, to: 230, cadence: 93 },
  { seconds: 240, from: 150, to: 110, cadence: 82 },
];

/** Ride fields play the sample ride up to here, near the end of the last hard interval, and show that moment. */
export const FIELDS_UNTIL = 1720;

export interface SampleRide {
  /** One value per second. */
  power: number[];
  heartRate: number[];
  cadence: number[];
  target: number[];
  /** The interval index under way at each second. */
  interval: number[];
  intervals: RideInput["intervals"];
  seconds: number;
}

function seeded(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

let cached: SampleRide | null = null;

export function sampleRide(): SampleRide {
  if (cached) return cached;
  const rand = seeded(42);
  const r: SampleRide = {
    power: [],
    heartRate: [],
    cadence: [],
    target: [],
    interval: [],
    intervals: [],
    seconds: 0,
  };
  let hr = 98;
  SEGMENTS.forEach((seg, index) => {
    const start = r.power.length;
    for (let i = 0; i < seg.seconds; i++) {
      const target = Math.round(seg.from + ((seg.to - seg.from) * i) / Math.max(1, seg.seconds - 1));
      const watts = Math.max(0, Math.round(target + (rand() - 0.5) * 24));
      // Heart rate drifts toward where this power settles, a little higher as the ride goes on.
      const settle = 92 + (watts / SAMPLE_RIDER.ftp) * 78 + r.power.length / 240;
      hr += (settle - hr) * 0.025;
      r.power.push(watts);
      r.target.push(target);
      r.heartRate.push(Math.round(hr + (rand() - 0.5) * 2));
      r.cadence.push(Math.round(seg.cadence + (rand() - 0.5) * 6));
      r.interval.push(index);
    }
    const mean = (xs: number[]) => Math.round(xs.reduce((a, b) => a + b, 0) / xs.length);
    r.intervals.push({
      index,
      kind: seg.from === seg.to ? "steady" : "ramp",
      planned: seg.seconds,
      ridden: seg.seconds,
      target: seg.from === seg.to ? seg.from : null,
      power: mean(r.power.slice(start)),
      heartRate: mean(r.heartRate.slice(start)),
      cadence: mean(r.cadence.slice(start)),
    });
  });
  r.seconds = r.power.length;
  cached = r;
  return r;
}

/** The live numbers a ride field gets at second `t` of the sample ride, from the same code as a real ride. */
export function sampleLiveNumbers(t: number): Record<string, number | null> {
  const r = sampleRide();
  const end = t + 1;
  const streams: RideStreams = {
    power: r.power.slice(0, end),
    heartRate: r.heartRate.slice(0, end),
    cadence: r.cadence.slice(0, end),
    interval: r.interval.slice(0, end),
  };
  const toGo = r.seconds - end;
  return liveNumbers({
    streams,
    ...SAMPLE_RIDER,
    power: r.power[t],
    heartRate: r.heartRate[t],
    cadence: r.cadence[t],
    interval: r.interval[t],
    toGo,
    elapsed: end,
  });
}

/** The sample ride as a ride analysis sees it (no GPS: previews never get a route). */
export function sampleRideInput(startedAt: number): RideInput {
  const r = sampleRide();
  return {
    startedAt,
    durationSeconds: r.seconds,
    distanceMeters: 19_400,
    stepSeconds: 1,
    watts: r.power,
    heartRate: r.heartRate,
    cadence: r.cadence,
    target: r.target,
    intervals: r.intervals,
    route: null,
  };
}

/** A made-up rider's day numbers for card previews. */
export const SAMPLE_DAY: Record<string, number | null> = {
  "fitness.ctl": 58,
  "fitness.atl": 66,
  "fitness.tsb": -8,
  "profile.ftp": SAMPLE_RIDER.ftp,
  "profile.weight": SAMPLE_RIDER.weightKg,
  "profile.wkg": SAMPLE_RIDER.ftp / SAMPLE_RIDER.weightKg,
  "recovery.score": 72,
  "recovery.hrv": 61,
  "recovery.resting_hr": 52,
  "recovery.sleep": 7.4,
};
