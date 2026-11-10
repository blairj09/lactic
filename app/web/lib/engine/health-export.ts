// A ride as an Apple Health cycling workout: start and end, energy, distance, and heart rate,
// power and cadence as timed samples. The iPhone app writes it (src/phone/health.ts), so a ride
// done only in Lactic still shows up in Health and closes the rider's rings.

export interface RideForHealth {
  id: string;
  name: string | null;
  startedAt: string;
  durationSeconds: number;
  distanceMeters: number | null;
  averagePower: number | null;
  /** Outdoor rides carry a GPS route; trainer rides don't. */
  indoor: boolean;
  stepSeconds: number;
  watts: (number | null)[] | null;
  heartRate: (number | null)[] | null;
  cadence: (number | null)[] | null;
}

export interface HealthWorkout {
  id: string;
  name: string | null;
  /** Unix seconds. */
  start: number;
  end: number;
  indoor: boolean;
  kcal: number | null;
  distanceMeters: number | null;
  /** [seconds from the start, value]. */
  heartRate: [number, number][];
  power: [number, number][];
  cadence: [number, number][];
}

/**
 * Gross efficiency of pedalling: about a quarter of the energy burned reaches the pedals. With
 * 4.184 kJ to a kcal, that makes a kilojoule of work almost exactly one kcal burned.
 */
const KCAL_PER_KJ = 1 / (4.184 * 0.24);
/** One sample every this many seconds is plenty for Health's charts. */
const SAMPLE_EVERY_S = 5;

/** Energy burned from the work done: the power stream when there is one, else average power. */
export function rideKcal(ride: Pick<RideForHealth, "durationSeconds" | "averagePower" | "stepSeconds" | "watts">): number | null {
  const step = ride.stepSeconds > 0 ? ride.stepSeconds : 1;
  const stream = (ride.watts ?? []).filter((w): w is number => typeof w === "number" && w > 0);
  const joules = stream.length ? stream.reduce((a, w) => a + w * step, 0) : ride.averagePower && ride.averagePower > 0 ? ride.averagePower * ride.durationSeconds : 0;
  return joules > 0 ? Math.round((joules / 1000) * KCAL_PER_KJ) : null;
}

function samples(stream: (number | null)[] | null, step: number, lo: number, hi: number): [number, number][] {
  const s = step > 0 ? step : 1;
  const every = Math.max(1, Math.round(SAMPLE_EVERY_S / s));
  const out: [number, number][] = [];
  (stream ?? []).forEach((v, i) => {
    if (i % every === 0 && typeof v === "number" && v >= lo && v <= hi) out.push([i * s, Math.round(v)]);
  });
  return out;
}

export function healthWorkout(ride: RideForHealth): HealthWorkout | null {
  const start = Date.parse(ride.startedAt) / 1000;
  if (!Number.isFinite(start) || ride.durationSeconds < 60) return null;
  return {
    id: ride.id,
    name: ride.name,
    start,
    end: start + ride.durationSeconds,
    indoor: ride.indoor,
    kcal: rideKcal(ride),
    distanceMeters: ride.distanceMeters && ride.distanceMeters > 0 ? Math.round(ride.distanceMeters) : null,
    heartRate: samples(ride.heartRate, ride.stepSeconds, 25, 240),
    power: samples(ride.watts, ride.stepSeconds, 1, 3000),
    cadence: samples(ride.cadence, ride.stepSeconds, 1, 250),
  };
}
