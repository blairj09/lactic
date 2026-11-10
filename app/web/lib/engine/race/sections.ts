// The lap cut into pieces a rider would name: corners, straights, climbs, descents, and slow spots
// (barriers, sand, run-ups), from the lap's shape, its elevation and the rider's own speed.

import type { Course, Laps, Projected } from "./course";

export type SectionKind = "corner" | "straight" | "climb" | "descent" | "slow";

export interface Section {
  id: number;
  kind: SectionKind;
  /** "Corner 3", "Climb 1"... */
  label: string;
  /** Meters from the timing line. */
  from: number;
  to: number;
  /** Corners: how far it turns, degrees, positive to the left. */
  turn: number;
  /** Elevation change over the section, meters (0 without elevation). */
  rise: number;
  /** A corner of 135° or more. */
  hairpin: boolean;
  /** Where to put its label on a map. */
  at: [number, number];
}

export const KIND_LABEL: Record<SectionKind, string> = {
  corner: "Corner",
  straight: "Straight",
  climb: "Climb",
  descent: "Descent",
  slow: "Slow spot",
};

const deg = (r: number) => (r * 180) / Math.PI;
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/** Speed at each meter of a lap from its clock, m/s, over ±`half` meters. */
export function speedAt(at: Float64Array, half = 5): Float64Array {
  const L = at.length - 1;
  const out = new Float64Array(L + 1).fill(NaN);
  for (let m = 0; m <= L; m++) {
    const a = Math.max(0, m - half);
    const b = Math.min(L, m + half);
    const dt = at[b] - at[a];
    if (dt > 0) out[m] = (b - a) / dt;
  }
  return out;
}

function median(values: number[]): number {
  const v = values.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return NaN;
  const h = Math.floor(v.length / 2);
  return v.length % 2 ? v[h] : (v[h - 1] + v[h]) / 2;
}

/** The rider's typical speed at each meter: the median over their laps. */
export function typicalSpeed(laps: Laps, length: number): Float64Array {
  const speeds = laps.at.map((a) => speedAt(a));
  const out = new Float64Array(length + 1);
  for (let m = 0; m <= length; m++) out[m] = median(speeds.map((s) => s[m]));
  return out;
}

/** Elevation at each meter of the lap, averaged over the rider's laps and smoothed; null without elevation. */
export function lapElevation(p: Projected, laps: Laps, length: number): Float64Array | null {
  const sum = new Float64Array(length + 1);
  const count = new Float64Array(length + 1);
  p.track.points.forEach((pt, i) => {
    const m = laps.pointMeter[i];
    if (pt.ele === null || Number.isNaN(m)) return;
    const r = Math.round(m);
    sum[r] += pt.ele;
    count[r]++;
  });
  if (count.reduce((a, b) => a + b, 0) < 20) return null;
  const raw = new Float64Array(length + 1).fill(NaN);
  for (let m = 0; m <= length; m++) if (count[m]) raw[m] = sum[m] / count[m];
  // Fill gaps, then smooth over ±10 m: GPS and barometers are noisy over a few meters.
  let last = NaN;
  for (let m = 0; m <= length; m++) if (Number.isNaN(raw[m])) raw[m] = last; else last = raw[m];
  last = NaN;
  for (let m = length; m >= 0; m--) if (Number.isNaN(raw[m])) raw[m] = last; else last = raw[m];
  const out = new Float64Array(length + 1);
  for (let m = 0; m <= length; m++) {
    let s = 0;
    let n = 0;
    for (let k = Math.max(0, m - 10); k <= Math.min(length, m + 10); k++) {
      s += raw[k];
      n++;
    }
    out[m] = s / n;
  }
  return out;
}

const CORNER_RATE = (30 * Math.PI) / 180; // turning over ±5 m
const MIN_CORNER = (45 * Math.PI) / 180;
const SLOW = 3; // m/s, about 11 km/h: barriers, sand, run-ups
const MIN_PIECE = 12;

interface Piece {
  kind: SectionKind;
  from: number;
  to: number;
}

function runs(mask: boolean[], mergeGap: number): [number, number][] {
  const out: [number, number][] = [];
  for (let m = 0; m < mask.length; m++) {
    if (!mask[m]) continue;
    let e = m;
    while (e + 1 < mask.length && mask[e + 1]) e++;
    if (out.length && m - out[out.length - 1][1] <= mergeGap) out[out.length - 1][1] = e;
    else out.push([m, e]);
    m = e;
  }
  return out;
}

/** Splits a stretch by climbing and descending, where it rises or drops enough to matter. */
function splitByGrade(from: number, to: number, ele: Float64Array | null, out: Piece[]) {
  if (!ele || to - from < MIN_PIECE * 2) {
    out.push({ kind: "straight", from, to });
    return;
  }
  // The biggest rise and the biggest drop within the stretch.
  let best: Piece & { size: number } = { kind: "straight", from, to, size: 0 };
  let lo = from;
  let hi = from;
  for (let m = from; m <= to; m++) {
    if (ele[m] < ele[lo]) lo = m;
    if (ele[m] > ele[hi]) hi = m;
    const rise = ele[m] - ele[lo];
    const drop = ele[hi] - ele[m];
    if (rise > best.size && m - lo >= 10 && rise / (m - lo) >= 0.03) best = { kind: "climb", from: lo, to: m, size: rise };
    if (drop > best.size && m - hi >= 10 && drop / (m - hi) >= 0.03) best = { kind: "descent", from: hi, to: m, size: drop };
  }
  if (best.size < 1.5) {
    out.push({ kind: "straight", from, to });
    return;
  }
  if (best.from - from >= MIN_PIECE) splitByGrade(from, best.from, ele, out);
  else best.from = from;
  const tail = to - best.to >= MIN_PIECE;
  out.push({ kind: best.kind, from: best.from, to: tail ? best.to : to });
  if (tail) splitByGrade(best.to, to, ele, out);
}

/** The lap's sections, in order from the timing line, covering it end to end. */
export function lapSections(course: Course, ele: Float64Array | null, speed: Float64Array): Section[] {
  const L = course.length;
  const turnAt = new Float64Array(L + 1);
  for (let m = 0; m <= L; m++) turnAt[m] = wrap(course.heading[Math.min(L, m + 5)] - course.heading[Math.max(0, m - 5)]);
  const corners = runs(Array.from(turnAt, (t) => Math.abs(t) > CORNER_RATE), 6)
    .map(([a, b]) => ({ a, b, turn: wrap(course.heading[Math.min(L, b + 4)] - course.heading[Math.max(0, a - 4)]) }))
    // A long sweeping turn adds up past 180°; count it from its turning, not the ends.
    .map((c) => {
      let sum = 0;
      for (let m = c.a; m < c.b; m++) sum += wrap(course.heading[m + 1] - course.heading[m]);
      return { ...c, turn: Math.abs(sum) > Math.abs(c.turn) ? sum : c.turn };
    })
    .filter((c) => Math.abs(c.turn) >= MIN_CORNER);

  // Each corner takes in its braking and exit, a few meters either side.
  const pieces: Piece[] = [];
  const cornerPieces: (Piece & { turn: number })[] = [];
  for (const c of corners) {
    const from = Math.max(0, c.a - 4);
    const to = Math.min(L, c.b + 4);
    const last = cornerPieces[cornerPieces.length - 1];
    if (last && from - last.to < 8) {
      last.to = to;
      last.turn += c.turn;
    } else cornerPieces.push({ kind: "corner", from, to, turn: c.turn });
  }

  // Between corners: slow spots first, then climbs and descents.
  let cursor = 0;
  const gaps: [number, number][] = [];
  for (const c of cornerPieces) {
    if (c.from - cursor > 0) gaps.push([cursor, c.from]);
    cursor = c.to;
  }
  if (L - cursor > 0) gaps.push([cursor, L]);
  const between: Piece[] = [];
  for (const [a, b] of gaps) {
    const slow = runs(Array.from({ length: b - a + 1 }, (_, i) => speed[a + i] < SLOW), 5)
      .map(([s, e]) => [a + s, a + e] as [number, number])
      .filter(([s, e]) => e - s >= 5);
    let at = a;
    for (const [s, e] of slow) {
      const from = Math.max(at, s - 4);
      const to = Math.min(b, e + 4);
      if (from - at >= MIN_PIECE) splitByGrade(at, from, ele, between);
      between.push({ kind: "slow", from: from - at >= MIN_PIECE ? from : at, to: b - to >= MIN_PIECE ? to : b });
      at = b - to >= MIN_PIECE ? to : b;
    }
    if (b - at > 0) {
      if (b - at >= MIN_PIECE || !between.length) splitByGrade(at, b, ele, between);
      else between[between.length - 1].to = b;
    }
  }
  pieces.push(...cornerPieces, ...between);
  pieces.sort((x, y) => x.from - y.from);

  // Tiny leftovers join the piece before them.
  const merged: (Piece & { turn: number })[] = [];
  for (const p of pieces) {
    const turn = "turn" in p ? (p as { turn: number }).turn : 0;
    const prev = merged[merged.length - 1];
    if (prev && p.to - p.from < 6) prev.to = p.to;
    else merged.push({ ...p, turn });
  }
  if (merged.length) {
    merged[0].from = 0;
    merged[merged.length - 1].to = L;
    for (let i = 1; i < merged.length; i++) merged[i].from = merged[i - 1].to;
  }

  const counts: Record<SectionKind, number> = { corner: 0, straight: 0, climb: 0, descent: 0, slow: 0 };
  return merged.map((p, id) => {
    counts[p.kind]++;
    const mid = Math.round((p.from + p.to) / 2);
    return {
      id,
      kind: p.kind,
      label: `${KIND_LABEL[p.kind]} ${counts[p.kind]}`,
      from: p.from,
      to: p.to,
      turn: Math.round(deg(p.turn)),
      rise: ele ? Math.round((ele[p.to] - ele[p.from]) * 10) / 10 : 0,
      hairpin: p.kind === "corner" && Math.abs(deg(p.turn)) >= 135,
      at: [course.proj.lat(course.y[mid]), course.proj.lng(course.x[mid])],
    };
  });
}
