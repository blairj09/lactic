// Pacing a course: the power to ride each part at (flats, climbs, descents) from your FTP and the
// event's intensity, and how long it takes, from the physics of riding a bike (gravity, rolling
// resistance and air, with the wind when there's a forecast). Standard road-cycling models with
// typical values for each kind of race; good to a few percent, which is what a plan needs.

import { eventFactor, goalIntensity, goalMinutes, type Goal, type GoalKind } from "../plan";
import { STEP, type Climb, type CourseProfile } from "./profile";

export interface BikeSetup {
  /** Drag area, m². */
  cda: number;
  /** Rolling resistance coefficient. */
  crr: number;
  bikeKg: number;
  /** Fastest you'd go downhill, km/h: corners and brakes, not physics. */
  maxKmh: number;
}

export function bikeSetup(kind: GoalKind): BikeSetup {
  switch (kind) {
    case "timeTrial":
      return { cda: 0.24, crr: 0.004, bikeKg: 9, maxKmh: 70 };
    case "gravel":
      return { cda: 0.36, crr: 0.008, bikeKg: 9.5, maxKmh: 50 };
    case "mountainBike":
    case "cyclocross":
      return { cda: 0.42, crr: 0.012, bikeKg: 11, maxKmh: 35 };
    case "criterium":
    case "roadRace":
      // Racing in a bunch: the draft takes a good share of the air off.
      return { cda: 0.26, crr: 0.0045, bikeKg: 8, maxKmh: 70 };
    default:
      return { cda: 0.32, crr: 0.0045, bikeKg: 8.5, maxKmh: 65 };
  }
}

const G = 9.81;

/** Air density at a height, kg/m³. */
export const airDensity = (ele: number) => 1.225 * Math.exp(-Math.max(-400, ele) / 8400);

/**
 * Steady speed, m/s, holding `watts` on `grade` (a fraction) for a rider and bike of `massKg`, into
 * a `headwind` (m/s; negative is a tailwind). Capped at the setup's fastest descending speed.
 */
export function speedFor(watts: number, grade: number, massKg: number, setup: BikeSetup, rho: number, headwind = 0): number {
  const theta = Math.atan(grade);
  const resist = massKg * G * (Math.sin(theta) + setup.crr * Math.cos(theta));
  const power = (v: number) => {
    const air = v + headwind;
    return v * (resist + 0.5 * rho * setup.cda * air * Math.abs(air)) * (1 / 0.976);
  };
  let lo = 0.3;
  let hi = setup.maxKmh / 3.6;
  if (power(hi) <= watts) return hi;
  if (power(lo) >= watts) return lo;
  for (let i = 0; i < 50; i++) {
    const mid = (lo + hi) / 2;
    if (power(mid) < watts) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

export interface Rider {
  ftp: number | null;
  weightKg: number | null;
}

/** The rider as the model uses them, with a typical FTP (2.8 W/kg) and weight when they aren't known. */
export function riderOf(r: Rider): { ftp: number; weightKg: number; assumedFtp: boolean; assumedWeight: boolean } {
  const weightKg = r.weightKg && r.weightKg > 30 ? r.weightKg : 75;
  const ftp = r.ftp && r.ftp > 50 ? r.ftp : Math.round(weightKg * 2.8);
  return { ftp, weightKg, assumedFtp: !(r.ftp && r.ftp > 50), assumedWeight: !(r.weightKg && r.weightKg > 30) };
}

/**
 * The share of FTP to hold on a climb that takes `seconds`, in an event of `hours` at `intensity`:
 * the classic power-duration shape (short climbs above FTP, long ones below), eased for long days
 * and for events not raced flat out.
 */
export function climbFraction(seconds: number, hours: number, intensity: Goal["intensity"]): number {
  const m = seconds / 60;
  const base = m < 3 ? 1.2 : m < 8 ? 1.08 : m < 15 ? 1.02 : m < 25 ? 0.97 : m < 45 ? 0.92 : m < 75 ? 0.87 : 0.82;
  const long = hours <= 1.5 ? 1 : hours <= 3 ? 0.96 : hours <= 5 ? 0.92 : 0.88;
  const effort = intensity === "easy" ? 0.82 : intensity === "moderate" ? 0.92 : intensity === "max" ? 1.02 : 1;
  return Math.round(base * long * effort * 100) / 100;
}

/** Seconds to ride a climb at a steady `watts`, by its average grade. */
export function climbSeconds(climb: Pick<Climb, "from" | "to" | "grade" | "top">, watts: number, massKg: number, setup: BikeSetup): number {
  const meters = climb.to - climb.from;
  const v = speedFor(watts, climb.grade, massKg, setup, airDensity(climb.top));
  return meters / v;
}

export interface PacedClimb extends Climb {
  seconds: number;
  /** Share of FTP to hold. */
  fraction: number;
  /** Watts as a range: the bottom for a long day, the top if you're going well. */
  watts: [number, number];
  /** Seconds into the race it starts. */
  startsAt: number;
}

export interface Pacing {
  ftp: number;
  weightKg: number;
  assumedFtp: boolean;
  assumedWeight: boolean;
  /** Intensity factor of the whole race. */
  factor: number;
  /** Power on the flat and rolling parts, as a range. */
  flatWatts: [number, number];
  /** Easy pedalling on descents: recover, eat, drink. */
  descentWatts: number;
  /** Estimated riding time, seconds. */
  seconds: number;
  /** Seconds into the race at each profile sample. */
  at: number[];
  /** Watts the model held over each sample to the next. */
  watts: number[];
  climbs: PacedClimb[];
  avgKmh: number;
}

const band = (watts: number): [number, number] => [Math.round((watts * 0.95) / 5) * 5, Math.round(watts / 5) * 5];

/**
 * Pacing and timing for a course. `headwind(k, seconds)` gives the wind against the rider at sample
 * `k`, in m/s, when there's a forecast.
 */
export function paceCourse(profile: CourseProfile, goal: Goal, rider: Rider, headwind?: (k: number, seconds: number) => number): Pacing {
  const r = riderOf(rider);
  const setup = bikeSetup(goal.kind);
  const mass = r.weightKg + setup.bikeKg;
  const intensity = goalIntensity(goal);
  const n = profile.ele.length;
  const climbAt = new Int32Array(n).fill(-1);
  const climbs = goal.kind === "hillClimb" && profile.climbs.length === 0 && profile.gain > 50 ? [wholeClimb(profile)] : profile.climbs;
  climbs.forEach((c, i) => {
    for (let k = Math.floor(c.from / STEP); k < Math.min(n, Math.ceil(c.to / STEP)); k++) climbAt[k] = i;
  });

  let hours = goalMinutes(goal) / 60;
  let result: Pacing | null = null;
  // A few times through: the race's length sets how hard it's ridden, which sets its length.
  for (let pass = 0; pass < 3; pass++) {
    const factor = eventFactor(intensity, hours);
    const flat = r.ftp * Math.max(0.55, factor - 0.02);
    const descent = Math.round(r.ftp * 0.4);
    const fractions = climbs.map((c) => {
      const first = climbSeconds(c, r.ftp * factor, mass, setup);
      const f = climbFraction(first, hours, intensity);
      return climbFraction(climbSeconds(c, r.ftp * f, mass, setup), hours, intensity);
    });
    const at: number[] = [0];
    const watts: number[] = [];
    for (let k = 0; k < n - 1; k++) {
      const g = profile.grade[k];
      const w = climbAt[k] >= 0 ? r.ftp * fractions[climbAt[k]] : g < -0.02 ? descent : g > 0.02 ? flat * 1.05 : flat;
      const v = speedFor(w, g, mass, setup, airDensity(profile.ele[k]), headwind ? headwind(k, at[k]) : 0);
      watts.push(Math.round(w));
      at.push(at[k] + STEP / v);
    }
    // The last sample is short of a full step.
    const tail = profile.meters - (n - 1) * STEP;
    const lastV = n > 1 ? STEP / (at[n - 1] - at[n - 2]) : 8;
    const seconds = at[n - 1] + Math.max(0, tail) / lastV;
    const paced = climbs.map((c, i) => {
      const a = Math.floor(c.from / STEP);
      const b = Math.min(n - 1, Math.ceil(c.to / STEP));
      return { ...c, seconds: Math.round(at[b] - at[a]), fraction: fractions[i], watts: band(r.ftp * fractions[i]), startsAt: Math.round(at[a]) };
    });
    result = {
      ftp: r.ftp,
      weightKg: r.weightKg,
      assumedFtp: r.assumedFtp,
      assumedWeight: r.assumedWeight,
      factor: Math.round(factor * 100) / 100,
      flatWatts: band(flat),
      descentWatts: descent,
      seconds: Math.round(seconds),
      at: at.map((t) => Math.round(t)),
      watts,
      climbs: paced,
      avgKmh: Math.round((profile.meters / seconds) * 36) / 10,
    };
    hours = seconds / 3600;
  }
  return result!;
}

function wholeClimb(p: CourseProfile): Climb {
  const top = Math.max(...p.ele);
  const to = Math.max(STEP, p.ele.indexOf(top) * STEP);
  const grade = Math.round(((top - p.ele[0]) / to) * 1000) / 1000;
  return { n: 1, from: 0, to, gain: Math.round(top - p.ele[0]), grade, maxGrade: grade, top: Math.round(top) };
}
