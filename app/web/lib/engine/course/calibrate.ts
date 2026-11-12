// Measuring a rider's own drag from their outdoor rides, and checking the riding model against them.
//
// Each ride is cut into 30-second blocks. In each block the energy you put through the pedals goes
// into climbing, speeding up, rolling resistance and the air:
//   0.976 · P · T = m·g·Δh + ½·m·(v₁² − v₀²) + Crr·m·g·D + ½·ρ·CdA·Σv³·Δt
// so with rolling resistance at a typical value, each block gives one estimate of CdA. The median
// over the blocks of a ride shrugs off wind gusts, GPS jitter and the odd braking corner (the
// "virtual elevation" idea of Chung, done as an energy balance). Rides in a group read low (the
// draft), so a rider's figure is the median of their higher-reading rides.

import { airDensity, speedFor, type BikeSetup } from "./pacing";

export interface RideRecord {
  /** Seconds from the start. */
  t: number;
  /** Meters from the start. */
  distance: number | null;
  /** Meters above sea level. */
  altitude: number | null;
  power: number | null;
}

export interface DragFit {
  /** Drag area, m². */
  cda: number;
  /** Rolling resistance used (not measured). */
  crr: number;
  /** Blocks the estimate came from (30 s each). */
  blocks: number;
}

const G = 9.81;
const EFFICIENCY = 0.976;
const BLOCK = 30;
/** Rolling resistance for a road bike on tarmac: fixed, since one ride can't tell it apart from drag. */
export const ROAD_CRR = 0.0045;

interface Block {
  seconds: number;
  meters: number;
  climb: number;
  /** Mean power, W. */
  watts: number;
  v0: number;
  v1: number;
  /** Σ v³ Δt over the block. */
  cube: number;
  minSpeed: number;
  zeroShare: number;
  ele: number;
}

/** A ride as 1-second samples with smoothed height, then 30-second blocks. Null when it hasn't distance and height. */
function blocksOf(records: RideRecord[]): Block[] | null {
  const pts = records.filter((r) => r.distance !== null && r.altitude !== null && Number.isFinite(r.t)) as (RideRecord & { distance: number; altitude: number })[];
  if (pts.length < BLOCK * 10) return null;
  // Height smoothed over 15 samples: barometers step and GPS heights jitter.
  const ele = pts.map((_, i) => {
    let sum = 0;
    let n = 0;
    for (let j = Math.max(0, i - 7); j <= Math.min(pts.length - 1, i + 7); j++) {
      sum += pts[j].altitude;
      n++;
    }
    return sum / n;
  });
  const speed = pts.map((p, i) => {
    const a = pts[Math.max(0, i - 2)];
    const b = pts[Math.min(pts.length - 1, i + 2)];
    return b.t > a.t ? (b.distance - a.distance) / (b.t - a.t) : 0;
  });
  const out: Block[] = [];
  for (let i = 0; i + BLOCK < pts.length; i += BLOCK) {
    const j = i + BLOCK;
    const seconds = pts[j].t - pts[i].t;
    // A gap (paused, dropped samples) breaks the energy balance.
    if (seconds > BLOCK * 1.2 || seconds <= 0) continue;
    let watts = 0;
    let zero = 0;
    let cube = 0;
    let minSpeed = Infinity;
    for (let k = i; k < j; k++) {
      const p = pts[k].power ?? 0;
      watts += p;
      if (p < 5) zero++;
      const dt = pts[k + 1].t - pts[k].t;
      const v = Math.max(0, speed[k]);
      cube += v * v * v * dt;
      minSpeed = Math.min(minSpeed, v);
    }
    out.push({ seconds, meters: pts[j].distance - pts[i].distance, climb: ele[j] - ele[i], watts: watts / BLOCK, v0: speed[i], v1: speed[j], cube, minSpeed, zeroShare: zero / BLOCK, ele: ele[i] });
  }
  return out;
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** The drag area a ride shows, or null when it hasn't enough steady riding (15 minutes) to tell. */
export function fitDrag(records: RideRecord[], massKg: number, crr = ROAD_CRR): DragFit | null {
  const blocks = blocksOf(records);
  if (!blocks) return null;
  const estimates: number[] = [];
  for (const b of blocks) {
    const grade = b.meters > 0 ? b.climb / b.meters : 0;
    // Pedaling, moving at a speed where the air matters, not steep, not freewheeling (descents and
    // corners are where brakes go on).
    if (b.watts < 80 || b.minSpeed < 4.5 || Math.abs(grade) > 0.06 || b.zeroShare > 0.2) continue;
    const air = 0.5 * airDensity(b.ele) * b.cube;
    if (air <= 0) continue;
    const work = EFFICIENCY * b.watts * b.seconds - massKg * G * b.climb - 0.5 * massKg * (b.v1 * b.v1 - b.v0 * b.v0) - crr * massKg * G * b.meters;
    estimates.push(work / air);
  }
  if (estimates.length < 30) return null;
  const cda = median(estimates);
  if (!(cda >= 0.15 && cda <= 0.6)) return null;
  return { cda: Math.round(cda * 1000) / 1000, crr, blocks: estimates.length };
}

/** A rider's drag area from several rides: the median of the higher-reading half, since group rides read low. */
export function combineFits(fits: DragFit[]): { cda: number; crr: number; rides: number } | null {
  if (fits.length < 2) return null;
  const sorted = [...fits].sort((a, b) => b.cda - a.cda);
  const top = sorted.slice(0, Math.ceil(sorted.length / 2));
  return { cda: Math.round(median(top.map((f) => f.cda)) * 1000) / 1000, crr: fits[0].crr, rides: fits.length };
}

/**
 * How well the riding model times a ride from its own power: each 30-second block ridden at its
 * actual mean power on its actual grade, against the time it really took. Fractional error
 * (positive when the model is slow), or null when the ride can't be checked.
 */
export function timeError(records: RideRecord[], massKg: number, setup: Pick<BikeSetup, "cda" | "crr" | "maxKmh">): number | null {
  const blocks = blocksOf(records);
  if (!blocks) return null;
  let actual = 0;
  let predicted = 0;
  for (const b of blocks) {
    if (b.minSpeed < 2 || b.meters < 50) continue;
    const grade = b.climb / b.meters;
    const v = speedFor(b.watts, grade, massKg, { ...setup, bikeKg: 0 }, airDensity(b.ele));
    actual += b.seconds;
    predicted += b.meters / v;
  }
  if (actual < 20 * 60) return null;
  return predicted / actual - 1;
}
