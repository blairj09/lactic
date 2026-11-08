// Lining riders up on a lapped course. The rider's own ride file sets the course: its timing line
// (the gate every lap starts and ends at) and the shape of one lap, measured in meters from the line.
// Every rider's laps are then mapped onto that lap, so "meter 840 of lap 3" means the same place for
// everyone, and their times there can be compared directly.

import { isTimed, projection, type Projection, type Track } from "./track";

/** A rider's points, projected to meters on the course. `t` is seconds since 1970, or the point's index in a file without times. */
export interface Projected {
  x: Float64Array;
  y: Float64Array;
  t: Float64Array;
  timed: boolean;
  track: Track;
}

export interface Gate {
  lat: number;
  lng: number;
  x: number;
  y: number;
  /** Direction of travel across the line, a unit vector. */
  hx: number;
  hy: number;
}

export interface Course {
  proj: Projection;
  gate: Gate;
  /** Meters in a lap. */
  length: number;
  /** The lap's line, one point per meter from the timing line. */
  x: Float64Array;
  y: Float64Array;
  /** Direction of travel at each meter, radians. */
  heading: Float64Array;
}

/** A crossing of the timing line: when, in the track's time units, and at which (fractional) point. */
export interface Crossing {
  at: number;
  index: number;
}

/** A rider's laps on the course: race-clock seconds (from the gun) at each meter of each lap, NaN where unknown. */
export interface Laps {
  at: Float64Array[];
  /** Each lap's time from its start to its end, seconds, when both are known. */
  seconds: (number | null)[];
  /** Where the rider was matched on the lap (lap index, meter) for each of their points; NaN off course. */
  pointLap: Int16Array;
  pointMeter: Float64Array;
  /** Race clock at each of their points. */
  clock: Float64Array;
}

/** Seconds after the start before a crossing can end a lap: rolling over the line from the grid doesn't count. */
const MIN_LAP_SECONDS = 60;
/** How far either side of the gate point a crossing can be, meters. */
const GATE_HALF_WIDTH = 12;
/** Farther than this from the lap's line is off course (a pit, a crash, bad GPS), meters. */
const OFF_COURSE = 25;

export function project(track: Track, proj: Projection): Projected {
  const n = track.points.length;
  const x = new Float64Array(n);
  const y = new Float64Array(n);
  const t = new Float64Array(n);
  const timed = isTimed(track);
  track.points.forEach((p, i) => {
    x[i] = proj.x(p.lat, p.lng);
    y[i] = proj.y(p.lat);
    t[i] = timed ? (p.t as number) : i;
  });
  return { x, y, t, timed, track };
}

export const courseProjection = (track: Track) => projection(track.points[0].lat, track.points[0].lng);

const dist = (p: Projected, i: number, j: number) => Math.hypot(p.x[j] - p.x[i], p.y[j] - p.y[i]);

/** The first point of sustained riding: moving over 3 m/s for the next five seconds (or points). */
export function motionStart(p: Projected): number {
  const n = p.x.length;
  for (let i = 0; i < n - 1; i++) {
    let j = i;
    while (j < n - 1 && p.t[j] - p.t[i] < 5) j++;
    const dt = p.t[j] - p.t[i];
    if (dt <= 0) continue;
    let d = 0;
    for (let k = i; k < j; k++) d += dist(p, k, k + 1);
    if (d / dt > 3) return i;
  }
  return 0;
}

export function gateAt(p: Projected, i: number, proj: Projection): Gate {
  const a = Math.max(0, i - 3);
  const b = Math.min(p.x.length - 1, i + 3);
  const hx0 = p.x[b] - p.x[a];
  const hy0 = p.y[b] - p.y[a];
  const len = Math.hypot(hx0, hy0) || 1;
  return { x: p.x[i], y: p.y[i], hx: hx0 / len, hy: hy0 / len, lat: proj.lat(p.y[i]), lng: proj.lng(p.x[i]) };
}

/** Every time the track crosses the gate's line in its direction of travel, near the gate. */
export function crossings(p: Projected, gate: Gate, debounce = 45): Crossing[] {
  const out: Crossing[] = [];
  for (let i = 0; i < p.x.length - 1; i++) {
    const sa = (p.x[i] - gate.x) * gate.hx + (p.y[i] - gate.y) * gate.hy;
    const sb = (p.x[i + 1] - gate.x) * gate.hx + (p.y[i + 1] - gate.y) * gate.hy;
    if (!(sa < 0 && sb >= 0)) continue;
    const f = -sa / (sb - sa);
    const cx = p.x[i] + f * (p.x[i + 1] - p.x[i]);
    const cy = p.y[i] + f * (p.y[i + 1] - p.y[i]);
    const lateral = Math.abs(-(cx - gate.x) * gate.hy + (cy - gate.y) * gate.hx);
    if (lateral > GATE_HALF_WIDTH) continue;
    const at = p.t[i] + f * (p.t[i + 1] - p.t[i]);
    if (out.length && at - out[out.length - 1].at < debounce) continue;
    out.push({ at, index: i + f });
  }
  return out;
}

export interface CourseFit {
  course: Course;
  own: Projected;
  /** Seconds since 1970 of the gun, from the rider's own file. */
  gun: number;
  /** The rider's lap ends, in their file's time. */
  lapEnds: Crossing[];
}

/**
 * Finds the course from the rider's own (timed) ride. The timing line is near the start; with the
 * rider's official lap times it's the place where their crossings match those times best, otherwise
 * the place near the start they crossed most often.
 */
export function fitCourse(own: Track, officialLaps?: number[] | null): CourseFit {
  if (!isTimed(own)) throw new Error("Your own ride file needs times");
  const proj = courseProjection(own);
  const p = project(own, proj);
  const s0 = motionStart(p);
  const moved = p.t[s0];
  let best: { score: number; gate: Gate; ends: Crossing[] } | null = null;
  for (let i = s0; i < p.x.length && p.t[i] - moved <= 240; i += 2) {
    const gate = gateAt(p, i, proj);
    const ends = crossings(p, gate).filter((c) => c.at > moved + MIN_LAP_SECONDS);
    if (!ends.length) continue;
    let score: number;
    if (officialLaps?.length) {
      if (ends.length < officialLaps.length) continue;
      score = Math.abs(ends[0].at - moved - officialLaps[0]);
      for (let k = 1; k < officialLaps.length; k++) score += Math.abs(ends[k].at - ends[k - 1].at - officialLaps[k]);
    } else score = -ends.length * 1000 + (i - s0) / 1000;
    if (!best || score < best.score) best = { score, gate, ends };
  }
  if (!best) throw new Error("Couldn't find laps in your ride: it never comes back past the start");
  const ends = officialLaps?.length ? best.ends.slice(0, officialLaps.length) : best.ends;
  // The official first lap runs from the gun; trust it over when the rider started moving, within reason.
  let gun = moved;
  if (officialLaps?.length) {
    const fromResults = ends[0].at - officialLaps[0];
    if (Math.abs(fromResults - moved) < 30) gun = fromResults;
  }

  // The lap's shape: the rider's fastest full lap after the first.
  const bounds = [{ at: gun, index: s0 }, ...ends];
  let ref = ends.length > 1 ? 1 : 0;
  for (let k = 1; k < ends.length; k++) if (bounds[k + 1].at - bounds[k].at < bounds[ref + 1].at - bounds[ref].at) ref = k;
  const course = lapLine(p, bounds[ref].index, bounds[ref + 1].index, best.gate, proj);
  return { course, own: p, gun, lapEnds: ends };
}

/** One lap's line, smoothed and resampled to a point per meter. */
function lapLine(p: Projected, from: number, to: number, gate: Gate, proj: Projection): Course {
  const xs: number[] = [gate.x];
  const ys: number[] = [gate.y];
  for (let i = Math.ceil(from); i <= Math.floor(to); i++) {
    // A little smoothing takes the GPS jitter out of corners without cutting them.
    let sx = 0;
    let sy = 0;
    let n = 0;
    for (let k = Math.max(Math.ceil(from), i - 1); k <= Math.min(Math.floor(to), i + 1); k++) {
      sx += p.x[k];
      sy += p.y[k];
      n++;
    }
    xs.push(sx / n);
    ys.push(sy / n);
  }
  xs.push(gate.x);
  ys.push(gate.y);
  const cum = [0];
  for (let i = 1; i < xs.length; i++) cum.push(cum[i - 1] + Math.hypot(xs[i] - xs[i - 1], ys[i] - ys[i - 1]));
  const length = Math.round(cum[cum.length - 1]);
  const x = new Float64Array(length + 1);
  const y = new Float64Array(length + 1);
  let j = 0;
  for (let m = 0; m <= length; m++) {
    const want = (m / length) * cum[cum.length - 1];
    while (j < cum.length - 2 && cum[j + 1] < want) j++;
    const seg = cum[j + 1] - cum[j] || 1;
    const f = Math.min(1, Math.max(0, (want - cum[j]) / seg));
    x[m] = xs[j] + f * (xs[j + 1] - xs[j]);
    y[m] = ys[j] + f * (ys[j + 1] - ys[j]);
  }
  const heading = new Float64Array(length + 1);
  for (let m = 0; m <= length; m++) {
    const a = Math.max(0, m - 3);
    const b = Math.min(length, m + 3);
    heading[m] = Math.atan2(y[b] - y[a], x[b] - x[a]);
  }
  return { proj, gate, length, x, y, heading };
}

const angleBetween = (a: number, b: number) => {
  const d = Math.abs(a - b) % (2 * Math.PI);
  return d > Math.PI ? 2 * Math.PI - d : d;
};

/**
 * Where on the lap each point from `from` to `to` (point indices) was, in meters, moving only forward.
 * The first point is searched for in `start` (meters); NaN while off course.
 */
export function matchLap(p: Projected, course: Course, from: number, to: number, start: [number, number]): Float64Array {
  const out = new Float64Array(Math.max(0, to - from + 1)).fill(NaN);
  let prev = NaN;
  const L = course.length;
  for (let i = from; i <= to; i++) {
    const a = Math.max(0, i - 1);
    const b = Math.min(p.x.length - 1, i + 1);
    const moving = Math.hypot(p.x[b] - p.x[a], p.y[b] - p.y[a]) > 1;
    const dir = Math.atan2(p.y[b] - p.y[a], p.x[b] - p.x[a]);
    const step = i > 0 ? Math.hypot(p.x[i] - p.x[i - 1], p.y[i] - p.y[i - 1]) : 0;
    const lo = Number.isNaN(prev) ? start[0] : Math.max(0, prev - 5);
    const hi = Number.isNaN(prev) ? start[1] : Math.min(L, prev + 30 + 3 * step);
    let bestM = -1;
    let bestCost = Infinity;
    let bestDist = Infinity;
    for (let m = Math.floor(lo); m <= Math.ceil(hi); m++) {
      if (m < 0 || m > L) continue;
      const d2 = (course.x[m] - p.x[i]) ** 2 + (course.y[m] - p.y[i]) ** 2;
      // The tape often runs back alongside itself a few meters away: going the wrong way costs a lot.
      const wrongWay = moving && angleBetween(dir, course.heading[m]) > (100 * Math.PI) / 180 ? 400 : 0;
      // Moving on about as far as the rider rode keeps them in their lane where the tape runs back
      // alongside itself a few meters away.
      const jump = Number.isNaN(prev) ? 0 : ((m - prev - step) / 4) ** 2;
      const cost = d2 + wrongWay + jump;
      if (cost < bestCost) {
        bestCost = cost;
        bestM = m;
        bestDist = Math.sqrt(d2);
      }
    }
    if (bestM < 0 || bestDist > OFF_COURSE) continue;
    const m = Number.isNaN(prev) ? bestM : Math.max(prev, bestM);
    out[i - from] = m;
    prev = m;
  }
  return out;
}

/**
 * Race clock at each meter of a lap from matched points: the clock when the rider first reached it,
 * between points by interpolation. Optional anchors pin the lap's start (meter 0) and end (meter L).
 */
export function clockAtMeters(meters: Float64Array, clocks: Float64Array, length: number, startAt: number | null, endAt: number | null): Float64Array {
  const ms: number[] = [];
  const cs: number[] = [];
  if (startAt !== null) {
    ms.push(0);
    cs.push(startAt);
  }
  for (let i = 0; i < meters.length; i++) {
    if (Number.isNaN(meters[i])) continue;
    if (ms.length && meters[i] <= ms[ms.length - 1]) continue;
    if (endAt !== null && clocks[i] >= endAt) continue;
    ms.push(meters[i]);
    cs.push(clocks[i]);
  }
  if (endAt !== null) {
    if (ms.length && ms[ms.length - 1] >= length) {
      ms.pop();
      cs.pop();
    }
    ms.push(length);
    cs.push(endAt);
  }
  const out = new Float64Array(length + 1).fill(NaN);
  if (ms.length < 2) return out;
  let j = 0;
  for (let m = Math.ceil(ms[0]); m <= Math.min(length, ms[ms.length - 1]); m++) {
    while (j < ms.length - 2 && ms[j + 1] < m) j++;
    const f = (m - ms[j]) / (ms[j + 1] - ms[j]);
    out[m] = cs[j] + f * (cs[j + 1] - cs[j]);
  }
  return out;
}

/** Interpolates a fractional point index to its time. */
const timeAtIndex = (p: Projected, index: number) => {
  const i = Math.min(p.t.length - 2, Math.floor(index));
  const f = index - i;
  return p.t[i] + f * (p.t[i + 1] - p.t[i]);
};

/**
 * A rider's laps on the course. `clock` turns their file's time into race-clock seconds;
 * `ends` are their lap-ending crossings; `startsAtGun` says their file starts on the grid, so lap 1
 * starts at meter 0 at the gun (clock 0); otherwise lap 1 starts where their file does.
 */
export function lapsOf(p: Projected, course: Course, ends: Crossing[], laps: number, clock: (t: number) => number, startIndex: number, startsAtGun: boolean): Laps {
  const L = course.length;
  const n = p.x.length;
  const clocks = new Float64Array(n);
  for (let i = 0; i < n; i++) clocks[i] = clock(p.t[i]);
  const pointLap = new Int16Array(n).fill(-1);
  const pointMeter = new Float64Array(n).fill(NaN);
  const at: Float64Array[] = [];
  const seconds: (number | null)[] = [];
  for (let k = 0; k < laps; k++) {
    const startIdx = k === 0 ? startIndex : ends[k - 1]?.index;
    if (startIdx === undefined) {
      at.push(new Float64Array(L + 1).fill(NaN));
      seconds.push(null);
      continue;
    }
    const endIdx = ends[k]?.index ?? n - 1;
    const from = Math.ceil(startIdx);
    const to = Math.min(n - 1, Math.floor(endIdx));
    const startAt = k === 0 ? (startsAtGun ? 0 : null) : clock(timeAtIndex(p, startIdx));
    const endAt = ends[k] ? clock(timeAtIndex(p, ends[k].index)) : null;
    // Lap 1 from a file that starts partway round: look for the rider anywhere on the lap.
    const window: [number, number] = k === 0 && !startsAtGun ? [0, L] : [0, Math.min(L, 60)];
    const meters = matchLap(p, course, from, to, window);
    for (let i = from; i <= to; i++) {
      if (Number.isNaN(meters[i - from])) continue;
      pointLap[i] = k;
      pointMeter[i] = meters[i - from];
    }
    const lap = clockAtMeters(meters, clocks.subarray(from, to + 1), L, startAt, endAt);
    at.push(lap);
    seconds.push(Number.isNaN(lap[0]) || Number.isNaN(lap[L]) ? null : lap[L] - lap[0]);
  }
  return { at, seconds, pointLap, pointMeter, clock: clocks };
}

/**
 * The clock for a rider whose lap times are known (official results): each lap-ending crossing is
 * pinned to its official time, with even spacing between, and before the first or after the last at
 * the rider's typical seconds per point (or per second of their own clock).
 */
export function clockFromLaps(ends: Crossing[], officialLaps: number[]): (t: number) => number {
  const pins: [number, number][] = [];
  let sum = 0;
  for (let k = 0; k < Math.min(ends.length, officialLaps.length); k++) {
    sum += officialLaps[k];
    pins.push([ends[k].at, sum]);
  }
  if (!pins.length) return (t) => t;
  const rates: number[] = [];
  for (let k = 1; k < pins.length; k++) rates.push((pins[k][1] - pins[k - 1][1]) / (pins[k][0] - pins[k - 1][0]));
  rates.sort((a, b) => a - b);
  const rate = rates.length ? rates[Math.floor(rates.length / 2)] : 1;
  return (t) => {
    if (t <= pins[0][0]) return pins[0][1] - (pins[0][0] - t) * rate;
    const last = pins[pins.length - 1];
    if (t >= last[0]) return last[1] + (t - last[0]) * rate;
    let k = 1;
    while (pins[k][0] < t) k++;
    const [t0, c0] = pins[k - 1];
    const [t1, c1] = pins[k];
    return c0 + ((t - t0) / (t1 - t0)) * (c1 - c0);
  };
}

export { MIN_LAP_SECONDS };
