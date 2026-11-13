// Riding a course in a time you set: the FTP it takes (at the event's effort, in its pack), whether
// that's in reach by race day, the pacing that gets you there, and, for group events, what getting
// dropped on the main climb costs. Every number comes from the same riding model as the estimate.

import type { Goal } from "../plan";
import { packOf, paceCourse, riderOf, type PaceOptions, type Pacing, type Rider } from "./pacing";
import type { CourseProfile } from "./profile";

/**
 * How much FTP a rider can realistically add in `weeks` of structured training: quick at first,
 * slowing as it goes, about 3% in a month, 6% in two and 10% in five. Typical of trained amateurs;
 * newer riders often gain more, very experienced ones less.
 */
export function ftpGain(weeks: number): number {
  return weeks <= 0 ? 0 : Math.round(0.12 * (1 - Math.exp(-weeks / 12)) * 1000) / 1000;
}

/** The FTP that rides `profile` in `seconds` at the event's effort, to the watt. */
export function ftpForTime(profile: CourseProfile, goal: Goal, rider: Rider, seconds: number, options: Omit<PaceOptions, "ftp"> = {}): number {
  const base = riderOf(rider).ftp;
  const time = (ftp: number) => paceCourse(profile, goal, rider, { ...options, ftp }).seconds;
  let lo = base * 0.4;
  let hi = base * 2.5;
  if (time(hi) > seconds) return Math.round(hi);
  if (time(lo) < seconds) return Math.round(lo);
  for (let i = 0; i < 22 && hi - lo > 0.5; i++) {
    const mid = (lo + hi) / 2;
    if (time(mid) > seconds) lo = mid;
    else hi = mid;
  }
  return Math.round(hi);
}

export type TargetStatus = "onTrack" | "stretch" | "outOfReach";

export interface TargetPlan {
  /** The time you set, seconds. */
  seconds: number;
  /** Your FTP now (or the typical one the model assumes). */
  ftp: number;
  /** The FTP that rides it in that time. */
  neededFtp: number;
  /** A realistic FTP by race day, from the weeks of training left. */
  raceDayFtp: number;
  /** Weeks of training left before the race week. */
  weeks: number;
  /** onTrack: you can ride it now. stretch: in reach with the training left. outOfReach: not by race day. */
  status: TargetStatus;
  /** Watts per kilogram the target takes. */
  neededWkg: number;
  /** Pacing at the FTP the target takes: what to hold to ride it in that time. */
  pacing: Pacing;
  /** The time a realistic race-day FTP rides it in, seconds. */
  raceDaySeconds: number;
}

const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

/** What a target time asks of you, against your FTP now and what's realistic by race day. */
export function targetPlan(profile: CourseProfile, goal: Goal, rider: Rider, seconds: number, today: string, options: Omit<PaceOptions, "ftp"> = {}): TargetPlan {
  const r = riderOf(rider);
  // Training stops counting in the race week: that's the taper.
  const weeks = Math.max(0, Math.floor(daysBetween(today, goal.date) / 7) - 1);
  const neededFtp = ftpForTime(profile, goal, rider, seconds, options);
  const raceDayFtp = Math.round(r.ftp * (1 + ftpGain(weeks)));
  // Within a percent counts as there: the model isn't finer than that.
  const status: TargetStatus = neededFtp <= r.ftp * 1.01 ? "onTrack" : neededFtp <= raceDayFtp * 1.01 ? "stretch" : "outOfReach";
  return {
    seconds,
    ftp: r.ftp,
    neededFtp,
    raceDayFtp,
    weeks,
    status,
    neededWkg: Math.round((neededFtp / r.weightKg) * 100) / 100,
    pacing: paceCourse(profile, goal, rider, { ...options, ftp: neededFtp }),
    raceDaySeconds: paceCourse(profile, goal, rider, { ...options, ftp: Math.max(r.ftp, raceDayFtp) }).seconds,
  };
}

export interface DroppedTime {
  /** The climb you're dropped on (its number on the profile). */
  climb: number;
  /** Your time riding solo from its foot, seconds. */
  seconds: number;
  /** How much slower than staying with the group, seconds. */
  cost: number;
}

/**
 * For a group or bunch event, your time if you're dropped at the foot of the main climb and ride
 * the rest alone. Null when the event is ridden solo or has no climb worth naming.
 */
export function droppedTime(profile: CourseProfile, goal: Goal, rider: Rider, pacing: Pacing, options: Omit<PaceOptions, "soloFrom"> = {}): DroppedTime | null {
  if (packOf(goal) === "solo") return null;
  const main = [...pacing.climbs].filter((c) => c.seconds >= 180).sort((a, b) => b.seconds - a.seconds)[0];
  // Dropped near the finish costs little and isn't worth a line.
  if (!main || main.from > profile.meters * 0.95) return null;
  const solo = paceCourse(profile, goal, rider, { ...options, soloFrom: main.from });
  return { climb: main.n, seconds: solo.seconds, cost: Math.max(0, solo.seconds - pacing.seconds) };
}

/** "4:05" from seconds. */
export const clock = (seconds: number) => {
  const m = Math.round(seconds / 60);
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}`;
};

/** Seconds from "4:30", "4h30", "4:30:00" or "270" (minutes); null when it doesn't read as a time. */
export function parseFinishTime(text: string): number | null {
  const t = text.trim().toLowerCase();
  if (!t) return null;
  let m = t.match(/^(\d{1,2})\s*[:h]\s*(\d{1,2})(?:\s*[:m]\s*(\d{1,2})s?)?\s*m?$/);
  if (m) {
    const [h, min, s] = [Number(m[1]), Number(m[2]), Number(m[3] ?? 0)];
    if (min >= 60 || s >= 60) return null;
    const total = h * 3600 + min * 60 + s;
    return total >= 300 && total <= 24 * 3600 ? total : null;
  }
  m = t.match(/^(\d{1,4})\s*(?:min|m)?$/);
  if (m) {
    const total = Number(m[1]) * 60;
    return total >= 300 && total <= 24 * 3600 ? total : null;
  }
  return null;
}
