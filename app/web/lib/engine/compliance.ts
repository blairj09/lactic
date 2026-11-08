// Planned against done: a mark for each past day of the plan and the week's stress so far.

import { addDays } from "./pmc";
import { completion, DONE_SHARE } from "./ride-detail";

export type DayMark = "done" | "partial" | "moved" | "missed" | "unplanned";

export const DAY_MARK_LABELS: Record<DayMark, string> = {
  done: "Done",
  partial: "Partly done",
  moved: "Moved",
  missed: "Missed",
  unplanned: "Unplanned",
};

export interface ComplianceRide {
  id: string;
  durationSeconds: number;
  trainingStress: number | null;
}

export interface ComplianceDay {
  date: string;
  /** The session in force that day; null on a rest day. */
  planned: { duration: number; stress: number } | null;
  rides: ComplianceRide[];
  /** A missed key session moved off this day (adapt.ts): the day it went to. */
  movedTo?: string;
}

export interface DayResult {
  mark: DayMark;
  /** Ridden against planned (see `completion`); null on unplanned days. */
  share: number | null;
  /** For a moved session: the day it was ridden on. For a ride that made up a moved session: the day it was planned for. */
  movedTo?: string;
  movedFrom?: string;
}

/**
 * Marks days before `today` (and today, once ridden): a planned day ridden to at least
 * DONE_SHARE is done, ridden less is partly done, and one with no ride is missed unless a ride on the
 * rest day just before or after it made it up (moved). Rides on rest days that made nothing up are
 * unplanned. Rest days without a ride get no mark. A day whose missed session the plan moved later in the week
 * (movedTo) is marked moved.
 */
export function markDays(days: ComplianceDay[], today: string): Map<string, DayResult> {
  const byDate = new Map(days.map((d) => [d.date, d]));
  const out = new Map<string, DayResult>();
  const claimed = new Set<string>();
  const total = (rides: ComplianceRide[]) => ({
    durationSeconds: rides.reduce((t, r) => t + r.durationSeconds, 0),
    trainingStress: rides.some((r) => r.trainingStress !== null) ? rides.reduce((t, r) => t + (r.trainingStress ?? 0), 0) : null,
  });
  const sorted = [...days].filter((d) => d.date <= today).sort((a, b) => a.date.localeCompare(b.date));

  for (const day of sorted) {
    if (day.movedTo && !day.rides.length) out.set(day.date, { mark: "moved", share: null, movedTo: day.movedTo });
  }
  for (const day of sorted) {
    if (!day.planned || day.planned.stress <= 0 || !day.rides.length) continue;
    const share = completion(day.planned, total(day.rides));
    out.set(day.date, { mark: share >= DONE_SHARE ? "done" : "partial", share });
  }
  for (const day of sorted) {
    if (!day.planned || day.planned.stress <= 0 || day.rides.length || out.has(day.date)) continue;
    // A rest day next to it with a ride on it (the day before first) made it up.
    const swap = [addDays(day.date, -1), addDays(day.date, 1)]
      .map((date) => byDate.get(date))
      .find((d) => d && d.date <= today && (!d.planned || d.planned.stress <= 0) && d.rides.length && !claimed.has(d.date));
    if (swap) {
      claimed.add(swap.date);
      const share = completion(day.planned, total(swap.rides));
      out.set(day.date, { mark: "moved", share, movedTo: swap.date });
      out.set(swap.date, { mark: "moved", share, movedFrom: day.date });
    } else if (day.date < today) {
      out.set(day.date, { mark: "missed", share: 0 });
    }
  }
  for (const day of sorted) {
    if (day.rides.length && !out.has(day.date)) out.set(day.date, { mark: "unplanned", share: null });
  }
  return out;
}

export interface WeekProgress {
  /** Stress of every session in the week. */
  planned: number;
  /** Stress of the sessions on days before today. */
  plannedToDate: number;
  /** Stress ridden in the week so far, planned or not. */
  done: number;
}

export function weekProgress(days: ComplianceDay[], today: string): WeekProgress {
  const stress = (d: ComplianceDay) => d.planned?.stress ?? 0;
  return {
    planned: Math.round(days.reduce((t, d) => t + stress(d), 0)),
    plannedToDate: Math.round(days.filter((d) => d.date < today).reduce((t, d) => t + stress(d), 0)),
    done: Math.round(days.filter((d) => d.date <= today).reduce((t, d) => t + d.rides.reduce((s, r) => s + (r.trainingStress ?? 0), 0), 0)),
  };
}

/** How many days either side of a ride it can count for (or be suggested for). */
export const LINK_WINDOW_DAYS = 3;

/**
 * The planned day a ride most likely stood in for, when its own day had nothing planned: the nearest day within
 * LINK_WINDOW_DAYS, through today, with a session planned and no ride on it (the day before first on a tie). Null
 * when its own day was planned or nothing nearby is open. `days` should already hold rides on the days they count for.
 */
export function suggestDay(days: ComplianceDay[], rideDate: string, today: string): string | null {
  const byDate = new Map(days.map((d) => [d.date, d]));
  const own = byDate.get(rideDate);
  if (own?.planned && own.planned.stress > 0) return null;
  for (let k = 1; k <= LINK_WINDOW_DAYS; k++) {
    for (const date of [addDays(rideDate, -k), addDays(rideDate, k)]) {
      const d = byDate.get(date);
      if (d && date <= today && d.planned && d.planned.stress > 0 && !d.rides.length) return date;
    }
  }
  return null;
}
