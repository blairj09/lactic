// The race report: the rider's race against other riders (and their own best lap), section by
// section and lap by lap, with where time went and what to work on. Every number here is the
// engine's; the coach writes the debrief from this report and never works numbers out itself.

import { clockFromLaps, crossings, fitCourse, lapsOf, MIN_LAP_SECONDS, motionStart, project, type Course, type Laps, type Projected } from "./course";
import { findRow, type ResultRow } from "./results";
import { lapElevation, lapSections, speedAt, typicalSpeed, type Section, type SectionKind } from "./sections";
import { isTimed, type Track } from "./track";

export interface RivalInput {
  id: string;
  /** The rider's name, as the rider typed it or from the file. */
  name: string;
  track: Track;
}

export interface RaceInput {
  own: Track;
  ownName?: string | null;
  rivals: RivalInput[];
  results?: ResultRow[] | null;
}

/** How a rider's times were found. */
export type Timing = "recorded" | "results" | "estimated";

export interface LapRow {
  lap: number;
  own: number | null;
  rival: number | null;
  /** Your time minus theirs: positive is time lost. */
  delta: number | null;
}

export interface SectionSpeeds {
  entry: number;
  min: number;
  exit: number;
  avg: number;
}

export interface SectionRow {
  id: number;
  /** Your time minus theirs on each lap, seconds; null where either isn't known. */
  perLap: (number | null)[];
  /** Over the laps compared, leaving out one-off losses (see incidents). */
  total: number;
  /** One-off losses included. */
  totalAll: number;
  lapsCompared: number;
  /** Typical (median) speeds over the laps compared, m/s. */
  own: SectionSpeeds | null;
  rival: SectionSpeeds | null;
}

export interface Incident {
  lap: number;
  section: number;
  seconds: number;
  /** What the section usually cost on the other laps. */
  usual: number;
}

export interface KindTotal {
  kind: SectionKind;
  seconds: number;
  perLap: number;
  meters: number;
}

export interface Comparison {
  id: string;
  name: string;
  timing: Timing;
  place: number | null;
  /** Their race time, seconds, from results or their file. */
  total: number | null;
  /** Your time minus theirs at the finish. */
  finishGap: number | null;
  laps: LapRow[];
  sections: SectionRow[];
  kinds: KindTotal[];
  incidents: Incident[];
  /** The gap through the race: x is meters from the start of lap 1, gap is seconds you're behind. */
  gap: { x: number; gap: number }[];
  /** Their route over the lap, matched or not, for the map. */
  route: [number, number][];
}

export interface OwnLap {
  lap: number;
  seconds: number | null;
  /** From the official results, when they have this lap. */
  official: boolean;
  avgHr: number | null;
  maxHr: number | null;
  avgWatts: number | null;
}

export interface FieldLap {
  lap: number;
  /** Your place among the lap times in the results. */
  rank: number;
  of: number;
  fastest: number;
  fastestName: string;
  own: number;
}

export interface RaceReport {
  lapMeters: number;
  lapCount: number;
  gate: [number, number];
  /** The lap's line, every few meters, for the map. */
  line: [number, number][];
  /** Elevation along the lap (every 10 m), meters; null when the file has none. */
  profile: number[] | null;
  sections: Section[];
  own: {
    name: string;
    place: number | null;
    total: number | null;
    laps: OwnLap[];
    hasPower: boolean;
    hasHr: boolean;
    /** Average power and heart rate by kind of section, over all laps. */
    byKind: { kind: SectionKind; watts: number | null; hr: number | null; speed: number }[];
  };
  field: { riders: number; laps: FieldLap[] } | null;
  comparisons: Comparison[];
}

export const BEST_LAP_ID = "best-lap";

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
function median(xs: number[]): number {
  const v = xs.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return NaN;
  const h = Math.floor(v.length / 2);
  return v.length % 2 ? v[h] : (v[h - 1] + v[h]) / 2;
}
const r1 = (x: number) => Math.round(x * 10) / 10;
const r2 = (x: number) => Math.round(x * 100) / 100;

function speeds(at: Float64Array, s: Section): SectionSpeeds | null {
  const v = speedAt(at, 4);
  const a = Math.min(s.to, s.from + 3);
  const b = Math.max(s.from, s.to - 3);
  let min = Infinity;
  for (let m = s.from; m <= s.to; m++) if (v[m] < min) min = v[m];
  const dt = at[s.to] - at[s.from];
  if (!Number.isFinite(min) || !(dt > 0) || Number.isNaN(v[a]) || Number.isNaN(v[b])) return null;
  return { entry: v[a], min, exit: v[b], avg: (s.to - s.from) / dt };
}

function medianSpeeds(list: (SectionSpeeds | null)[]): SectionSpeeds | null {
  const ok = list.filter((x): x is SectionSpeeds => x !== null);
  if (!ok.length) return null;
  return {
    entry: r2(median(ok.map((x) => x.entry))),
    min: r2(median(ok.map((x) => x.min))),
    exit: r2(median(ok.map((x) => x.exit))),
    avg: r2(median(ok.map((x) => x.avg))),
  };
}

/** Where a rival's laps are, with their clock: from their results row, their file's times, or one point a second. */
function rivalLaps(p: Projected, course: Course, lapCount: number, ownGunAbs: number, row: ResultRow | null): { laps: Laps; timing: Timing } {
  const start = motionStart(p);
  const all = crossings(p, course.gate);
  const startT = p.t[start];
  const ends = all.filter((c) => c.at > startT + MIN_LAP_SECONDS);
  // A file that starts on the grid (just behind the line) starts lap 1 at the gun; one started late doesn't.
  const startCrossing = all.find((c) => c.at >= startT && c.at <= startT + MIN_LAP_SECONDS);
  const onGrid = Boolean(startCrossing) || Math.hypot(p.x[start] - course.x[0], p.y[start] - course.y[0]) < 30;
  if (row && row.laps.length) {
    const clock = clockFromLaps(ends, row.laps);
    // A file that starts on the grid: lap 1 starts at its first sustained movement.
    return { laps: lapsOf(p, course, ends, row.laps.length, clock, start, onGrid && p.timed), timing: "results" };
  }
  if (p.timed) {
    // Same start (a mass start, clocks within two minutes): one clock for both. Otherwise, their own gun.
    const gun = Math.abs(startT - ownGunAbs) < 120 ? ownGunAbs : startT;
    return { laps: lapsOf(p, course, ends, lapCount, (t) => t - gun, start, onGrid), timing: "recorded" };
  }
  return { laps: lapsOf(p, course, ends, lapCount, (t) => t - start, start, onGrid), timing: "estimated" };
}

/** Your own fastest lap, ridden every lap from the gun: where each lap lost time against your best. */
function bestLapGhost(own: Laps, length: number): { laps: Laps; best: number } {
  let best = -1;
  own.at.forEach((a, k) => {
    if (k === 0 || Number.isNaN(a[0]) || Number.isNaN(a[length])) return;
    if (best < 0 || a[length] - a[0] < own.at[best][length] - own.at[best][0]) best = k;
  });
  if (best < 0) best = 0;
  const ref = own.at[best];
  const lap = ref[length] - ref[0];
  // Back to back from the gun, so the gap to it builds up over the race.
  const at = own.at.map((_, k) => {
    const out = new Float64Array(length + 1);
    for (let m = 0; m <= length; m++) out[m] = k * lap + (ref[m] - ref[0]);
    return out;
  });
  return { laps: { ...own, at, seconds: at.map((a) => a[length] - a[0]) }, best };
}

function compare(id: string, name: string, timing: Timing, row: ResultRow | null, own: Laps, rival: Laps, ownRow: ResultRow | null, sections: Section[], length: number, route: [number, number][]): Comparison {
  const lapCount = own.at.length;
  const sectionRows: SectionRow[] = sections.map((s) => {
    const perLap: (number | null)[] = [];
    const ownSp: (SectionSpeeds | null)[] = [];
    const rivalSp: (SectionSpeeds | null)[] = [];
    for (let k = 0; k < lapCount; k++) {
      const o = own.at[k];
      const r = rival.at[k];
      if (!r) {
        perLap.push(null);
        continue;
      }
      const od = o[s.to] - o[s.from];
      const rd = r[s.to] - r[s.from];
      if (!Number.isFinite(od) || !Number.isFinite(rd)) {
        perLap.push(null);
        continue;
      }
      perLap.push(r1(od - rd));
      // Lap 1's first section has the start in it: leave it out of the speeds.
      if (k === 0 && s.from === 0) continue;
      ownSp.push(speeds(o, s));
      rivalSp.push(speeds(r, s));
    }
    const known = perLap.filter((d): d is number => d !== null);
    return { id: s.id, perLap, total: 0, totalAll: r1(known.reduce((a, b) => a + b, 0)), lapsCompared: known.length, own: medianSpeeds(ownSp), rival: medianSpeeds(rivalSp) };
  });

  // One-off losses: a lap that cost far more there than the others did (a crash, a dismount, a bad line).
  const incidents: Incident[] = [];
  for (const row of sectionRows) {
    const known = row.perLap.map((d, k) => ({ d, k })).filter((x): x is { d: number; k: number } => x.d !== null);
    let total = 0;
    for (const { d, k } of known) {
      const others = known.filter((x) => x.k !== k).map((x) => x.d);
      const usual = others.length ? median(others) : 0;
      if (others.length >= 2 && d >= 5 && d - usual >= 4 && d >= 3 * Math.max(1, usual)) incidents.push({ lap: k + 1, section: row.id, seconds: r1(d), usual: r1(usual) });
      else total += d;
    }
    row.total = r1(total);
  }
  incidents.sort((a, b) => b.seconds - a.seconds);

  const kinds = (["corner", "straight", "climb", "descent", "slow"] as SectionKind[]).flatMap((kind) => {
    const rows = sectionRows.filter((r) => sections[r.id].kind === kind);
    if (!rows.length) return [];
    const seconds = rows.reduce((a, r) => a + r.total, 0);
    const laps = Math.max(1, ...rows.map((r) => r.lapsCompared));
    return [{ kind, seconds: r1(seconds), perLap: r1(seconds / laps), meters: rows.reduce((a, r) => a + sections[r.id].to - sections[r.id].from, 0) }];
  });

  const laps: LapRow[] = own.at.map((_, k) => {
    const o = ownRow?.laps[k] ?? own.seconds[k];
    const r = row?.laps[k] ?? rival.seconds[k] ?? null;
    return { lap: k + 1, own: o ?? null, rival: r, delta: o != null && r != null ? r1(o - r) : null };
  });

  const gap: { x: number; gap: number }[] = [];
  for (let k = 0; k < lapCount; k++) {
    for (let m = 0; m <= length; m += 10) {
      const g = own.at[k][m] - (rival.at[k]?.[m] ?? NaN);
      if (Number.isFinite(g)) gap.push({ x: k * length + m, gap: r1(g) });
    }
  }
  const ownTotal = ownRow?.total ?? null;
  const total = row?.total ?? (rival.seconds.every((s) => s !== null) ? r1((rival.seconds as number[]).reduce((a, b) => a + b, 0)) : null);
  const finishGap = ownTotal !== null && total !== null ? r1(ownTotal - total) : laps.every((l) => l.delta !== null) ? r1(laps.reduce((a, l) => a + (l.delta as number), 0)) : (gap[gap.length - 1]?.gap ?? null);

  return { id, name, timing, place: row?.place ?? null, total, finishGap, laps, sections: sectionRows, kinds, incidents, gap, route };
}

function thinLine(course: Course, every: number): [number, number][] {
  const out: [number, number][] = [];
  for (let m = 0; m <= course.length; m += every) out.push([r6(course.proj.lat(course.y[m])), r6(course.proj.lng(course.x[m]))]);
  return out;
}
const r6 = (x: number) => Math.round(x * 1e6) / 1e6;

export function raceReport(input: RaceInput): RaceReport {
  const results = input.results?.length ? input.results : null;
  const ownRow = results ? findRow(results, input.ownName) : null;
  const fit = fitCourse(input.own, ownRow?.laps.length ? ownRow.laps : null);
  const { course, own: ownP, gun } = fit;
  const L = course.length;
  const lapCount = ownRow?.laps.length || fit.lapEnds.length;
  const start = motionStart(ownP);
  const ownLapsAt = lapsOf(ownP, course, fit.lapEnds, lapCount, (t) => t - gun, start, true);

  const ele = lapElevation(ownP, ownLapsAt, L);
  const sections = lapSections(course, ele, typicalSpeed(ownLapsAt, L));
  const sectionAt = new Int16Array(L + 1);
  for (const s of sections) for (let m = s.from; m <= s.to; m++) sectionAt[m] = s.id;

  // Your laps, with heart rate and power from your file.
  const pts = input.own.points;
  const ownLaps: OwnLap[] = ownLapsAt.at.map((_, k) => {
    const idx = pts.map((_, i) => i).filter((i) => ownLapsAt.pointLap[i] === k);
    const hr = idx.map((i) => pts[i].hr).filter((v): v is number => v !== null);
    const w = idx.map((i) => pts[i].watts).filter((v): v is number => v !== null);
    const official = ownRow?.laps[k];
    return {
      lap: k + 1,
      seconds: official ?? (ownLapsAt.seconds[k] === null ? null : r1(ownLapsAt.seconds[k] as number)),
      official: official !== undefined,
      avgHr: hr.length ? Math.round(mean(hr)) : null,
      maxHr: hr.length ? Math.max(...hr) : null,
      avgWatts: w.length ? Math.round(mean(w)) : null,
    };
  });
  const hasPower = pts.some((p) => p.watts !== null && p.watts > 0);
  const hasHr = pts.some((p) => p.hr !== null);
  const byKind = (["corner", "straight", "climb", "descent", "slow"] as SectionKind[]).flatMap((kind) => {
    const ids = new Set(sections.filter((s) => s.kind === kind).map((s) => s.id));
    if (!ids.size) return [];
    const idx = pts.map((_, i) => i).filter((i) => ownLapsAt.pointLap[i] >= 0 && ids.has(sectionAt[Math.round(ownLapsAt.pointMeter[i])]));
    const w = idx.map((i) => pts[i].watts).filter((v): v is number => v !== null);
    const hr = idx.map((i) => pts[i].hr).filter((v): v is number => v !== null);
    let meters = 0;
    let seconds = 0;
    for (const a of ownLapsAt.at.slice(1)) for (const s of sections) if (ids.has(s.id) && Number.isFinite(a[s.to] - a[s.from])) {
      meters += s.to - s.from;
      seconds += a[s.to] - a[s.from];
    }
    return [{ kind, watts: hasPower && w.length ? Math.round(mean(w)) : null, hr: hr.length ? Math.round(mean(hr)) : null, speed: seconds > 0 ? r2(meters / seconds) : 0 }];
  });

  const comparisons: Comparison[] = [];
  for (const r of input.rivals) {
    const p = project(r.track, course.proj);
    const row = results ? findRow(results, r.name) : null;
    const { laps, timing } = rivalLaps(p, course, lapCount, gun, row);
    const route: [number, number][] = [];
    for (let i = 0; i < p.x.length; i += 3) route.push([r6(r.track.points[i].lat), r6(r.track.points[i].lng)]);
    comparisons.push(compare(r.id, row?.name ?? r.name, timing, row, ownLapsAt, laps, ownRow, sections, L, route));
  }
  const { laps: ghost, best: bestIdx } = bestLapGhost(ownLapsAt, L);
  const ghostCompare = compare(BEST_LAP_ID, "Your best lap", "recorded", null, ownLapsAt, ghost, null, sections, L, []);
  // Against yourself, lap times are your own; the best lap is your fastest after lap 1 (lap 1 has the start in it).
  ghostCompare.laps = ownLaps.map((l, k) => ({ lap: l.lap, own: l.seconds, rival: ghost.seconds[k] === null ? null : r1(ghost.seconds[k] as number), delta: l.seconds !== null && ghost.seconds[k] !== null ? r1(l.seconds - (ghost.seconds[k] as number)) : null }));
  ghostCompare.name = `Your best lap (lap ${bestIdx + 1})`;
  comparisons.push(ghostCompare);

  let field: RaceReport["field"] = null;
  if (results && ownRow) {
    const fieldLaps: FieldLap[] = ownRow.laps.map((own, k) => {
      const times = results.filter((r) => r.laps[k] !== undefined).map((r) => ({ t: r.laps[k], name: r.name }));
      const fastest = times.reduce((a, b) => (b.t < a.t ? b : a));
      return { lap: k + 1, rank: 1 + times.filter((x) => x.t < own).length, of: times.length, fastest: fastest.t, fastestName: fastest.name, own };
    });
    field = { riders: results.length, laps: fieldLaps };
  }

  const profile = ele ? Array.from({ length: Math.floor(L / 10) + 1 }, (_, i) => r1(ele[i * 10])) : null;
  return {
    lapMeters: L,
    lapCount,
    gate: [r6(course.gate.lat), r6(course.gate.lng)],
    line: thinLine(course, 3),
    profile,
    sections,
    own: { name: ownRow?.name ?? input.ownName ?? "You", place: ownRow?.place ?? null, total: ownRow?.total ?? null, laps: ownLaps, hasPower, hasHr, byKind },
    field,
    comparisons,
  };
}

export { isTimed };
