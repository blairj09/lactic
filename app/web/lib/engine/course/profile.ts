// A race course from its file (GPX, TCX or FIT from a route planner or the organizer): the road
// every 100 m with its height, grade and heading, the climbs on it, and what kind of course it is.
// Course files usually have no times, so everything here goes by distance. No browser or Node APIs.

import { haversine } from "../race/solo";
import type { Track } from "../race/track";

/** Meters between profile samples. */
export const STEP = 100;

export type CourseType = "flat" | "rolling" | "hilly" | "mountainous";

export const COURSE_TYPE_LABELS: Record<CourseType, string> = {
  flat: "Flat",
  rolling: "Rolling",
  hilly: "Hilly",
  mountainous: "Mountainous",
};

export interface Climb {
  /** 1, 2, 3... in the order you reach them. */
  n: number;
  /** Meters from the start, where it starts and tops out. */
  from: number;
  to: number;
  gain: number;
  /** Average grade, as a fraction (0.06 is 6%). */
  grade: number;
  /** Steepest 300 m. */
  maxGrade: number;
  /** Height at the top, meters. */
  top: number;
}

/** What the plan and the report need from a course, small enough to keep with the event. */
export interface CourseSummary {
  meters: number;
  gain: number;
  loss: number;
  type: CourseType;
  /** Ends within 500 m of where it starts. */
  loop: boolean;
  hasElevation: boolean;
  climbs: Climb[];
}

export interface CourseProfile extends CourseSummary {
  /** One per STEP meters, from the start: smoothed height, position, and the heading to the next sample (degrees from north). */
  ele: number[];
  lat: number[];
  lng: number[];
  bearing: number[];
  /** Grade over each step to the next, as a fraction. */
  grade: number[];
}

/** Cumulative distance along a track's points, meters. */
export function distances(track: Track): number[] {
  const p = track.points;
  const out = [0];
  for (let i = 1; i < p.length; i++) out.push(out[i - 1] + haversine(p[i - 1].lat, p[i - 1].lng, p[i].lat, p[i].lng));
  return out;
}

/** Keeps points at least `spacing` meters apart (and the last), so a course stores small. */
export function thinTrack(track: Track, maxPoints = 12000): Track {
  const d = distances(track);
  const total = d[d.length - 1];
  const spacing = Math.max(10, total / maxPoints);
  const points = [track.points[0]];
  let last = 0;
  for (let i = 1; i < track.points.length - 1; i++) {
    if (d[i] - last >= spacing) {
      points.push(track.points[i]);
      last = d[i];
    }
  }
  points.push(track.points[track.points.length - 1]);
  return { name: track.name, points: points.map((p) => ({ ...p, t: null, hr: null, watts: null, cadence: null })) };
}

export function bearing(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const r = Math.PI / 180;
  const y = Math.sin((lng2 - lng1) * r) * Math.cos(lat2 * r);
  const x = Math.cos(lat1 * r) * Math.sin(lat2 * r) - Math.sin(lat1 * r) * Math.cos(lat2 * r) * Math.cos((lng2 - lng1) * r);
  return ((Math.atan2(y, x) / r) % 360 + 360) % 360;
}

const STALL = 20;

/** Sustained rises: [from, to] sample indices with at least `minGain` m at `minGrade` on average. */
export function rises(E: ArrayLike<number>, minGain: number, minGrade: number): [number, number][] {
  const out: [number, number][] = [];
  const n = E.length;
  let start = 0;
  let peak = 0;
  const close = (a: number, b: number) => {
    // Trim flat run-ins and run-outs: the climb starts where it climbs.
    const win = 3;
    const g = (x: number, y: number) => (E[y] - E[x]) / ((y - x) * STEP);
    while (b - a > win && g(a, a + win) < minGrade * 0.6) a++;
    while (b - a > win && g(b - win, b) < minGrade * 0.6) b--;
    const gain = E[b] - E[a];
    if (gain >= minGain && gain / ((b - a) * STEP) >= minGrade) out.push([a, b]);
  };
  for (let k = 1; k < n; k++) {
    if (E[k] >= E[peak]) peak = k;
    if (peak === start && E[k] < E[start]) {
      start = peak = k;
      continue;
    }
    // A climb that's stopped climbing for 2 km has ended, even if the road never turns down.
    if (k - start > STALL && E[k] - E[k - STALL] < 15 && peak > start && E[peak] - E[start] > 0) {
      const top = peak;
      close(start, top);
      start = peak = k;
      continue;
    }
    const gain = E[peak] - E[start];
    const tolerance = Math.max(15, 0.15 * gain);
    if (E[peak] - E[k] > tolerance) {
      if (peak > start) close(start, peak);
      let low = peak;
      for (let h = peak; h <= k; h++) if (E[h] < E[low]) low = h;
      start = peak = low;
    }
  }
  if (peak > start) close(start, peak);
  return out;
}

const overlaps = (a: [number, number], list: [number, number][]) => list.some(([c, d]) => a[0] < d && a[1] > c);

/** Climbs: long ones (150 m at 1.5%, or 50 m at 3%) and short steep kicks (20 m at 4%) between them. */
function findClimbs(E: number[]): [number, number][] {
  const long = rises(E, 150, 0.015);
  for (const r of rises(E, 50, 0.03)) if (!overlaps(r, long)) long.push(r);
  for (const r of rises(E, 20, 0.04)) if (!overlaps(r, long) && (r[1] - r[0]) * STEP <= 2000) long.push(r);
  return long.sort((a, b) => a[0] - b[0]);
}

export function courseType(meters: number, gain: number): CourseType {
  const perKm = meters > 0 ? gain / (meters / 1000) : 0;
  return perKm < 5 ? "flat" : perKm < 10 ? "rolling" : perKm < 18 ? "hilly" : "mountainous";
}

/** The course every 100 m. Throws when the file is too short to be a course. */
export function courseProfile(track: Track): CourseProfile {
  const pts = track.points;
  const d = distances(track);
  const meters = d[d.length - 1];
  if (pts.length < 2 || meters < 500) throw new Error("This course is under half a kilometer; is it the right file?");
  const known = pts.filter((p) => p.ele !== null).length;
  const hasElevation = known >= pts.length * 0.5;
  const count = Math.floor(meters / STEP) + 1;
  const lat: number[] = [];
  const lng: number[] = [];
  const raw: number[] = [];
  let i = 0;
  for (let k = 0; k < count; k++) {
    const at = k * STEP;
    while (i < pts.length - 2 && d[i + 1] <= at) i++;
    const a = pts[i];
    const b = pts[Math.min(i + 1, pts.length - 1)];
    const span = d[Math.min(i + 1, pts.length - 1)] - d[i];
    const f = span > 0 ? Math.min(1, Math.max(0, (at - d[i]) / span)) : 0;
    lat.push(a.lat + f * (b.lat - a.lat));
    lng.push(a.lng + f * (b.lng - a.lng));
    const ea = a.ele ?? b.ele;
    const eb = b.ele ?? a.ele;
    raw.push(ea === null || eb === null ? NaN : ea + f * (eb - ea));
  }
  // Fill holes from the neighbors, then smooth over ±200 m so GPS noise doesn't make climbs.
  let last = NaN;
  for (let k = 0; k < count; k++) {
    if (Number.isNaN(raw[k])) raw[k] = last;
    else last = raw[k];
  }
  const firstKnown = raw.findIndex((v) => !Number.isNaN(v));
  for (let k = 0; k < count; k++) if (Number.isNaN(raw[k])) raw[k] = firstKnown >= 0 ? raw[firstKnown] : 0;
  const ele = raw.map((_, k) => {
    let s = 0;
    let c = 0;
    for (let h = Math.max(0, k - 2); h <= Math.min(count - 1, k + 2); h++) {
      s += raw[h];
      c++;
    }
    return Math.round((s / c) * 10) / 10;
  });
  const grade = ele.map((e, k) => (k < count - 1 ? (ele[k + 1] - e) / STEP : 0));
  const heading = lat.map((_, k) => (k < count - 1 ? bearing(lat[k], lng[k], lat[k + 1], lng[k + 1]) : 0));
  if (count > 1) heading[count - 1] = heading[count - 2];

  let gain = 0;
  let loss = 0;
  for (let k = 1; k < count; k++) {
    const dz = ele[k] - ele[k - 1];
    if (dz > 0) gain += dz;
    else loss -= dz;
  }
  const climbs: Climb[] = hasElevation
    ? findClimbs(ele).map(([a, b], n) => {
        let maxGrade = 0;
        for (let k = a; k + 3 <= b; k++) maxGrade = Math.max(maxGrade, (ele[k + 3] - ele[k]) / (3 * STEP));
        const g = (ele[b] - ele[a]) / ((b - a) * STEP);
        return { n: n + 1, from: a * STEP, to: b * STEP, gain: Math.round(ele[b] - ele[a]), grade: round3(g), maxGrade: round3(Math.max(maxGrade, g)), top: Math.round(ele[b]) };
      })
    : [];
  const end = pts[pts.length - 1];
  return {
    meters: Math.round(meters),
    gain: Math.round(gain),
    loss: Math.round(loss),
    type: hasElevation ? courseType(meters, gain) : "flat",
    loop: haversine(pts[0].lat, pts[0].lng, end.lat, end.lng) < 500,
    hasElevation,
    climbs,
    ele,
    lat,
    lng,
    bearing: heading.map((b) => Math.round(b)),
    grade: grade.map(round3),
  };
}

const round3 = (v: number) => Math.round(v * 1000) / 1000;

/** The part of a profile the event keeps. */
export function summarize(p: CourseProfile): CourseSummary {
  return { meters: p.meters, gain: p.gain, loss: p.loss, type: p.type, loop: p.loop, hasElevation: p.hasElevation, climbs: p.climbs };
}

/** Points to sample elevation at when a file has none: one every `spacing` meters along the track. */
export function elevationSamples(track: Track, spacing = 100): { index: number; lat: number; lng: number }[] {
  const d = distances(track);
  const out: { index: number; lat: number; lng: number }[] = [];
  let next = 0;
  track.points.forEach((p, i) => {
    if (d[i] >= next || i === track.points.length - 1) {
      out.push({ index: i, lat: p.lat, lng: p.lng });
      next = d[i] + spacing;
    }
  });
  return out;
}

/** Fills a track's heights from elevations sampled at some of its points (by index), linearly between them. */
export function fillElevation(track: Track, samples: { index: number; ele: number }[]): Track {
  const sorted = [...samples].sort((a, b) => a.index - b.index);
  if (!sorted.length) return track;
  const d = distances(track);
  let s = 0;
  return {
    ...track,
    points: track.points.map((p, i) => {
      while (s < sorted.length - 2 && sorted[s + 1].index <= i) s++;
      const a = sorted[s];
      const b = sorted[Math.min(s + 1, sorted.length - 1)];
      const span = d[b.index] - d[a.index];
      const f = span > 0 ? Math.min(1, Math.max(0, (d[i] - d[a.index]) / span)) : 0;
      return { ...p, ele: Math.round((a.ele + f * (b.ele - a.ele)) * 10) / 10 };
    }),
  };
}
