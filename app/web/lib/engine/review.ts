// The weekly review: how last week went against the plan, how sessions felt and which levels moved.
// The coach writes about these numbers; it never works them out itself.

import { markDays, type ComplianceDay, type DayMark } from "./compliance";
import { DIFFICULTIES, type Difficulty } from "./feedback";
import { ZONES, type Levels, type Zone } from "./library";
import { addDays } from "./pmc";

/** What a day was planned to be when the week started, so the review can still compare once the plan has moved on. */
export interface SnapshotDay {
  date: string;
  duration: number;
  stress: number;
}

export interface WeekReview {
  /** Monday and Sunday of the week reviewed. */
  start: string;
  end: string;
  /** Planned stress for the week, and stress ridden (planned or not). */
  planned: number;
  done: number;
  rides: number;
  seconds: number;
  /** Days by how they went against the plan (compliance.ts). */
  marks: Record<DayMark, number>;
  /** Post-ride answers for the week's rides, and their average RPE. */
  felt: Record<Difficulty, number>;
  rpe: number | null;
  /** Zones whose level moved over the week. */
  levels: { zone: Zone; from: number; to: number }[];
  /** Fitness and form at the end of the week, and the change in fitness over it. */
  fitness: number;
  fitnessChange: number;
  form: number;
}

export interface ReviewInput {
  /** Monday of the week to review. */
  start: string;
  /** The week's days, plus one either side so a session moved across its edge still matches. */
  days: ComplianceDay[];
  feedback: { day: string; difficulty: Difficulty; rpe: number | null }[];
  /** Levels at the end of the Sunday before, and at the end of the week. */
  levelsBefore: Levels;
  levelsAfter: Levels;
  /** Fitness series covering the week and the day before it. */
  series: { date: string; fitness: number; fatigue: number }[];
}

export function weekReview(input: ReviewInput): WeekReview {
  const start = input.start;
  const end = addDays(start, 6);
  const inWeek = (date: string) => date >= start && date <= end;
  const week = input.days.filter((d) => inWeek(d.date));
  // Marked as of the Monday after, so every day of the week counts as past.
  const marks = markDays(input.days, addDays(end, 1));
  const counts: Record<DayMark, number> = { done: 0, partial: 0, moved: 0, missed: 0, unplanned: 0 };
  for (const [date, result] of marks) {
    // A moved session counts once, on the day it was planned for.
    if (!inWeek(date) || (result.mark === "moved" && result.movedFrom)) continue;
    counts[result.mark]++;
  }
  const felt = Object.fromEntries(DIFFICULTIES.map((d) => [d, 0])) as Record<Difficulty, number>;
  const answers = input.feedback.filter((f) => inWeek(f.day));
  for (const f of answers) felt[f.difficulty]++;
  const rpes = answers.flatMap((f) => (f.rpe === null ? [] : [f.rpe]));
  const rides = week.flatMap((d) => d.rides);
  const levels = ZONES.filter((z) => z !== "recovery" && Math.abs(input.levelsAfter[z] - input.levelsBefore[z]) >= 0.05).map((zone) => ({
    zone,
    from: input.levelsBefore[zone],
    to: input.levelsAfter[zone],
  }));
  const at = (date: string) => input.series.find((d) => d.date === date);
  const last = at(end) ?? input.series.filter((d) => d.date <= end).at(-1);
  const before = at(addDays(start, -1)) ?? input.series.find((d) => d.date >= start);
  return {
    start,
    end,
    planned: Math.round(week.reduce((t, d) => t + (d.planned?.stress ?? 0), 0)),
    done: Math.round(rides.reduce((t, r) => t + (r.trainingStress ?? 0), 0)),
    rides: rides.length,
    seconds: rides.reduce((t, r) => t + r.durationSeconds, 0),
    marks: counts,
    felt,
    rpe: rpes.length ? Math.round((rpes.reduce((a, b) => a + b, 0) / rpes.length) * 10) / 10 : null,
    levels,
    fitness: Math.round(last?.fitness ?? 0),
    fitnessChange: Math.round((last?.fitness ?? 0) - (before?.fitness ?? 0)),
    form: Math.round((last?.fitness ?? 0) - (last?.fatigue ?? 0)),
  };
}

/** The review is written and shown in the first days of a week, about the week before. */
export const REVIEW_DAYS = 3;

/** Whether `today` falls in the first REVIEW_DAYS of the week starting `monday`. */
export function reviewTime(today: string, monday: string): boolean {
  return today >= monday && today < addDays(monday, REVIEW_DAYS);
}
