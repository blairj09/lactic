// The solo race report: a race that isn't laps (a point-to-point road race, a gran fondo, a long
// gravel race) and that may have nobody else to line up against. With no laps to compare, the
// rider's own file is cut into the pieces of the course (climbs, descents and the roads between),
// and the report reads how the day went from the rider's own numbers: pacing and fade over the race,
// power once tired (durability), the climbs in order, stops, and the stretches between them, which
// is where fueling happens. Any other timed files of the course (the rider's past editions, or other
// riders) are lined up along the route by position, so "km 150" means the same place for everyone.
// Every number is the engine's; the coach writes its debrief from this report. No browser or Node APIs.

import { normalizedPower } from "../power";
import type { Track } from "./track";

export interface SoloOther {
  id: string;
  name: string;
  track: Track;
  /** One of the rider's own earlier rides of this course (a past edition), not another rider. */
  past: boolean;
}

/** A named place on the course, e.g. a feed zone or a summit, at a distance from the start. */
export interface Place {
  name: string;
  km: number;
}

export interface SoloInput {
  own: Track;
  ftp: number | null;
  weightKg: number | null;
  others?: SoloOther[];
  places?: Place[];
  /** The rider's best power before the race (seconds → watts), the fresh mark durability is read against. */
  bestCurve?: Record<number, number> | null;
}

export type SoloKind = "climb" | "descent" | "flat";

export interface SoloSection {
  id: number;
  kind: SoloKind;
  /** "Climb 2", or the place at its top when one is named there ("Salt River Pass"); "Between" for the roads between. */
  label: string;
  /** Meters from the start. */
  from: number;
  to: number;
  gain: number;
  loss: number;
  /** Elevation at each end, meters. */
  eleFrom: number;
  eleTo: number;
  /** Average grade over the section, percent (climb: up, descent: down, so negative). */
  grade: number;
  /** Seconds from the start (elapsed clock) at each end. */
  startClock: number;
  elapsed: number;
  moving: number;
  /** Moving speed, m/s. */
  speed: number;
  watts: number | null;
  np: number | null;
  /** Average power as a share of FTP, percent. */
  pctFtp: number | null;
  wkg: number | null;
  hr: number | null;
  cadence: number | null;
  /** Climbs: meters climbed an hour. */
  vam: number | null;
  /** Work done before the section began, kJ: how tired you were arriving. */
  kjBefore: number;
}

export interface Stop {
  /** Meters from the start. */
  at: number;
  /** Elapsed clock when it began, seconds. */
  clock: number;
  seconds: number;
  /** The nearest named place within 3 km, if any. */
  place: string | null;
}

/** A stretch between stops: what you rode on whatever you carried. */
export interface Leg {
  from: number;
  to: number;
  moving: number;
  kj: number;
  watts: number | null;
  /** Names of the stops at each end, when named. */
  fromName: string;
  toName: string;
}

export interface Quarter {
  n: number;
  from: number;
  to: number;
  moving: number;
  watts: number | null;
  np: number | null;
  hr: number | null;
  speed: number;
  gain: number;
  /** Normalized power over heart rate. */
  ef: number | null;
}

export interface DurabilityBand {
  fromKj: number;
  toKj: number;
  /** Where on the course the band was ridden, meters. */
  from: number;
  to: number;
  best5: number | null;
  best20: number | null;
  /** Best 20 minutes as a share of the fresh mark, percent. */
  pct20: number | null;
  pct5: number | null;
}

export interface OtherSection {
  id: number;
  elapsed: number | null;
  /** Your elapsed time minus theirs: positive is time lost. */
  delta: number | null;
  watts: number | null;
}

export interface SoloComparison {
  id: string;
  name: string;
  past: boolean;
  /** Their date, from their file. */
  date: string | null;
  /** Share of your route they were matched on, 0–1: well under 1 is a different route. */
  coverage: number;
  elapsed: number | null;
  moving: number | null;
  stopped: number | null;
  np: number | null;
  watts: number | null;
  hr: number | null;
  /** Your elapsed time minus theirs at the finish (null when they didn't finish on your route). */
  finishGap: number | null;
  /** The last point of your route they rode, meters, and the gap there. */
  lastShared: number;
  lastGap: number | null;
  /** Through the race: x meters from the start, gap seconds you're behind. */
  gap: { x: number; gap: number }[];
  sections: OtherSection[];
  stops: number;
}

export interface SoloReport {
  meters: number;
  gain: number;
  /** Elevation every 500 m. */
  profile: number[];
  /** The route, thinned, for a map. */
  line: [number, number][];
  /** Power and heart rate every 5 km (averages over that stretch), for the chart. */
  trace: { x: number; watts: number | null; hr: number | null }[];
  elapsed: number;
  moving: number;
  stopped: number;
  ftp: number | null;
  weightKg: number | null;
  watts: number | null;
  np: number | null;
  intensity: number | null;
  stress: number | null;
  hr: number | null;
  kj: number | null;
  hasPower: boolean;
  hasHr: boolean;
  sections: SoloSection[];
  stops: Stop[];
  legs: Leg[];
  quarters: Quarter[];
  /** EF in the first half against the second, percent drop (positive is drift). */
  decoupling: number | null;
  durability: { fresh: { best5: number | null; best20: number | null; from: "before" | "race" } | null; bands: DurabilityBand[] };
  /** Power on the first hour against the whole race, as intensity factors. */
  firstHour: { np: number | null; intensity: number | null } | null;
  places: Place[];
  comparisons: SoloComparison[];
}

// ─── The ride, second by second ───────────────────────────────────────────────────────────────

const EARTH = 6371008.8;
const rad = (d: number) => (d * Math.PI) / 180;
export function haversine(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const a = Math.sin(rad(lat2 - lat1) / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(rad(lng2 - lng1) / 2) ** 2;
  return 2 * EARTH * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Longest gap between points that still counts as riding, seconds; longer is the device paused. */
const PAUSE = 6;
/** Slower than this over half a minute is stopped, m/s. */
const STOPPED_SPEED = 1;
/** Shortest stop worth listing, seconds. */
const MIN_STOP = 45;

export interface Series {
  t0: number;
  n: number;
  lat: Float64Array;
  lng: Float64Array;
  dist: Float64Array;
  ele: Float64Array;
  watts: Float64Array;
  hr: Float64Array;
  cad: Float64Array;
  /** Riding (not stopped or paused) at this second. */
  moving: Uint8Array;
  hasWatts: boolean;
  hasHr: boolean;
}

/** A timed track as one value a second from its first sustained movement, gaps (auto-pause) included. */
export function series(track: Track): Series {
  const pts = track.points.filter((p) => p.t !== null && Number.isFinite(p.lat) && Number.isFinite(p.lng));
  if (pts.length < 60) throw new Error("This ride file is too short for a race report");
  const cum = new Float64Array(pts.length);
  for (let i = 1; i < pts.length; i++) cum[i] = cum[i - 1] + haversine(pts[i - 1].lat, pts[i - 1].lng, pts[i].lat, pts[i].lng);
  // The first point from which the next 20 seconds cover 60 m.
  let first = 0;
  for (let i = 0, j = 0; i < pts.length; i++) {
    while (j < pts.length - 1 && (pts[j].t as number) - (pts[i].t as number) < 20) j++;
    if (cum[j] - cum[i] >= 60) {
      first = i;
      break;
    }
  }
  // And the last: standing about after the finish isn't the race.
  let last = pts.length - 1;
  for (let i = pts.length - 1, j = pts.length - 1; i > first; i--) {
    while (j > i && (pts[j].t as number) - (pts[i].t as number) > 20) j--;
    if (cum[j] - cum[i] >= 60) {
      last = j;
      break;
    }
  }
  pts.length = last + 1;
  const t0 = pts[first].t as number;
  const tEnd = pts[last].t as number;
  const n = Math.max(1, Math.floor(tEnd - t0) + 1);
  const s: Series = {
    t0,
    n,
    lat: new Float64Array(n),
    lng: new Float64Array(n),
    dist: new Float64Array(n),
    ele: new Float64Array(n).fill(NaN),
    watts: new Float64Array(n).fill(NaN),
    hr: new Float64Array(n).fill(NaN),
    cad: new Float64Array(n).fill(NaN),
    moving: new Uint8Array(n),
    hasWatts: pts.some((p) => p.watts !== null && p.watts > 0),
    hasHr: pts.some((p) => p.hr !== null && p.hr > 0),
  };
  const paused = new Uint8Array(n);
  let i = first;
  for (let k = 0; k < n; k++) {
    const t = t0 + k;
    while (i < pts.length - 2 && (pts[i + 1].t as number) <= t) i++;
    const a = pts[i];
    const b = pts[Math.min(i + 1, pts.length - 1)];
    const ta = a.t as number;
    const tb = b.t as number;
    const f = tb > ta ? Math.min(1, Math.max(0, (t - ta) / (tb - ta))) : 0;
    s.lat[k] = a.lat + f * (b.lat - a.lat);
    s.lng[k] = a.lng + f * (b.lng - a.lng);
    s.dist[k] = cum[i] + f * (cum[Math.min(i + 1, pts.length - 1)] - cum[i]) - cum[first];
    if (a.ele !== null) s.ele[k] = b.ele !== null ? a.ele + f * (b.ele - a.ele) : a.ele;
    const gap = tb - ta > PAUSE;
    if (gap) paused[k] = 1;
    else {
      if (a.watts !== null) s.watts[k] = a.watts;
      if (a.hr !== null && a.hr > 0) s.hr[k] = a.hr;
      if (a.cadence !== null) s.cad[k] = a.cadence;
    }
  }
  // Stopped: paused, or under 1 m/s over the few seconds around it.
  for (let k = 0; k < n; k++) {
    const a = Math.max(0, k - 3);
    const b = Math.min(n - 1, k + 3);
    const v = b > a ? (s.dist[b] - s.dist[a]) / (b - a) : 0;
    s.moving[k] = paused[k] || v < STOPPED_SPEED ? 0 : 1;
  }
  return s;
}

/** Stops: runs of stopped seconds, merged when you rolled under 150 m between them. */
function findStops(s: Series): { from: number; to: number }[] {
  const runs: { from: number; to: number }[] = [];
  let k = 0;
  while (k < s.n) {
    if (s.moving[k]) {
      k++;
      continue;
    }
    const from = k;
    while (k < s.n && !s.moving[k]) k++;
    runs.push({ from, to: k });
  }
  const merged: { from: number; to: number }[] = [];
  for (const r of runs) {
    const last = merged[merged.length - 1];
    if (last && r.from - last.to < 120 && s.dist[r.from] - s.dist[last.to - 1] < 150) last.to = r.to;
    else merged.push({ ...r });
  }
  return merged.filter((r) => r.to - r.from >= MIN_STOP);
}

/** First second at or past a distance. */
function secondAt(s: Series, meters: number): number {
  let lo = 0;
  let hi = s.n - 1;
  if (s.dist[hi] < meters) return hi;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (s.dist[mid] < meters) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

interface Totals {
  moving: number;
  watts: number | null;
  np: number | null;
  hr: number | null;
  cadence: number | null;
  kj: number;
}

/** Moving seconds from a to b (exclusive): power counts coasting as zero; stopped time is left out. */
function totals(s: Series, a: number, b: number): Totals {
  const w: number[] = [];
  let hr = 0;
  let hrN = 0;
  let cad = 0;
  let cadN = 0;
  let moving = 0;
  for (let k = a; k < b; k++) {
    if (!s.moving[k]) continue;
    moving++;
    w.push(Number.isNaN(s.watts[k]) ? 0 : s.watts[k]);
    if (!Number.isNaN(s.hr[k])) {
      hr += s.hr[k];
      hrN++;
    }
    if (s.cad[k] > 0) {
      cad += s.cad[k];
      cadN++;
    }
  }
  const sum = w.reduce((x, y) => x + y, 0);
  return {
    moving,
    watts: s.hasWatts && moving ? Math.round(sum / moving) : null,
    np: s.hasWatts && w.length >= 30 ? Math.round(normalizedPower(w) as number) : null,
    hr: hrN ? Math.round(hr / hrN) : null,
    cadence: cadN ? Math.round(cad / cadN) : null,
    kj: s.hasWatts ? sum / 1000 : 0,
  };
}

// ─── The course ───────────────────────────────────────────────────────────────────────────────

const STEP = 100;

/** Elevation every 100 m, smoothed over ±200 m so GPS and barometer noise don't make climbs. */
function grid(s: Series): Float64Array {
  const meters = s.dist[s.n - 1];
  const count = Math.floor(meters / STEP) + 1;
  const raw = new Float64Array(count).fill(NaN);
  const sum = new Float64Array(count);
  const num = new Float64Array(count);
  for (let k = 0; k < s.n; k++) {
    if (Number.isNaN(s.ele[k])) continue;
    const g = Math.min(count - 1, Math.round(s.dist[k] / STEP));
    sum[g] += s.ele[k];
    num[g]++;
  }
  for (let g = 0; g < count; g++) if (num[g]) raw[g] = sum[g] / num[g];
  // Fill holes from the neighbors.
  let last = NaN;
  for (let g = 0; g < count; g++) {
    if (Number.isNaN(raw[g])) raw[g] = last;
    else last = raw[g];
  }
  const firstKnown = raw.findIndex((v) => !Number.isNaN(v));
  if (firstKnown < 0) return new Float64Array(count);
  for (let g = 0; g < firstKnown; g++) raw[g] = raw[firstKnown];
  const out = new Float64Array(count);
  for (let g = 0; g < count; g++) {
    let a = 0;
    let c = 0;
    for (let h = Math.max(0, g - 2); h <= Math.min(count - 1, g + 2); h++) {
      a += raw[h];
      c++;
    }
    out[g] = a / c;
  }
  return out;
}

/** Sustained rises in an elevation grid: [from, to] grid indices, at least `minGain` m at `minGrade`. */
export function rises(E: Float64Array, minGain = 100, minGrade = 0.015): [number, number][] {
  const out: [number, number][] = [];
  const n = E.length;
  let start = 0;
  let peak = 0;
  const close = (a: number, b: number) => {
    // Trim flat run-ins and run-outs: the climb starts where it climbs.
    const win = 10;
    const g = (x: number, y: number) => (E[y] - E[x]) / ((y - x) * STEP);
    while (b - a > win && g(a, a + win) < minGrade * 0.75) a++;
    while (b - a > win && g(b - win, b) < minGrade * 0.75) b--;
    const gain = E[b] - E[a];
    if (gain >= minGain && gain / ((b - a) * STEP) >= minGrade) out.push([a, b]);
  };
  for (let k = 1; k < n; k++) {
    if (E[k] >= E[peak]) peak = k;
    if (peak === start && E[k] < E[start]) {
      start = peak = k;
      continue;
    }
    const gain = E[peak] - E[start];
    const tolerance = Math.max(25, 0.15 * gain);
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

function nearestPlace(places: Place[], meters: number, within = 3000): Place | null {
  let best: Place | null = null;
  for (const p of places) if (Math.abs(p.km * 1000 - meters) <= within && (!best || Math.abs(p.km * 1000 - meters) < Math.abs(best.km * 1000 - meters))) best = p;
  return best;
}

function courseSections(E: Float64Array): { kind: SoloKind; from: number; to: number }[] {
  const n = E.length;
  const up = rises(E);
  const neg = Float64Array.from(E, (v) => -v);
  const down = rises(neg).filter(([a, b]) => !up.some(([c, d]) => a < d && b > c));
  const marked = [...up.map(([a, b]) => ({ kind: "climb" as SoloKind, from: a, to: b })), ...down.map(([a, b]) => ({ kind: "descent" as SoloKind, from: a, to: b }))].sort((x, y) => x.from - y.from);
  const out: { kind: SoloKind; from: number; to: number }[] = [];
  let at = 0;
  for (const m of marked) {
    if (m.from < at) m.from = at;
    if (m.to <= m.from) continue;
    if (m.from - at >= 10) out.push({ kind: "flat", from: at, to: m.from });
    else if (out.length) out[out.length - 1].to = m.from;
    else m.from = 0;
    out.push(m);
    at = m.to;
  }
  if (n - 1 - at >= 10 || !out.length) out.push({ kind: "flat", from: at, to: n - 1 });
  else out[out.length - 1].to = n - 1;
  // Long roads between climbs in even pieces of up to 40 km, so a comparison can say where.
  return out.flatMap((sec) => {
    const len = sec.to - sec.from;
    if (sec.kind !== "flat" || len <= 400) return [sec];
    const pieces = Math.ceil(len / 400);
    return Array.from({ length: pieces }, (_, i) => ({ kind: "flat" as SoloKind, from: sec.from + Math.round((i * len) / pieces), to: sec.from + Math.round(((i + 1) * len) / pieces) }));
  });
}

// ─── Lining up another file of the course ────────────────────────────────────────────────────

/** For each grid point of your route, the second their series passed it (NaN where they didn't). */
function alignTo(own: Series, ownSeconds: Int32Array, other: Series): Float64Array {
  const out = new Float64Array(ownSeconds.length).fill(NaN);
  let j = 0;
  const cosLat = Math.cos(rad(own.lat[0]));
  const d2 = (k: number, i: number) => {
    const dy = (own.lat[k] - other.lat[i]) * 111_195;
    const dx = (own.lng[k] - other.lng[i]) * 111_195 * cosLat;
    return dx * dx + dy * dy;
  };
  for (let g = 0; g < ownSeconds.length; g++) {
    const k = ownSeconds[g];
    let best = -1;
    let bestD = 80 * 80;
    // Look ahead along their ride for the next 3 km.
    const limit = other.dist[j] + 3000;
    for (let i = j; i < other.n && other.dist[i] <= limit; i++) {
      const d = d2(k, i);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    if (best >= 0) {
      out[g] = best;
      j = best;
    }
  }
  return out;
}

function compareOther(o: SoloOther, own: Series, ownGridSeconds: Int32Array, sections: SoloSection[], ownElapsed: number): SoloComparison {
  const them = series(o.track);
  const at = alignTo(own, ownGridSeconds, them);
  const matched = at.filter((v) => !Number.isNaN(v)).length;
  const coverage = matched / at.length;
  const gap: { x: number; gap: number }[] = [];
  for (let g = 0; g < at.length; g += 10) if (!Number.isNaN(at[g])) gap.push({ x: g * STEP, gap: Math.round(ownGridSeconds[g] - at[g]) });
  const lastG = at.length - 1;
  let end = lastG;
  while (end > 0 && Number.isNaN(at[end])) end--;
  const finishedWithYou = lastG - end <= 20;
  const elapsed = finishedWithYou ? at[end] : null;
  const whole = totals(them, 0, them.n);
  const stops = findStops(them);
  const stopped = stops.reduce((a, r) => a + r.to - r.from, 0);
  // Their second at a grid point, or at the nearest one they were matched on within 1 km.
  const near = (g: number) => {
    for (let d = 0; d <= 10; d++) {
      if (g - d >= 0 && !Number.isNaN(at[g - d])) return at[g - d];
      if (g + d <= lastG && !Number.isNaN(at[g + d])) return at[g + d];
    }
    return NaN;
  };
  const secs: OtherSection[] = sections.map((s) => {
    const a = near(Math.round(s.from / STEP));
    const b = near(Math.min(lastG, Math.round(s.to / STEP)));
    if (Number.isNaN(a) || Number.isNaN(b) || b <= a) return { id: s.id, elapsed: null, delta: null, watts: null };
    const t = totals(them, a, b);
    const e = b - a;
    return { id: s.id, elapsed: e, delta: s.elapsed - e, watts: t.watts };
  });
  const first = o.track.points.find((p) => p.t !== null)?.t ?? null;
  return {
    id: o.id,
    name: o.name,
    past: o.past,
    date: first === null ? null : new Date(first * 1000).toISOString().slice(0, 10),
    coverage: Math.round(coverage * 100) / 100,
    elapsed,
    moving: whole.moving,
    stopped,
    np: whole.np,
    watts: whole.watts,
    hr: whole.hr,
    finishGap: elapsed === null ? null : Math.round(ownElapsed - elapsed),
    lastShared: end * STEP,
    lastGap: Number.isNaN(at[end]) ? null : Math.round(ownGridSeconds[end] - at[end]),
    gap,
    sections: secs,
    stops: stops.length,
  };
}

// ─── The report ──────────────────────────────────────────────────────────────────────────────

/** Best average power over `d` seconds among windows that start at seconds in [a, b) of moving power. */
function bestIn(w: Float64Array, a: number, b: number, d: number): number | null {
  if (b - a < d * 0.5 || w.length < d) return null;
  let sum = 0;
  let best = 0;
  const lo = Math.max(0, Math.min(a, w.length - d));
  for (let k = lo; k < lo + d; k++) sum += w[k];
  best = sum;
  for (let k = lo + 1; k < Math.min(b, w.length - d + 1); k++) {
    sum += w[k + d - 1] - w[k - 1];
    if (sum > best) best = sum;
  }
  return Math.round(best / d);
}

/** Does a ride go round laps? A finish more than 1 km from the start can't. */
export function isPointToPoint(track: Track): boolean {
  const p = track.points;
  if (p.length < 2) return false;
  return haversine(p[0].lat, p[0].lng, p[p.length - 1].lat, p[p.length - 1].lng) > 1000;
}

/** Named places, one per line: "Preston 55" or "55 Preston" (km from the start). */
export function parsePlaces(text: string): Place[] {
  const out: Place[] = [];
  for (const line of text.split(/\r?\n/)) {
    const m = line.trim().match(/^(?:(\d+(?:\.\d+)?)\s*(?:km)?\s+(.+)|(.+?)\s+(\d+(?:\.\d+)?)\s*(?:km)?)$/i);
    if (!m) continue;
    const km = Number(m[1] ?? m[4]);
    const name = (m[2] ?? m[3]).replace(/[,:–-]+$/, "").trim();
    if (name && Number.isFinite(km)) out.push({ name: name.slice(0, 60), km });
  }
  return out.sort((a, b) => a.km - b.km);
}

export function soloReport(input: SoloInput): SoloReport {
  const s = series(input.own);
  const ftp = input.ftp && input.ftp > 0 ? input.ftp : null;
  const weight = input.weightKg && input.weightKg > 0 ? input.weightKg : null;
  const places = input.places ?? [];
  const meters = Math.round(s.dist[s.n - 1]);
  const E = grid(s);
  const G = E.length;
  const gridSeconds = new Int32Array(G);
  for (let g = 0; g < G; g++) gridSeconds[g] = secondAt(s, g * STEP);

  // Cumulative work over the race, kJ, at each second.
  const kjAt = new Float64Array(s.n + 1);
  for (let k = 0; k < s.n; k++) kjAt[k + 1] = kjAt[k] + (s.moving[k] && !Number.isNaN(s.watts[k]) ? s.watts[k] / 1000 : 0);

  let gain = 0;
  for (let g = 1; g < G; g++) if (E[g] > E[g - 1]) gain += E[g] - E[g - 1];

  const counts: Record<SoloKind, number> = { climb: 0, descent: 0, flat: 0 };
  const sections: SoloSection[] = courseSections(E).map((c, id) => {
    const from = c.from * STEP;
    const to = Math.min(meters, c.to * STEP);
    const a = gridSeconds[c.from];
    const b = gridSeconds[Math.min(G - 1, c.to)];
    const t = totals(s, a, b);
    let up = 0;
    let down = 0;
    for (let g = c.from + 1; g <= c.to; g++) {
      const d = E[g] - E[g - 1];
      if (d > 0) up += d;
      else down -= d;
    }
    counts[c.kind]++;
    const name = c.kind === "climb" ? nearestPlace(places, to) : null;
    const base = c.kind === "climb" ? `Climb ${counts.climb}` : c.kind === "descent" ? `Descent ${counts.descent}` : "Between";
    // Roads between climbs are named by where they are (the screen writes that in the rider's units).
    const label = c.kind === "flat" ? "Between" : name ? name.name : base;
    const grade = to > from ? ((E[c.to] - E[c.from]) / (to - from)) * 100 : 0;
    return {
      id,
      kind: c.kind,
      label,
      from,
      to,
      gain: Math.round(up),
      loss: Math.round(down),
      eleFrom: Math.round(E[c.from]),
      eleTo: Math.round(E[c.to]),
      grade: Math.round(grade * 10) / 10,
      startClock: a,
      elapsed: b - a,
      moving: t.moving,
      speed: t.moving ? Math.round(((to - from) / t.moving) * 100) / 100 : 0,
      watts: t.watts,
      np: t.np,
      pctFtp: ftp && t.watts !== null ? Math.round((t.watts / ftp) * 100) : null,
      wkg: weight && t.watts !== null ? Math.round((t.watts / weight) * 100) / 100 : null,
      hr: t.hr,
      cadence: t.cadence,
      vam: c.kind === "climb" && t.moving ? Math.round((up / t.moving) * 3600) : null,
      kjBefore: Math.round(kjAt[a]),
    };
  });

  // Stops, and the legs between them.
  const stopRuns = findStops(s);
  const stops: Stop[] = stopRuns.map((r) => ({ at: Math.round(s.dist[r.from]), clock: r.from, seconds: r.to - r.from, place: nearestPlace(places, s.dist[r.from])?.name ?? null }));
  const stopName = (st: Stop) => st.place ?? `Stop at km ${Math.round(st.at / 1000)}`;
  const legs: Leg[] = [];
  let legStart = 0;
  let legFromName = "Start";
  for (let i = 0; i <= stopRuns.length; i++) {
    const end = i < stopRuns.length ? stopRuns[i].from : s.n;
    const t = totals(s, legStart, end);
    if (t.moving >= 600) legs.push({ from: Math.round(s.dist[legStart]), to: Math.round(s.dist[Math.max(0, end - 1)]), moving: t.moving, kj: Math.round(t.kj), watts: t.watts, fromName: legFromName, toName: i < stopRuns.length ? stopName(stops[i]) : "Finish" });
    if (i < stopRuns.length) {
      legStart = stopRuns[i].to;
      legFromName = stopName(stops[i]);
    }
  }

  // The moving seconds in order: quarters, halves, the first hour and durability are read on these.
  const movingIdx: number[] = [];
  for (let k = 0; k < s.n; k++) if (s.moving[k]) movingIdx.push(k);
  const M = movingIdx.length;
  const mw = Float64Array.from(movingIdx, (k) => (Number.isNaN(s.watts[k]) ? 0 : s.watts[k]));
  const whole = totals(s, 0, s.n);

  const quarters: Quarter[] = [0, 1, 2, 3].map((q) => {
    const a = movingIdx[Math.floor((q * M) / 4)] ?? 0;
    const b = q === 3 ? s.n : (movingIdx[Math.floor(((q + 1) * M) / 4)] ?? s.n);
    const t = totals(s, a, b);
    let up = 0;
    const ga = Math.round(s.dist[a] / STEP);
    const gb = Math.round(s.dist[Math.max(a, b - 1)] / STEP);
    for (let g = ga + 1; g <= Math.min(G - 1, gb); g++) if (E[g] > E[g - 1]) up += E[g] - E[g - 1];
    return {
      n: q + 1,
      from: Math.round(s.dist[a]),
      to: Math.round(s.dist[Math.max(a, b - 1)]),
      moving: t.moving,
      watts: t.watts,
      np: t.np,
      hr: t.hr,
      speed: t.moving ? Math.round(((s.dist[Math.max(a, b - 1)] - s.dist[a]) / t.moving) * 100) / 100 : 0,
      gain: Math.round(up),
      ef: t.np !== null && t.hr ? Math.round((t.np / t.hr) * 100) / 100 : null,
    };
  });
  const half = (h: 0 | 1) => totals(s, h === 0 ? 0 : (movingIdx[Math.floor(M / 2)] ?? 0), h === 0 ? (movingIdx[Math.floor(M / 2)] ?? s.n) : s.n);
  const h1 = half(0);
  const h2 = half(1);
  const ef1 = h1.np !== null && h1.hr ? h1.np / h1.hr : null;
  const ef2 = h2.np !== null && h2.hr ? h2.np / h2.hr : null;
  const decoupling = ef1 && ef2 ? Math.round(((ef1 - ef2) / ef1) * 1000) / 10 : null;

  let firstHour: SoloReport["firstHour"] = null;
  if (s.hasWatts && M > 3 * 3600) {
    const fh = normalizedPower(Array.from(mw.subarray(0, 3600)));
    firstHour = { np: fh === null ? null : Math.round(fh), intensity: fh !== null && ftp ? Math.round((fh / ftp) * 100) / 100 : null };
  }

  // Durability: your best 5 and 20 minutes in each 1,000 kJ of work, against your fresh best.
  const bands: DurabilityBand[] = [];
  let fresh: SoloReport["durability"]["fresh"] = null;
  if (s.hasWatts) {
    const kjMoving = new Float64Array(M + 1);
    for (let i = 0; i < M; i++) kjMoving[i + 1] = kjMoving[i] + mw[i] / 1000;
    const total = kjMoving[M];
    const before = input.bestCurve ?? null;
    if (before && (before[300] || before[1200])) fresh = { best5: before[300] ? Math.round(before[300]) : null, best20: before[1200] ? Math.round(before[1200]) : null, from: "before" };
    for (let lo = 0; lo < total; lo += 1000) {
      const a = kjMoving.findIndex((v) => v >= lo);
      let b = kjMoving.findIndex((v) => v >= lo + 1000);
      if (b < 0) b = M;
      if (b - a < 600) continue;
      bands.push({
        fromKj: lo,
        toKj: Math.min(Math.round(total), lo + 1000),
        from: Math.round(s.dist[movingIdx[a]] ?? 0),
        to: Math.round(s.dist[movingIdx[Math.min(M - 1, b - 1)]] ?? meters),
        best5: bestIn(mw, a, b, 300),
        best20: bestIn(mw, a, b, 1200),
        pct20: null,
        pct5: null,
      });
    }
    // The race itself can beat what training showed: take whichever is higher.
    const race5 = Math.max(0, ...bands.map((b) => b.best5 ?? 0));
    const race20 = Math.max(0, ...bands.map((b) => b.best20 ?? 0));
    if (!fresh || (fresh.best20 ?? 0) < race20) fresh = bands.length ? { best5: Math.max(race5, fresh?.best5 ?? 0) || null, best20: race20 || null, from: "race" } : fresh;
    for (const b of bands) {
      b.pct5 = fresh?.best5 && b.best5 !== null ? Math.round((b.best5 / fresh.best5) * 100) : null;
      b.pct20 = fresh?.best20 && b.best20 !== null ? Math.round((b.best20 / fresh.best20) * 100) : null;
    }
  }

  // The chart's traces, every 5 km.
  const trace: SoloReport["trace"] = [];
  for (let x = 0; x < meters; x += 5000) {
    const t = totals(s, secondAt(s, x), secondAt(s, Math.min(meters, x + 5000)));
    trace.push({ x: Math.min(meters, x + 2500), watts: t.watts, hr: t.hr });
  }
  const line: [number, number][] = [];
  for (let g = 0; g < G; g += 5) {
    const k = gridSeconds[g];
    line.push([Math.round(s.lat[k] * 1e5) / 1e5, Math.round(s.lng[k] * 1e5) / 1e5]);
  }
  const profile: number[] = [];
  for (let g = 0; g < G; g += 5) profile.push(Math.round(E[g]));

  const elapsed = s.n;
  const comparisons = (input.others ?? []).map((o) => compareOther(o, s, gridSeconds, sections, elapsed));
  const intensity = whole.np !== null && ftp ? Math.round((whole.np / ftp) * 100) / 100 : null;
  return {
    meters,
    gain: Math.round(gain),
    profile,
    line,
    trace,
    elapsed,
    moving: M,
    stopped: elapsed - M,
    ftp,
    weightKg: weight,
    watts: whole.watts,
    np: whole.np,
    intensity,
    stress: intensity !== null ? Math.round(((M * (whole.np as number) * intensity) / ((ftp as number) * 3600)) * 100) : null,
    hr: whole.hr,
    kj: s.hasWatts ? Math.round(whole.kj) : null,
    hasPower: s.hasWatts,
    hasHr: s.hasHr,
    sections,
    stops,
    legs,
    quarters,
    decoupling,
    durability: { fresh, bands },
    firstHour,
    places,
    comparisons,
  };
}
