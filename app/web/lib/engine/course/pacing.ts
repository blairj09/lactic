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
      // Low on the drops; the draft comes from how it's ridden (`Pack`).
      return { cda: 0.3, crr: 0.0045, bikeKg: 8, maxKmh: 70 };
    default:
      return { cda: 0.32, crr: 0.0045, bikeKg: 8.5, maxKmh: 65 };
  }
}

/** How an event is ridden: alone, in a small group sharing turns, or sitting in a bunch. */
export type Pack = "solo" | "group" | "bunch";

export const PACKS: Pack[] = ["solo", "group", "bunch"];

export const PACK_LABELS: Record<Pack, string> = { solo: "Solo", group: "Small group", bunch: "Bunch" };

/** How most riders ride each kind of event. Time trials and hill climbs are always solo. */
export function defaultPack(kind: GoalKind): Pack {
  switch (kind) {
    case "roadRace":
    case "criterium":
      return "bunch";
    case "granFondo":
    case "gravel":
      return "group";
    default:
      return "solo";
  }
}

/** The pack an event is ridden in: what the rider chose, or the kind's usual; never a draft in a time trial. */
/** Events ridden on a road bike, where drag measured on the rider's road rides applies. */
export const ROAD_KINDS: GoalKind[] = ["roadRace", "criterium", "granFondo", "hillClimb"];

export function packOf(goal: Pick<Goal, "kind"> & { pack?: Pack | null }): Pack {
  if (goal.kind === "timeTrial" || goal.kind === "hillClimb") return "solo";
  return goal.pack ?? defaultPack(goal.kind);
}

/**
 * Share of air drag the draft takes off at full speed. Behind one wheel it's about 25% to 50% (Kyle
 * 1979; Blocken et al. 2013); rotating through a small group you spend some of each lap on the front,
 * so about 28%. Deep in a big peloton it's 90% or more (Blocken et al. 2018), but riders move up,
 * close gaps and ride the wind, so a bunch averages about half.
 */
export const DRAFT: Record<Pack, number> = { solo: 0, group: 0.28, bunch: 0.5 };

/** How much of the draft is there at speed `v` (m/s): little below about 15 km/h, all of it from about 35. */
const draftAt = (v: number) => Math.min(1, Math.max(0, (v - 4) / 6));

const G = 9.81;

/** Air density at a height, kg/m³. */
export const airDensity = (ele: number) => 1.225 * Math.exp(-Math.max(-400, ele) / 8400);

/**
 * Steady speed, m/s, holding `watts` on `grade` (a fraction) for a rider and bike of `massKg`, into
 * a `headwind` (m/s; negative is a tailwind). Capped at the setup's fastest descending speed.
 */
export function speedFor(watts: number, grade: number, massKg: number, setup: BikeSetup, rho: number, headwind = 0, draft = 0): number {
  const theta = Math.atan(grade);
  const resist = massKg * G * (Math.sin(theta) + setup.crr * Math.cos(theta));
  const power = (v: number) => {
    const air = v + headwind;
    const cda = setup.cda * (1 - draft * draftAt(v));
    return v * (resist + 0.5 * rho * cda * air * Math.abs(air)) * (1 / 0.976);
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

/**
 * Aerobic power at an altitude, as a share of sea level (Bassett et al. 1999, from cycling hour
 * records): `acclimatized` for where you live, else for a few days' stay. `km` above sea level.
 */
export function altitudeShare(km: number, acclimatized: boolean): number {
  const x = Math.min(4.5, Math.max(0, km));
  return acclimatized ? (-1.12 * x * x - 1.9 * x + 99.9) / 99.9 : (0.178 * x ** 3 - 1.43 * x * x - 4.07 * x + 100) / 100;
}

/**
 * Your power at `ele` meters as a share of your FTP, which was set where you live (`home` meters):
 * lower higher up, from Bassett et al. 1999. Going up from home you aren't acclimatized to the
 * difference; going down you're acclimatized to more. 1 when home isn't known.
 */
export function altitudeFactor(ele: number, home: number | null | undefined): number {
  if (home === null || home === undefined) return 1;
  const h = home / 1000;
  const e = ele / 1000;
  return e > h ? altitudeShare(e, false) / altitudeShare(h, false) : altitudeShare(e, true) / altitudeShare(h, true);
}

/**
 * Your power in heat as a share of a mild day's: about 0.7% less for each degree over 21°C, from
 * elite cyclists riding a 30-minute time trial 6.5% lower at 32°C than at 23°C (Tatterson et al.
 * 2000). At most 15% off.
 */
export function heatFactor(celsius: number | null | undefined): number {
  if (celsius === null || celsius === undefined || celsius <= 21) return 1;
  return Math.max(0.85, 1 - 0.0072 * (celsius - 21));
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
  // Fresh best power for the climb's length as a share of FTP, the usual power-duration shape:
  // about 120% for 3 minutes, 105% for 20, 100% for an hour (Allen & Coggan; Jones et al. 2010).
  // Ridden as part of a race, not a test, so each step is a little under that.
  const base = m < 3 ? 1.2 : m < 8 ? 1.1 : m < 15 ? 1.04 : m < 25 ? 1.0 : m < 45 ? 0.95 : m < 75 ? 0.9 : 0.85;
  // Durability: hours of work lower what you can hold (Maunder et al. 2021). Professionals rode a
  // 20-minute time trial 2.9% lower after about 4 hours (from 8.5% lower to 1% higher; Barranco-Gil
  // et al. 2023); amateurs tend to fade more, so a little more than that.
  const long = hours <= 1.5 ? 1 : hours <= 3 ? 0.97 : hours <= 5 ? 0.95 : 0.92;
  const effort = intensity === "easy" ? 0.82 : intensity === "moderate" ? 0.92 : intensity === "max" ? 1.02 : 1;
  return Math.round(base * long * effort * 100) / 100;
}

/** Seconds to ride a climb at a steady `watts`, by its average grade. */
export function climbSeconds(climb: Pick<Climb, "from" | "to" | "grade" | "top">, watts: number, massKg: number, setup: BikeSetup, draft = 0): number {
  const meters = climb.to - climb.from;
  const v = speedFor(watts, climb.grade, massKg, setup, airDensity(climb.top), 0, draft);
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
  /** How it was ridden, for the draft. */
  pack: Pack;
  /** Average share of FTP left after altitude and heat (1 when neither applies). */
  powerFactor: number;
}

/**
 * How far the estimate could be off, as the ends of a range: drag ±8% for a rider whose own hasn't
 * been measured (±4% once it has), rolling resistance ±15%, FTP on the day ±3%, and
 * the draft ±0.08 in a group and ±0.15 in a bunch, where who you ride with matters more than any model.
 */
export function spreadFor(pack: Pack, measured: boolean): { slow: NonNullable<PaceOptions["spread"]>; fast: NonNullable<PaceOptions["spread"]> } {
  // Measured drag still carries rolling resistance's uncertainty: one ride can't tell them apart.
  const cda = measured ? 0.04 : 0.08;
  const crr = 0.15;
  const draft = pack === "bunch" ? 0.15 : pack === "group" ? 0.08 : 0;
  return { slow: { cda: 1 + cda, crr: 1 + crr, draft: -draft, ftp: 0.97 }, fast: { cda: 1 - cda, crr: 1 - crr, draft, ftp: 1.03 } };
}

export interface PaceOptions {
  /** The wind against the rider at sample `k`, m/s, when there's a forecast. */
  headwind?: (k: number, seconds: number) => number;
  /** Ride solo from this many meters in (dropped from the group). */
  soloFrom?: number;
  /** Pace for this FTP instead of the rider's (what a target time needs). */
  ftp?: number;
  /** Where the rider lives and trains, meters: power falls at race altitudes above it. */
  homeElevation?: number | null;
  /** Air temperature at sample `k`, °C, when there's a forecast: power falls in heat. */
  temperature?: (k: number, seconds: number) => number | null;
  /** The rider's own drag area and rolling resistance, when Lactic has measured them. */
  setup?: Partial<Pick<BikeSetup, "cda" | "crr">>;
  /** For the range around the estimate: scale drag and rolling resistance, and shift the draft. */
  spread?: { cda: number; crr: number; draft: number; ftp: number };
}

const band = (watts: number): [number, number] => [Math.round((watts * 0.95) / 5) * 5, Math.round(watts / 5) * 5];

/**
 * Pacing and timing for a course, ridden in the event's pack (`goal.pack`, or the kind's usual).
 * `headwind(k, seconds)` gives the wind against the rider at sample `k`, in m/s, when there's a
 * forecast; a bare function is the same as `{ headwind }`.
 */
export function paceCourse(profile: CourseProfile, goal: Goal & { pack?: Pack | null }, rider: Rider, options: PaceOptions | PaceOptions["headwind"] = {}): Pacing {
  const opts: PaceOptions = typeof options === "function" ? { headwind: options } : options;
  const { headwind } = opts;
  const base = riderOf(rider);
  const spread = opts.spread ?? { cda: 1, crr: 1, draft: 0, ftp: 1 };
  const r = { ...base, ftp: (opts.ftp && opts.ftp > 0 ? opts.ftp : base.ftp) * spread.ftp };
  const pack = packOf(goal);
  const soloFrom = opts.soloFrom ?? Infinity;
  const kindSetup = { ...bikeSetup(goal.kind), ...opts.setup };
  const setup = { ...kindSetup, cda: kindSetup.cda * spread.cda, crr: kindSetup.crr * spread.crr };
  const draftOf = (p: Pack) => (p === "solo" ? 0 : Math.min(0.9, Math.max(0, DRAFT[p] + spread.draft)));
  const powerAt = (k: number, t: number) => altitudeFactor(profile.ele[k] ?? 0, opts.homeElevation) * heatFactor(opts.temperature?.(k, t));
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
      const d = c.from >= soloFrom ? 0 : draftOf(pack);
      const first = climbSeconds(c, r.ftp * factor, mass, setup, d);
      const f = climbFraction(first, hours, intensity);
      return climbFraction(climbSeconds(c, r.ftp * f, mass, setup, d), hours, intensity);
    });
    const at: number[] = [0];
    const watts: number[] = [];
    const factors: number[] = [];
    for (let k = 0; k < n - 1; k++) {
      const g = profile.grade[k];
      const f = powerAt(k, at[k]);
      factors.push(f);
      const w = f * (climbAt[k] >= 0 ? r.ftp * fractions[climbAt[k]] : g < -0.02 ? descent : g > 0.02 ? flat * 1.05 : flat);
      const draft = k * STEP >= soloFrom ? 0 : draftOf(pack);
      const v = speedFor(w, g, mass, setup, airDensity(profile.ele[k]), headwind ? headwind(k, at[k]) : 0, draft);
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
      const mid = Math.min(n - 2, Math.round((a + b) / 2));
      return { ...c, seconds: Math.round(at[b] - at[a]), fraction: fractions[i], watts: band(r.ftp * fractions[i] * (factors[mid] ?? 1)), startsAt: Math.round(at[a]) };
    });
    const meanFactor = factors.length ? factors.reduce((x, y) => x + y, 0) / factors.length : 1;
    result = {
      ftp: r.ftp,
      weightKg: r.weightKg,
      assumedFtp: r.assumedFtp,
      assumedWeight: r.assumedWeight,
      factor: Math.round(factor * 100) / 100,
      flatWatts: band(flat * meanFactor),
      descentWatts: Math.round(descent * meanFactor),
      powerFactor: Math.round(meanFactor * 1000) / 1000,
      seconds: Math.round(seconds),
      at: at.map((t) => Math.round(t)),
      watts,
      climbs: paced,
      avgKmh: Math.round((profile.meters / seconds) * 36) / 10,
      pack,
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
