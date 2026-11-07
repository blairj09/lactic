// Sleep score, sleep debt and regularity from the nights Apple Health sends.

export interface SleepNight {
  day: string;
  asleepHours: number | null;
  awakeHours: number | null;
  deepHours: number | null;
  remHours: number | null;
  /** Unix seconds. */
  start: number | null;
  end: number | null;
  /** Local clock minute (since midnight) of falling asleep, so bedtimes compare in local time. */
  bedMinute?: number;
}

export interface SleepScore {
  /** 0 to 100. */
  score: number;
  parts: { duration: number; efficiency: number | null; restorative: number | null; regularity: number | null };
  /** What the parts are scored from, as plain percentages: sleep of need, time asleep of time in bed, deep + REM of sleep. */
  measures: { ofNeed: number; asleep: number | null; deepRem: number | null };
}

/** Deep plus REM as a share of sleep that scores full marks (adults spend about 40% there). */
const RESTORATIVE_TARGET = 0.4;

/**
 * Last night out of 100: duration against your need (half the score), efficiency (time asleep of time
 * in bed, 20%), deep and REM share (20%) and bedtime regularity against the last two weeks (10%).
 * Parts with no data drop out and the rest are reweighted.
 */
export function sleepScore(night: SleepNight, previous: SleepNight[], sleepNeedHours: number): SleepScore | null {
  if (night.asleepHours === null || sleepNeedHours <= 0) return null;
  const duration = clamp(night.asleepHours / sleepNeedHours, 0, 1) * 100;
  const efficiency =
    night.awakeHours === null ? null : clamp(((night.asleepHours / (night.asleepHours + night.awakeHours)) - 0.75) / 0.2, 0, 1) * 100;
  const restorative =
    night.deepHours === null || night.remHours === null || night.asleepHours <= 0
      ? null
      : clamp((night.deepHours + night.remHours) / night.asleepHours / RESTORATIVE_TARGET, 0, 1) * 100;
  const spread = bedtimeSpreadMinutes([night, ...previous.slice(-13)]);
  const regularity = spread === null ? null : clamp(1 - (spread - 15) / 75, 0, 1) * 100;
  const parts = [
    [duration, 0.5],
    [efficiency, 0.2],
    [restorative, 0.2],
    [regularity, 0.1],
  ] as const;
  let total = 0;
  let weight = 0;
  for (const [v, w] of parts)
    if (v !== null) {
      total += v * w;
      weight += w;
    }
  const r = (v: number | null) => (v === null ? null : Math.round(v));
  const pct = (v: number) => Math.round(v * 100);
  const measures = {
    ofNeed: pct(night.asleepHours / sleepNeedHours),
    asleep: night.awakeHours === null || night.asleepHours + night.awakeHours <= 0 ? null : pct(night.asleepHours / (night.asleepHours + night.awakeHours)),
    deepRem: night.deepHours === null || night.remHours === null || night.asleepHours <= 0 ? null : pct((night.deepHours + night.remHours) / night.asleepHours),
  };
  return {
    score: Math.round(total / weight),
    parts: { duration: Math.round(duration), efficiency: r(efficiency), restorative: r(restorative), regularity: r(regularity) },
    measures,
  };
}

/**
 * Hours of sleep owed: over the last `days` nights, each night's shortfall against your need, less
 * any extra sleep (which pays debt back at half rate). Never below zero.
 */
export function sleepDebt(nights: SleepNight[], sleepNeedHours: number, days = 7): number {
  let debt = 0;
  for (const n of nights.slice(-days)) {
    if (n.asleepHours === null) continue;
    const gap = sleepNeedHours - n.asleepHours;
    debt = Math.max(0, debt + (gap > 0 ? gap : gap / 2));
  }
  return Math.round(debt * 10) / 10;
}

/** Tonight's sleep need: your usual need plus a third of the debt and a little after a big day, at most 1.5 hours more. */
export function sleepNeedTonight(sleepNeedHours: number, debtHours: number, exertion: number | null): number {
  const extra = debtHours / 3 + (exertion !== null && exertion > 6 ? (exertion - 6) * 0.15 : 0);
  return Math.round((sleepNeedHours + Math.min(extra, 1.5)) * 4) / 4;
}

/**
 * Typical spread of bedtimes, minutes: the mean absolute difference from the median bedtime (local
 * clock, wrapped around midnight). Needs 5 nights.
 */
export function bedtimeSpreadMinutes(nights: SleepNight[]): number | null {
  const times = nights.flatMap((n) => {
    if (n.start === null && n.bedMinute === undefined) return [];
    const local = n.bedMinute ?? (n.start! / 60) % 1440;
    // Minutes from noon, so bedtimes either side of midnight sit together.
    return [((local - 720 + 1440) % 1440)];
  });
  if (times.length < 5) return null;
  const sorted = [...times].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  return Math.round(times.reduce((a, t) => a + Math.abs(t - median), 0) / times.length);
}

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);
