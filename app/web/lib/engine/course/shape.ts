// Training for a course: what its climbs ask of you, and how the plan's key days change for them.
// A course with long climbs gets sustained threshold and sweet spot in blocks as long as its main
// climb; one with short steep kicks gets VO2 max and repeated hard efforts; a flat course leaves the
// plan as the event's kind shapes it. Rule-based, like the rest of the plan.

import type { Zone } from "../library";
import type { Focus } from "../templates";
import { goalIntensity, goalMinutes, type Goal, type GoalKind } from "../plan";
import { airDensity, bikeSetup, climbFraction, climbSeconds, DRAFT, packOf, riderOf, type Pack, type Rider } from "./pacing";
import type { CourseSummary, CourseType } from "./profile";

export interface DemandClimb {
  n: number;
  /** Kilometers in, where it starts. */
  km: number;
  lengthKm: number;
  gain: number;
  /** Average grade, percent. */
  grade: number;
  /** Minutes at race pace. */
  minutes: number;
}

/** What a course asks of you, kept on the event (and shown to the coach with it). */
export interface CourseDemands {
  type: CourseType;
  km: number;
  gain: number;
  /** The climbs that matter, longest first: at most five. */
  climbs: DemandClimb[];
  /** Minutes on the longest climb at race pace. */
  longestClimb: number;
  /** Climbs of 1 to 5 minutes. */
  kicks: number;
  /** Rough share of race time spent climbing. */
  climbingShare: number;
}

/** A course's demands for a rider: how long each climb takes them at race pace. */
export function courseDemands(summary: CourseSummary, kind: GoalKind, goal: Pick<Goal, "intensity" | "minutes" | "kind"> & { pack?: Pack | null }, rider: Rider): CourseDemands {
  const r = riderOf(rider);
  const setup = bikeSetup(kind);
  const mass = r.weightKg + setup.bikeKg;
  const hours = goalMinutes(goal as Goal) / 60;
  const intensity = goalIntensity(goal as Goal);
  const draft = DRAFT[packOf({ kind, pack: goal.pack })];
  const timed = summary.climbs.map((c) => {
    const first = climbSeconds(c, r.ftp * 0.95, mass, setup, draft);
    const f = climbFraction(first, hours, intensity);
    return { c, seconds: climbSeconds(c, r.ftp * f, mass, setup, draft) };
  });
  // Flat riding time at about 32 km/h on the road, slower off it; enough to weigh climbing against.
  const flatSpeed = (setup.crr > 0.006 ? 24 : 32) / 3.6 * Math.sqrt(airDensity(0) / 1.225);
  const climbMeters = summary.climbs.reduce((s, c) => s + c.to - c.from, 0);
  const climbTime = timed.reduce((s, t) => s + t.seconds, 0);
  const total = climbTime + Math.max(0, summary.meters - climbMeters) / flatSpeed;
  const climbs = timed
    .filter((t) => t.seconds >= 60)
    .sort((a, b) => b.seconds - a.seconds)
    .slice(0, 5)
    .map(({ c, seconds }) => ({
      n: c.n,
      km: Math.round(c.from / 100) / 10,
      lengthKm: Math.round((c.to - c.from) / 100) / 10,
      gain: c.gain,
      grade: Math.round(c.grade * 1000) / 10,
      minutes: Math.round(seconds / 60),
    }));
  return {
    type: summary.type,
    km: Math.round(summary.meters / 100) / 10,
    gain: summary.gain,
    climbs,
    longestClimb: climbs[0]?.minutes ?? 0,
    kicks: timed.filter((t) => t.seconds >= 60 && t.seconds <= 300).length,
    climbingShare: total > 0 ? Math.round((climbTime / total) * 100) / 100 : 0,
  };
}

export interface CourseShape {
  /** Key-session zones for specialty and taper weeks, in place of the event kind's. */
  zones: Zone[];
  /** Workout structures to favor in specialty and taper. */
  focus: Focus[];
  /** One key day a week rides intervals as long as the main climb, from build on. */
  climb: { zone: Zone; seconds: number } | null;
  /** One sentence on why, shown on the days it shapes. */
  note: string;
}

const name = (c: DemandClimb) => `climb ${c.n}`;

/** How a course changes the plan, or null when it doesn't (flat, or no climbs worth training for). */
export function courseShape(goal: Goal & { course?: CourseDemands | null }): CourseShape | null {
  const d = goal.course;
  if (!d || d.climbs.length === 0) return null;
  const easy = goalIntensity(goal) === "easy";
  const main = d.climbs[0];
  if (goal.kind === "hillClimb" || (d.longestClimb >= 15 && d.type !== "flat")) {
    const long = d.longestClimb > 25;
    const zone: Zone = long || easy ? "sweetSpot" : "threshold";
    return {
      zones: long || easy ? ["sweetSpot", "threshold"] : ["threshold", "sweetSpot"],
      focus: ["sustained", "progressive"],
      climb: { zone, seconds: Math.min(d.longestClimb, zone === "threshold" ? 25 : 40) * 60 },
      note: `Shaped for the course: ${name(main)} takes about ${main.minutes} min at race pace, so key days hold steady power in long blocks.`,
    };
  }
  if (d.longestClimb >= 5 && d.type !== "flat") {
    return {
      zones: easy ? ["sweetSpot", "threshold"] : ["threshold", "vo2max"],
      focus: ["sustained", "hardStart", "overUnder"],
      climb: { zone: easy ? "sweetSpot" : "threshold", seconds: Math.max(6, d.longestClimb) * 60 },
      note: `Shaped for the course: climbs of ${d.longestClimb} min or so (${name(main)} is the longest), so key days build power for efforts that long.`,
    };
  }
  if (d.kicks >= 3) {
    const typical = Math.max(2, Math.min(5, Math.round(d.climbs.reduce((s, c) => s + c.minutes, 0) / d.climbs.length)));
    return {
      zones: easy ? ["threshold", "vo2max"] : ["vo2max", "anaerobic"],
      focus: ["repeatability", "surges", "hardStart"],
      climb: { zone: easy ? "threshold" : "vo2max", seconds: typical * 60 },
      note: `Shaped for the course: ${d.kicks} short climbs of a few minutes each, so key days repeat hard efforts of about ${typical} min.`,
    };
  }
  return null;
}
