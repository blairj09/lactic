// Exertion: how hard the whole day was on your heart, rides and everything else, from heart rate by
// minute. Our own model, built on Banister's TRIMP.

import { MINUTES_PER_DAY } from "./health-import";

export interface HeartProfile {
  restingHr: number;
  maxHr: number;
  male: boolean;
}

/** Heart rate reserve below this (easy walking, standing) doesn't count as exertion. */
const MIN_RESERVE = 0.25;

/** Max HR when Settings has none: Tanaka et al. (2001), 208 − 0.7 × age. */
export const estimatedMaxHr = (age: number) => Math.round(208 - 0.7 * age);

/**
 * Banister's training impulse for one minute at `bpm`: reserve fraction × 0.64·e^(1.92·reserve)
 * (men) or 0.86·e^(1.67·reserve) (women). Zero below `MIN_RESERVE`.
 */
export function minuteTrimp(bpm: number, heart: HeartProfile): number {
  const reserve = (bpm - heart.restingHr) / Math.max(heart.maxHr - heart.restingHr, 1);
  if (reserve < MIN_RESERVE) return 0;
  const r = Math.min(reserve, 1.05);
  return heart.male ? r * 0.64 * Math.exp(1.92 * r) : r * 0.86 * Math.exp(1.67 * r);
}

/**
 * TRIMP to a 0-10 exertion: 2.2 × ln(1 + TRIMP/10), so it climbs fast at first and slowly at the top.
 * About 3 is a day on your feet, 5 an hour's endurance ride, 7 a hard session, 8+ a big day.
 */
export const exertionFromTrimp = (trimp: number) => Math.min(10, Math.round(2.2 * Math.log(1 + Math.max(0, trimp) / 10) * 10) / 10);
/** The inverse, for drawing a target. */
export const trimpForExertion = (exertion: number) => 10 * (Math.exp(exertion / 2.2) - 1);

/** A ride's heart rate laid onto the day: the local minute it started and one mean bpm per minute (null for none). */
export interface RideMinutes {
  startMinute: number;
  bpm: (number | null)[];
}

export interface DayExertion {
  day: string;
  /** 0 to 10. */
  exertion: number;
  trimp: number;
  /** The part of it from rides, and from everything else. */
  rideTrimp: number;
  offBikeTrimp: number;
  /** Minutes in heart rate reserve bands: 25-50%, 50-70%, 70-85%, 85%+. */
  bandMinutes: [number, number, number, number];
  /** Minutes with a heart rate reading. Below a few hours the day is mostly unknown. */
  coveredMinutes: number;
}

/** Minutes with heart rate a day needs before its exertion counts (the watch was mostly off otherwise). */
export const MIN_COVERED_MINUTES = 8 * 60;

/**
 * One day's exertion. Inside a ride, the ride's own heart rate (chest strap) wins over the watch's
 * minute; outside rides the watch's minutes count.
 */
export function dayExertion(day: string, watch: (number | null)[] | null, rides: RideMinutes[], heart: HeartProfile): DayExertion {
  const minutes: (number | null)[] = watch ? [...watch] : new Array(MINUTES_PER_DAY).fill(null);
  const fromRide = new Array<boolean>(MINUTES_PER_DAY).fill(false);
  for (const ride of rides)
    ride.bpm.forEach((bpm, i) => {
      const m = ride.startMinute + i;
      if (m < 0 || m >= MINUTES_PER_DAY) return;
      // Inside a ride window, the watch's reading only counts where the ride has none.
      fromRide[m] = true;
      if (bpm !== null) minutes[m] = bpm;
    });

  let rideTrimp = 0;
  let offBikeTrimp = 0;
  let covered = 0;
  const bands: [number, number, number, number] = [0, 0, 0, 0];
  minutes.forEach((bpm, m) => {
    if (bpm === null) return;
    covered++;
    const t = minuteTrimp(bpm, heart);
    if (fromRide[m]) rideTrimp += t;
    else offBikeTrimp += t;
    const reserve = (bpm - heart.restingHr) / Math.max(heart.maxHr - heart.restingHr, 1);
    if (reserve >= 0.85) bands[3]++;
    else if (reserve >= 0.7) bands[2]++;
    else if (reserve >= 0.5) bands[1]++;
    else if (reserve >= MIN_RESERVE) bands[0]++;
  });
  const trimp = rideTrimp + offBikeTrimp;
  return {
    day,
    exertion: exertionFromTrimp(trimp),
    trimp: Math.round(trimp),
    rideTrimp: Math.round(rideTrimp),
    offBikeTrimp: Math.round(offBikeTrimp),
    bandMinutes: bands,
    coveredMinutes: covered,
  };
}

/** A 5-second heart rate stream (as `activity_streams` keeps it) as one mean per minute. */
export function streamMinutes(heartRate: number[] | null, stepSeconds: number): (number | null)[] {
  if (!heartRate?.length || stepSeconds <= 0) return [];
  const perMinute = Math.max(1, Math.round(60 / stepSeconds));
  const out: (number | null)[] = [];
  for (let i = 0; i < heartRate.length; i += perMinute) {
    const values = heartRate.slice(i, i + perMinute).filter((v) => v > 30);
    out.push(values.length ? Math.round(values.reduce((a, b) => a + b, 0) / values.length) : null);
  }
  return out;
}

export interface ExertionNormal {
  /** Mean exertion over the days with enough heart rate in the window. */
  mean: number;
  sd: number;
  days: number;
}

export const MIN_EXERTION_BASELINE_DAYS = 7;

/** How many days with enough heart rate the normal for `day` has so far (it starts at MIN_EXERTION_BASELINE_DAYS). */
export function exertionBaselineDays(days: DayExertion[], day: string, window = 28): number {
  const start = shift(day, -window);
  return days.filter((d) => d.day >= start && d.day < day && d.coveredMinutes >= MIN_COVERED_MINUTES).length;
}

/** Your normal day: the mean and spread of the `window` days before `day` that have enough heart rate. */
export function exertionNormal(days: DayExertion[], day: string, window = 28): ExertionNormal | null {
  const start = shift(day, -window);
  const values = days.filter((d) => d.day >= start && d.day < day && d.coveredMinutes >= MIN_COVERED_MINUTES).map((d) => d.exertion);
  if (values.length < MIN_EXERTION_BASELINE_DAYS) return null;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const sd = Math.sqrt(values.reduce((a, v) => a + (v - mean) ** 2, 0) / Math.max(values.length - 1, 1));
  return { mean, sd, days: values.length };
}

/**
 * Today's exertion target from recovery and your normal: a normal day (50) aims at your usual
 * exertion, each 10 points of recovery moves it about 0.4, as a range a point wide.
 */
export function exertionTarget(recovery: number | null, normal: ExertionNormal | null): { low: number; high: number } | null {
  if (recovery === null || normal === null) return null;
  const centre = clamp(normal.mean + ((recovery - 50) / 10) * 0.4, 1, 9.5);
  return { low: Math.round((centre - 0.5) * 10) / 10, high: Math.round((centre + 0.5) * 10) / 10 };
}

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);
const shift = (day: string, days: number) => {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};
