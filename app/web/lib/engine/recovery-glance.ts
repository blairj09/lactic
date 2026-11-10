// Last night at a glance for Today: each recovery measure's last two weeks against your usual range,
// and the warning signs a single morning's score can't show (a run of low HRV nights, signs of
// getting ill, sleep debt). Today's options, the coach's brief and its weekly picks read the signs.

import { exertionFromTrimp, type DayExertion } from "./exertion";
import { addDays } from "./pmc";
import type { RecoveryTrendDay } from "./recovery";

export type GlanceKey = "hrv" | "restingHeartRate" | "sleepHours" | "respiratoryRate" | "wristTemp" | "exertion";

export interface UsualRange {
  low: number;
  high: number;
}

export interface GlanceMetric {
  key: GlanceKey;
  /** The last `nights` days, oldest first; null where nothing came in. Exertion ends yesterday (today isn't over). */
  nights: { day: string; value: number | null }[];
  /** The latest value: last night's, or yesterday's exertion. */
  value: number | null;
  /** The middle 80% of the days before, once there are enough of them. */
  range: UsualRange | null;
  /** Where the latest value sits against the range. */
  outside: "low" | "high" | null;
  /** The latest value is outside the range on the side that means poorer recovery. */
  concern: boolean;
}

/** The side of each range that means poorer recovery (a big day, for exertion). */
export const CONCERN_SIDE: Record<GlanceKey, "low" | "high"> = {
  hrv: "low",
  restingHeartRate: "high",
  sleepHours: "low",
  respiratoryRate: "high",
  wristTemp: "high",
  exertion: "high",
};

export interface RecoverySignal {
  id: "hrvLow" | "restingHrHigh" | "illness" | "sleepDebt";
  /** How much it adds to the check-in's strain (engine/checkin.ts). */
  strain: number;
  /** Plain words for the athlete and the coach. */
  reason: string;
}

/** Days a usual range needs, and the window it's taken over. */
export const MIN_RANGE_DAYS = 10;
export const RANGE_WINDOW_DAYS = 30;
export const GLANCE_NIGHTS = 14;

/** The middle 80% (10th to 90th percentile) of `values`, or null with fewer than `minimum`. */
export function usualRange(values: number[], minimum = MIN_RANGE_DAYS): UsualRange | null {
  if (values.length < minimum) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return { low: percentile(sorted, 0.1), high: percentile(sorted, 0.9) };
}

function percentile(sorted: number[], p: number): number {
  const i = (sorted.length - 1) * p;
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
}

const outsideOf = (value: number | null, range: UsualRange | null): GlanceMetric["outside"] =>
  value === null || range === null ? null : value < range.low ? "low" : value > range.high ? "high" : null;

/**
 * Each measure's last `nights` days and its usual range over the `window` days before the latest one.
 * `trend` is recoveryTrend's days (oldest first, may have gaps); `exertion` is exertion by day for days
 * with enough heart rate (healthSummary's byDay).
 */
export function recoveryGlance(input: {
  today: string;
  trend: RecoveryTrendDay[];
  exertion: Map<string, number>;
  nights?: number;
  window?: number;
}): GlanceMetric[] {
  const { today, trend } = input;
  const nights = input.nights ?? GLANCE_NIGHTS;
  const window = input.window ?? RANGE_WINDOW_DAYS;
  const byDay = new Map(trend.map((d) => [d.day, d]));

  const metric = (key: GlanceKey, last: string, read: (day: string) => number | null): GlanceMetric => {
    const days = Array.from({ length: nights }, (_, i) => addDays(last, i - nights + 1));
    const before = Array.from({ length: window }, (_, i) => read(addDays(last, -window + i))).filter((v): v is number => v !== null);
    const range = usualRange(before);
    const value = read(last);
    const outside = outsideOf(value, range);
    return { key, nights: days.map((day) => ({ day, value: read(day) })), value, range, outside, concern: outside !== null && outside === CONCERN_SIDE[key] };
  };
  const field = (pick: (d: RecoveryTrendDay) => number | null) => (day: string) => {
    const d = byDay.get(day);
    return d ? pick(d) : null;
  };

  return [
    metric("hrv", today, field((d) => d.hrv)),
    metric("restingHeartRate", today, field((d) => d.restingHeartRate)),
    metric("sleepHours", today, field((d) => d.sleepHours)),
    metric("respiratoryRate", today, field((d) => d.respiratoryRate)),
    metric("wristTemp", today, field((d) => d.wristTempDeltaC)),
    metric("exertion", addDays(today, -1), (day) => input.exertion.get(day) ?? null),
  ];
}

/** Hours of sleep debt that start to count against today. */
export const SLEEP_DEBT_SIGNAL_HOURS = 4;
/** Wrist temperature above your normal that counts toward illness, °C. */
export const FEVERISH_DELTA_C = 0.5;

/**
 * Warning signs across the last few nights. Last night alone is already in the recovery score, so these
 * look for runs and combinations: HRV under your range three nights running, resting heart rate over
 * it two nights running, breathing rate up together with wrist temperature or resting heart rate (often
 * the start of an illness), and sleep debt. Needs the measures' usual ranges.
 */
export function recoverySignals(metrics: GlanceMetric[], sleepDebtHours: number | null): RecoverySignal[] {
  const get = (key: GlanceKey) => metrics.find((m) => m.key === key);
  const signals: RecoverySignal[] = [];
  const run = (m: GlanceMetric | undefined, side: "low" | "high", count: number) => {
    if (!m?.range) return false;
    const last = m.nights.slice(-count);
    return last.length === count && last.every((n) => n.value !== null && (side === "low" ? n.value < m.range!.low : n.value > m.range!.high));
  };

  const hrv = get("hrv");
  if (run(hrv, "low", 3)) signals.push({ id: "hrvLow", strain: 1, reason: "HRV below your usual range 3 nights running" });

  const rhr = get("restingHeartRate");
  const breathing = get("respiratoryRate");
  const temp = get("wristTemp");
  const breathingUp = breathing?.outside === "high";
  const tempUp = temp?.value != null && temp.value >= FEVERISH_DELTA_C;
  if (breathingUp && (tempUp || rhr?.outside === "high")) {
    const with_ = tempUp ? "wrist temperature" : "resting heart rate";
    signals.push({ id: "illness", strain: 2, reason: `Breathing rate and ${with_} both up: you may be coming down with something` });
  } else if (run(rhr, "high", 2)) {
    signals.push({ id: "restingHrHigh", strain: 1, reason: "Resting heart rate above your usual range 2 nights running" });
  }

  if (sleepDebtHours !== null && sleepDebtHours >= SLEEP_DEBT_SIGNAL_HOURS) {
    signals.push({ id: "sleepDebt", strain: 1, reason: `${formatHours(sleepDebtHours)} of sleep debt this week` });
  }
  return signals;
}

/** The most the signs add to the check-in together, so they don't stack past "easy riding". */
export const MAX_SIGNAL_STRAIN = 3;

function formatHours(hours: number) {
  const total = Math.round(hours * 60);
  return `${Math.floor(total / 60)}h ${String(total % 60).padStart(2, "0")}m`;
}

/** Today's exertion so far, and where the planned ride should land it. */
export interface ExertionToday {
  /** 0 to 10 so far; null without heart rate today. */
  soFar: number | null;
  rideTrimp: number;
  offBikeTrimp: number;
  target: { low: number; high: number } | null;
  /** What today's planned ride should add, from how your rides' stress has turned into exertion. */
  planned: { add: number; landsAt: number } | null;
}

/** TRIMP per point of ride stress (TSS) from past days: the median, from at least 3 days. */
export function trimpPerStress(days: { rideTrimp: number; stress: number }[]): number | null {
  const ratios = days.filter((d) => d.stress >= 10 && d.rideTrimp > 0).map((d) => d.rideTrimp / d.stress);
  if (ratios.length < 3) return null;
  const sorted = ratios.sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Today's exertion against its target. With a planned ride still to come (`plannedStress`) and a known
 * ratio of TRIMP to stress, also where the ride should leave the day.
 */
export function exertionToday(input: {
  today: DayExertion | null;
  target: { low: number; high: number } | null;
  plannedStress: number | null;
  ratio: number | null;
}): ExertionToday {
  const trimp = input.today?.trimp ?? 0;
  const soFar = input.today && input.today.coveredMinutes > 0 ? input.today.exertion : null;
  let planned: ExertionToday["planned"] = null;
  if (input.plannedStress && input.plannedStress > 0 && input.ratio) {
    const landsAt = exertionFromTrimp(trimp + input.ratio * input.plannedStress);
    planned = { add: Math.round((landsAt - (soFar ?? 0)) * 10) / 10, landsAt };
  }
  return {
    soFar,
    rideTrimp: input.today?.rideTrimp ?? 0,
    offBikeTrimp: input.today?.offBikeTrimp ?? 0,
    target: input.target,
    planned,
  };
}
