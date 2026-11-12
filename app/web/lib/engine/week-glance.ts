// This week at a glance, for Today: each day's plan and how it went, stress so far against the plan to date,
// and where the week is in a saved plan. Pure, so Today only shows what this returns.

import { markDays, type ComplianceDay, type DayMark } from "./compliance";
import { addDays } from "./pmc";

export interface GlanceDay {
  date: string;
  /** Planned stress; 0 on a rest day. */
  planned: number;
  /** Stress ridden that day. */
  done: number;
  /** How the day went (compliance.ts), once it's past or ridden. */
  mark: DayMark | null;
  /** Before the saved plan started: its rides show but aren't measured against the plan. */
  beforePlan?: true;
}

export type Tracking = "ahead" | "onTrack" | "behind" | "early";

export interface WeekGlance {
  /** Monday to Sunday. */
  days: GlanceDay[];
  /** Planned for the whole week, planned through today, and ridden so far (from the plan's start). */
  planned: number;
  plannedToDate: number;
  done: number;
  /** Ridden against planned through today: within TRACKING_BAND is on track. Early: nothing was due yet. */
  tracking: Tracking;
  /** Sessions done (or partly), and planned sessions in the week. */
  sessionsDone: number;
  sessions: number;
}

/** Ridden stress within this share of what was planned through today is on track. */
export const TRACKING_BAND = 0.15;

/**
 * `days` covers the week starting `monday`, plus the day either side so a session moved across an edge still
 * matches. Today counts as planned-to-date only once ridden, so a morning with today's ride still to come isn't
 * "behind".
 */
export function weekGlance(days: ComplianceDay[], monday: string, today: string): WeekGlance {
  const end = addDays(monday, 6);
  const marks = markDays(days, today);
  const week = days.filter((d) => d.date >= monday && d.date <= end);
  const stress = (d: ComplianceDay) => d.rides.reduce((t, r) => t + (r.trainingStress ?? 0), 0);
  const out: GlanceDay[] = week.map((d) => ({
    date: d.date,
    planned: Math.round(d.beforePlan ? 0 : (d.planned?.stress ?? 0)),
    done: Math.round(stress(d)),
    ...(d.beforePlan ? { beforePlan: true as const } : {}),
    mark: marks.get(d.date)?.mark ?? null,
  }));
  const ridden = (d: GlanceDay) => d.date < today || (d.date === today && d.done > 0);
  const planned = out.reduce((t, d) => t + d.planned, 0);
  const plannedToDate = out.filter(ridden).reduce((t, d) => t + d.planned, 0);
  const done = out.filter((d) => !d.beforePlan).reduce((t, d) => t + d.done, 0);
  const tracking: Tracking =
    plannedToDate === 0 ? (done > 0 ? "ahead" : "early") : done > plannedToDate * (1 + TRACKING_BAND) ? "ahead" : done < plannedToDate * (1 - TRACKING_BAND) ? "behind" : "onTrack";
  return {
    days: out,
    planned,
    plannedToDate,
    done,
    tracking,
    sessionsDone: out.filter((d) => d.planned > 0 && (d.mark === "done" || d.mark === "partial" || d.mark === "moved")).length,
    sessions: out.filter((d) => d.planned > 0).length,
  };
}

/** Week `n` of `of` in a saved plan running start to end (dates YYYY-MM-DD, weeks from the plan's Monday). */
export function planWeek(planStart: string, planEnd: string, monday: string): { n: number; of: number } | null {
  const mondayOf = (d: string) => addDays(d, -((new Date(`${d}T12:00:00Z`).getUTCDay() + 6) % 7));
  const weeks = (a: string, b: string) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / (7 * 86_400_000));
  const first = mondayOf(planStart);
  const of = weeks(first, mondayOf(planEnd)) + 1;
  const n = weeks(first, monday) + 1;
  return n >= 1 && n <= of ? { n, of } : null;
}
