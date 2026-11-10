// The rides calendar on Progress: what kind of ride each one was, where it was ridden, the filters
// and search over them, and the month grid they sit in. Pure, so it tests in Vitest.

import { ZONE_LABELS, ZONES, type Zone } from "./library";
import { addDays } from "./pmc";

export type RideSetting = "indoor" | "outdoor";

/**
 * Indoor or outside. Rides here and Zwift files are on the trainer; a ride with a real GPS track
 * was outside. Other files without a track count as indoor; Strava rides without one are unknown.
 */
export function rideSetting(source: string, hasRoute: boolean): RideSetting | null {
  if (source === "app" || source === "zwift_fit") return "indoor";
  if (hasRoute) return "outdoor";
  return source === "strava" ? null : "indoor";
}

/**
 * The zone a whole ride's intensity factor points to. A rough guess: a ride with hard intervals
 * and easy recoveries between them reads lower than its intervals, so a planned zone wins.
 */
export function zoneFromIntensity(intensityFactor: number | null): Zone | null {
  if (intensityFactor === null || !Number.isFinite(intensityFactor) || intensityFactor <= 0) return null;
  if (intensityFactor < 0.65) return "recovery";
  if (intensityFactor < 0.8) return "endurance";
  if (intensityFactor < 0.87) return "tempo";
  if (intensityFactor < 0.93) return "sweetSpot";
  if (intensityFactor < 1.02) return "threshold";
  return "vo2max";
}

/** The ride's type: the workout it was planned or logged as, else a guess from its intensity. */
export function rideType(plannedZone: Zone | null, intensityFactor: number | null): { zone: Zone; estimated: boolean } | null {
  if (plannedZone && ZONES.includes(plannedZone)) return { zone: plannedZone, estimated: false };
  const zone = zoneFromIntensity(intensityFactor);
  return zone ? { zone, estimated: true } : null;
}

/** One ride as the calendar shows it. Plain data, so it can go from the server to the browser. */
export interface CalendarRide {
  id: string;
  name: string | null;
  /** ISO instant. */
  startedAt: string;
  /** Local date, YYYY-MM-DD. */
  date: string;
  source: string;
  durationSeconds: number;
  distanceMeters: number | null;
  normalizedPower: number | null;
  trainingStress: number | null;
  stressMethod: "power" | "heartRate" | null;
  duplicateOf: string | null;
  /** This ride on intervals.icu, or its copy there. */
  intervalsId: string | null;
  setting: RideSetting | null;
  zone: Zone | null;
  zoneEstimated: boolean;
  /** The post-ride survey note. */
  note: string;
}

export interface RideFilters {
  query: string;
  source: string | "all";
  setting: RideSetting | "all";
  zone: Zone | "all";
  /** Show copies of a ride from other sources (they count once). */
  copies: boolean;
}

export const NO_FILTERS: RideFilters = { query: "", source: "all", setting: "all", zone: "all", copies: false };

/** Filters other than the copies toggle are set. */
export const filtering = (f: RideFilters) => f.query.trim() !== "" || f.source !== "all" || f.setting !== "all" || f.zone !== "all";

/**
 * The rides that pass the filters. Search matches every word, in any order, against the name,
 * the survey note and the type, ignoring case and accents.
 */
export function filterRides<R extends CalendarRide>(rides: R[], f: RideFilters, sourceLabel: (s: string) => string = (s) => s): R[] {
  const words = fold(f.query).split(/\s+/).filter(Boolean);
  return rides.filter((r) => {
    if (!f.copies && r.duplicateOf) return false;
    if (f.source !== "all" && r.source !== f.source) return false;
    if (f.setting !== "all" && r.setting !== f.setting) return false;
    if (f.zone !== "all" && r.zone !== f.zone) return false;
    if (!words.length) return true;
    const text = fold([r.name ?? "Ride", r.note, r.zone ? ZONE_LABELS[r.zone] : "", sourceLabel(r.source), r.setting ?? ""].join(" "));
    return words.every((w) => text.includes(w));
  });
}

const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** The Monday-first weeks that cover a month ("YYYY-MM"), as dates. */
export function monthWeeks(month: string): string[][] {
  const first = `${month}-01`;
  const weekday = (new Date(`${first}T00:00:00Z`).getUTCDay() + 6) % 7;
  let day = addDays(first, -weekday);
  const weeks: string[][] = [];
  do {
    weeks.push(Array.from({ length: 7 }, (_, i) => addDays(day, i)));
    day = addDays(day, 7);
  } while (day.slice(0, 7) === month);
  return weeks;
}

/** The month a number of months away from another ("YYYY-MM"). */
export function shiftMonth(month: string, by: number): string {
  const [y, m] = month.split("-").map(Number);
  const index = y * 12 + (m - 1) + by;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`;
}

/** Time and stress over rides, leaving copies out. Stress is null when none of them has any. */
export function rideTotals(rides: CalendarRide[]): { count: number; durationSeconds: number; trainingStress: number | null } {
  const counted = rides.filter((r) => !r.duplicateOf);
  return {
    count: counted.length,
    durationSeconds: counted.reduce((t, r) => t + r.durationSeconds, 0),
    trainingStress: counted.some((r) => r.trainingStress !== null) ? counted.reduce((t, r) => t + (r.trainingStress ?? 0), 0) : null,
  };
}

/** Zone colour step, 1 (recovery) to 7 (anaerobic), for the --zone-n tokens. */
export const zoneStep = (zone: Zone) => ZONES.indexOf(zone) + 1;
