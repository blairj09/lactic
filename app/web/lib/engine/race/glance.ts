// A race at a glance, with nothing to set up: the comparisons a race report can make on its own,
// from data the rider already has. Your peak powers (and W/kg) against your best of the last 90
// days, where you placed in the results once they're in, and your earlier rides of the same course
// found in your history, matched by their GPS tracks. Like a results site's race page, but every
// number is yours. No browser or Node APIs, so it runs and tests anywhere.

import type { PowerCurve } from "../power";
import type { Route } from "../ride-detail";
import { formatClock, type ResultRow } from "./results";
import { haversine } from "./solo";
import type { Track } from "./track";

export interface RideFigures {
  id: string;
  name: string | null;
  /** Epoch ms. */
  startedAt: number;
  durationSeconds: number;
  distanceMeters: number | null;
  averagePower: number | null;
  normalizedPower: number | null;
  averageHr: number | null;
  powerCurve: PowerCurve | null;
}

export interface HistoryRide extends RideFigures {
  route: Route;
  /** The event it raced, when it was an event's ride. */
  event: string | null;
}

export interface GlanceInput {
  race: RideFigures;
  route: Route | null;
  weightKg: number | null;
  /** Best power in the 90 days before the race. */
  bestCurve: PowerCurve | null;
  results: ResultRow[];
  /** The rider's own row in the results. */
  ownRow: ResultRow | null;
  /** Earlier rides that might be the same course (any length; the engine checks). */
  history: HistoryRide[];
}

export interface PeakRow {
  seconds: number;
  label: string;
  watts: number;
  wkg: number | null;
  /** Best over the same time in the 90 days before. */
  best: number | null;
  /** Watts over that best, 0-1+. */
  ofBest: number | null;
  /** At or over the 90-day best. */
  newBest: boolean;
}

export interface Placing {
  place: number;
  of: number;
  /** Place as a share of the field: 0.25 is the top quarter. */
  share: number;
  total: number | null;
  winner: { name: string; total: number | null };
  /** Your time minus the winner's, seconds. */
  toWinner: number | null;
  /** Your time minus third place's, when you're off the podium. */
  toPodium: number | null;
  ahead: { name: string; gap: number } | null;
  behind: { name: string; gap: number } | null;
  /** Your average speed as a share of the winner's: 0.97 is 3% slower. */
  ofWinnerSpeed: number | null;
}

export interface PastRide {
  id: string;
  name: string | null;
  startedAt: number;
  event: string | null;
  seconds: number;
  /** This race's time minus that ride's: negative is faster now. */
  delta: number;
  averagePower: number | null;
  normalizedPower: number | null;
  averageHr: number | null;
  /** Share of the two tracks on the same roads, 0-1. */
  overlap: number;
  /** Peak powers on that ride at the same durations as the race's peaks. */
  peaks: Record<number, number>;
}

export interface Glance {
  peaks: PeakRow[];
  /** Normalized power in W/kg, when there's power and a weight. */
  npWkg: number | null;
  placing: Placing | null;
  past: PastRide[];
  /** The two or three things worth saying first, in plain words. */
  headlines: string[];
}

const PEAKS: [number, string][] = [
  [15, "15 s"],
  [60, "1 min"],
  [300, "5 min"],
  [1200, "20 min"],
  [3600, "60 min"],
];

const PEAK_WORDS: Record<number, string> = { 15: "15-second", 60: "1-minute", 300: "5-minute", 1200: "20-minute", 3600: "hour" };

/** Two tracks count as the same course when this much of each lies on the other. */
export const SAME_COURSE = 0.75;
/** A point is on the other track within this many meters (GPS drift, the other side of the road, thinned tracks). */
const ON_TRACK_METERS = 150;
/** Lengths further apart than this aren't the same course. */
const LENGTH_SLACK = 0.25;

const round1 = (v: number) => Math.round(v * 10) / 10;
const round2 = (v: number) => Math.round(v * 100) / 100;

export function raceGlance(input: GlanceInput): Glance {
  const { race, weightKg, bestCurve } = input;
  const wkg = (w: number) => (weightKg ? round2(w / weightKg) : null);

  const peaks: PeakRow[] = [];
  for (const [seconds, label] of PEAKS) {
    const watts = race.powerCurve?.[seconds];
    if (!watts || seconds > race.durationSeconds) continue;
    const best = bestCurve?.[seconds] ?? null;
    peaks.push({ seconds, label, watts: Math.round(watts), wkg: wkg(watts), best: best ? Math.round(best) : null, ofBest: best ? round2(watts / best) : null, newBest: best !== null && watts >= best });
  }

  const placing = placingOf(input.results, input.ownRow, race.distanceMeters);
  const past = input.route ? pastRides(race, input.route, input.history, peaks.map((p) => p.seconds)) : [];

  return { peaks, npWkg: race.normalizedPower ? wkg(race.normalizedPower) : null, placing, past, headlines: headlines(peaks, placing, past) };
}

function placingOf(results: ResultRow[], own: ResultRow | null, meters: number | null): Placing | null {
  if (!own || !results.length) return null;
  const of = Math.max(results.length, ...results.map((r) => r.place));
  const winner = results.find((r) => r.place === 1) ?? results[0];
  const sameLap = (r: ResultRow) => r.lapsDown === own.lapsDown && r.total !== null && own.total !== null;
  const gap = (r: ResultRow | undefined) => (r && sameLap(r) ? (own.total as number) - (r.total as number) : null);
  const ahead = results.filter((r) => r.place < own.place).sort((a, b) => b.place - a.place)[0];
  const behind = results.filter((r) => r.place > own.place).sort((a, b) => a.place - b.place)[0];
  const third = results.find((r) => r.place === 3);
  const toWinner = own.place === 1 ? 0 : gap(winner);
  // Speed against the winner's: only when you finished the same distance.
  const ofWinnerSpeed = meters && toWinner !== null && own.total && winner.total ? round2(winner.total / own.total) : null;
  return {
    place: own.place,
    of,
    share: round2(own.place / of),
    total: own.total,
    winner: { name: winner.name, total: winner.total },
    toWinner,
    toPodium: own.place > 3 ? gap(third) : null,
    ahead: ahead && gap(ahead) !== null ? { name: ahead.name, gap: gap(ahead) as number } : null,
    behind: behind && sameLap(behind) ? { name: behind.name, gap: (behind.total as number) - (own.total as number) } : null,
    ofWinnerSpeed,
  };
}

/** Earlier rides of the same roads, newest first. */
function pastRides(race: RideFigures, route: Route, history: HistoryRide[], durations: number[]): PastRide[] {
  const length = race.distanceMeters;
  const out: PastRide[] = [];
  for (const h of history) {
    if (h.id === race.id || h.startedAt >= race.startedAt || h.route.length < 2) continue;
    if (length && h.distanceMeters && Math.abs(h.distanceMeters - length) / length > LENGTH_SLACK) continue;
    const overlap = sameCourse(route, h.route);
    if (overlap < SAME_COURSE) continue;
    const peaks: Record<number, number> = {};
    for (const s of durations) if (h.powerCurve?.[s]) peaks[s] = Math.round(h.powerCurve[s]);
    out.push({
      id: h.id,
      name: h.name,
      startedAt: h.startedAt,
      event: h.event,
      seconds: h.durationSeconds,
      delta: race.durationSeconds - h.durationSeconds,
      averagePower: h.averagePower,
      normalizedPower: h.normalizedPower,
      averageHr: h.averageHr,
      overlap: round2(overlap),
      peaks,
    });
  }
  return out.sort((a, b) => b.startedAt - a.startedAt);
}

/**
 * How much two tracks share: the smaller of (share of a's points on b) and (share of b's on a), so a
 * short loop inside a long ride doesn't count as the same course. Up to 300 points from each.
 */
export function sameCourse(a: Route, b: Route): number {
  return Math.min(shareOn(a, b), shareOn(b, a));
}

function shareOn(from: Route, onto: Route): number {
  if (from.length < 2 || onto.length < 2) return 0;
  const lat0 = onto[0][0];
  const kx = 111_320 * Math.cos((lat0 * Math.PI) / 180);
  const ky = 110_540;
  const cell = ON_TRACK_METERS;
  const grid = new Map<string, [number, number][]>();
  for (const p of onto) {
    const key = `${Math.floor((p[1] * kx) / cell)},${Math.floor((p[0] * ky) / cell)}`;
    const list = grid.get(key);
    if (list) list.push([p[0], p[1]]);
    else grid.set(key, [[p[0], p[1]]]);
  }
  const step = Math.max(1, Math.floor(from.length / 300));
  let near = 0;
  let total = 0;
  for (let i = 0; i < from.length; i += step) {
    const [lat, lng] = from[i];
    const cx = Math.floor((lng * kx) / cell);
    const cy = Math.floor((lat * ky) / cell);
    total++;
    search: for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (const q of grid.get(`${cx + dx},${cy + dy}`) ?? []) {
          if (haversine(lat, lng, q[0], q[1]) <= ON_TRACK_METERS) {
            near++;
            break search;
          }
        }
      }
    }
  }
  return total ? near / total : 0;
}

function headlines(peaks: PeakRow[], placing: Placing | null, past: PastRide[]): string[] {
  const lines: string[] = [];
  if (placing) {
    const top = placing.place === 1 ? "You won" : `${ordinal(placing.place)} of ${placing.of}`;
    const share = placing.place > 1 && placing.of >= 5 && placing.share <= 0.5 ? `, top ${Math.max(1, Math.round(placing.share * 100))}%` : "";
    const gap =
      placing.place === 1
        ? placing.behind
          ? `, ${formatClock(placing.behind.gap)} clear of ${placing.behind.name}`
          : ""
        : placing.toWinner !== null
          ? `, ${formatClock(placing.toWinner)} behind ${placing.winner.name}`
          : "";
    lines.push(`${top}${share}${gap}.`);
    if (placing.ahead && placing.ahead.gap <= 30 && placing.place > 1) lines.push(`${formatClock(placing.ahead.gap)} from ${ordinal(placing.place - 1)}, ${placing.ahead.name}.`);
  }
  const bests = peaks.filter((p) => p.newBest);
  if (bests.length) {
    const best = bests.find((p) => p.seconds === 300) ?? bests[bests.length - 1];
    const figure = `${best.watts} W${best.wkg ? ` (${round1(best.wkg)} W/kg)` : ""}`;
    if (bests.length === 1) lines.push(`Your best ${PEAK_WORDS[best.seconds]} power in 90 days: ${figure}.`);
    else lines.push(`New 90-day bests over ${list(bests.map((p) => p.label))}, ${figure} for ${best.label}.`);
  } else {
    const closest = [...peaks].filter((p) => p.ofBest !== null).sort((a, b) => (b.ofBest as number) - (a.ofBest as number))[0];
    if (closest?.ofBest) lines.push(`Closest to your best over ${closest.label}: ${closest.watts} W, ${Math.round(closest.ofBest * 100)}% of your 90-day best.`);
  }
  const last = past[0];
  if (last) {
    const when = new Date(last.startedAt).getUTCFullYear();
    const what = last.event ? `${last.event} (${when})` : `your ride of this course on ${new Date(last.startedAt).toISOString().slice(0, 10)}`;
    lines.push(Math.abs(last.delta) < 30 ? `About level with ${what}.` : `${formatClock(Math.abs(last.delta))} ${last.delta < 0 ? "faster" : "slower"} than ${what}.`);
  }
  return lines;
}

const list = (items: string[]) => (items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`);

const ordinal = (n: number) => {
  const s = n % 100 >= 11 && n % 100 <= 13 ? "th" : (["th", "st", "nd", "rd"][n % 10] ?? "th");
  return `${n}${s}`;
};

/**
 * One of your stored rides as a race track, to line up as a past edition: the map track (a point
 * every 10 m or so, each with its ride second) with power and heart rate from the stream. Null
 * when the track has no times.
 */
export function trackFromStored(
  route: Route,
  startedAtMs: number,
  stream: { step: number; watts: (number | null)[] | null; heartRate: (number | null)[] | null; cadence: (number | null)[] | null },
  name: string | null,
): Track | null {
  if (route.length < 2 || route.some((p) => p[2] === undefined)) return null;
  const at = <T,>(values: (T | null)[] | null, t: number) => (values ? (values[Math.min(values.length - 1, Math.floor(t / stream.step))] ?? null) : null);
  return {
    name,
    points: route.map((p) => {
      const t = p[2] as number;
      return { t: Math.round(startedAtMs / 1000) + t, lat: p[0], lng: p[1], ele: null, hr: at(stream.heartRate, t), watts: at(stream.watts, t), cadence: at(stream.cadence, t) };
    }),
  };
}
