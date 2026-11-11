// Recovery: HRV from R-R intervals and the daily recovery score.

import type { ExertionNormal } from "./exertion";
import { formatHours } from "./hours";
import { addDays } from "./pmc";

/**
 * RMSSD in milliseconds from R-R intervals in milliseconds. Successive intervals that differ by more
 * than `artifactThreshold` (fraction) are treated as missed or extra beats and skipped.
 */
export function rmssd(rrIntervalsMs: number[], artifactThreshold = 0.2): number | null {
  let squares = 0;
  let count = 0;
  for (let i = 1; i < rrIntervalsMs.length; i++) {
    const previous = rrIntervalsMs[i - 1];
    const current = rrIntervalsMs[i];
    if (previous <= 0 || current <= 0) continue;
    if (Math.abs(current - previous) / previous > artifactThreshold) continue;
    squares += (current - previous) ** 2;
    count++;
  }
  return count >= 2 ? Math.sqrt(squares / count) : null;
}

/** One morning's inputs. HRV is RMSSD (chest strap) or SDNN (Apple Watch); never mix them in one baseline. */
export interface RecoveryInputs {
  hrv?: number;
  restingHeartRate?: number;
  sleepHours?: number;
  /** Apple Watch sleeping wrist temperature, °C. Compared only with other wrist temperatures. */
  wristTempC?: number;
  /** Breaths per minute during the night. */
  respiratoryRate?: number;
}

/** Last night's wrist temperature against the median of earlier nights, °C. Needs a week of history. */
export function tempDeltaC(today: RecoveryInputs, baseline: RecoveryInputs[]): number | null {
  if (today.wristTempC === undefined) return null;
  const history = baseline.flatMap((d) => (d.wristTempC !== undefined ? [d.wristTempC] : []));
  return history.length >= MINIMUM_TEMP_BASELINE_DAYS ? today.wristTempC - median(history) : null;
}

export const MINIMUM_TEMP_BASELINE_DAYS = 7;

export interface RecoveryScore {
  /** 0 to 100. Around 50 is a normal day for you. */
  score: number;
  /** Plain-language drivers, most important first. */
  reasons: string[];
}

export const MINIMUM_BASELINE_DAYS = 14;

/** Yesterday's exertion and your normal day, for the recovery score. */
export interface PriorLoad {
  exertion: number;
  normal: ExertionNormal;
}

/** The word for a score: thirds of the range. */
export const recoveryWord = (score: number) => (score >= 67 ? "recovered" : score >= 34 ? "normal" : "under-recovered");

/**
 * Version 0 of the recovery score: today against your own rolling baseline.
 * HRV is log-transformed (it is right-skewed) and compared as a z-score; resting HR likewise with the
 * sign flipped; sleep against `sleepNeedHours`; breathing rate as a z-score, sign flipped (it rises when
 * you're run down or getting ill). Weights HRV 0.5, RHR 0.3, sleep 0.2, breathing 0.1.
 * Yesterday's exertion (heart rate all day, rides and the rest) against your normal day counts 0.1,
 * sign flipped, when there is one: a big day costs up to 2, an easy one gives back up to 1.
 * score = 50 + 25 x weighted mean, clamped to 0..100. Returns null without HRV or RHR.
 */
export function recoveryScore(
  today: RecoveryInputs,
  baseline: RecoveryInputs[],
  sleepNeedHours = 8,
  load: PriorLoad | null = null,
): RecoveryScore | null {
  let weighted = 0;
  let totalWeight = 0;
  const reasons: { weight: number; text: string }[] = [];

  const hrvHistory = baseline.flatMap((d) => (d.hrv && d.hrv > 0 ? [Math.log(d.hrv)] : []));
  if (today.hrv && today.hrv > 0 && hrvHistory.length >= MINIMUM_BASELINE_DAYS) {
    const z = zScore(Math.log(today.hrv), hrvHistory);
    if (z !== null) {
      const part = clamp(z, -2, 2);
      weighted += 0.5 * part;
      totalWeight += 0.5;
      reasons.push({ weight: 0.5 * Math.abs(part), text: `HRV ${percentChange(today.hrv, Math.exp(mean(hrvHistory)))} your usual` });
    }
  }

  const rhrHistory = baseline.flatMap((d) => (d.restingHeartRate ? [d.restingHeartRate] : []));
  if (today.restingHeartRate && rhrHistory.length >= MINIMUM_BASELINE_DAYS) {
    const z = zScore(today.restingHeartRate, rhrHistory);
    if (z !== null) {
      const part = clamp(-z, -2, 2);
      weighted += 0.3 * part;
      totalWeight += 0.3;
      const delta = Math.round(today.restingHeartRate - mean(rhrHistory));
      const text = delta === 0 ? "Resting HR at your usual" : `Resting HR ${Math.abs(delta)} bpm ${delta > 0 ? "above" : "below"} usual`;
      reasons.push({ weight: 0.3 * Math.abs(part), text });
    }
  }

  if (today.sleepHours !== undefined && sleepNeedHours > 0) {
    const part = clamp((today.sleepHours / sleepNeedHours - 1) * 4, -2, 1);
    weighted += 0.2 * part;
    totalWeight += 0.2;
    reasons.push({ weight: 0.2 * Math.abs(part), text: `Slept ${formatHours(today.sleepHours)}` });
  }

  const respHistory = baseline.flatMap((d) => (d.respiratoryRate ? [d.respiratoryRate] : []));
  if (today.respiratoryRate && respHistory.length >= MINIMUM_BASELINE_DAYS) {
    const z = zScore(today.respiratoryRate, respHistory);
    if (z !== null) {
      const part = clamp(-z, -2, 2);
      weighted += 0.1 * part;
      totalWeight += 0.1;
      const delta = Math.round((today.respiratoryRate - mean(respHistory)) * 10) / 10;
      const text = Math.abs(delta) < 0.3 ? "Breathing rate at your usual" : `Breathing rate ${Math.abs(delta).toFixed(1)}/min ${delta > 0 ? "above" : "below"} usual`;
      reasons.push({ weight: 0.1 * Math.abs(part), text });
    }
  }

  // Sleep (and yesterday's load) alone isn't a recovery score.
  if (totalWeight < 0.3) return null;
  if (load) {
    const z = (load.exertion - load.normal.mean) / Math.max(load.normal.sd, 0.75);
    const part = clamp(-z, -2, 1);
    weighted += 0.1 * part;
    totalWeight += 0.1;
    const text =
      Math.abs(z) < 0.5
        ? `A usual day yesterday (exertion ${load.exertion.toFixed(1)})`
        : `${z > 0 ? "A big" : "An easy"} day yesterday (exertion ${load.exertion.toFixed(1)}, usual ${load.normal.mean.toFixed(1)})`;
    reasons.push({ weight: 0.1 * Math.abs(part), text });
  }

  // Wrist temperature doesn't change the score; it's shown alongside it.
  let tempNote: string | null = null;
  const deltaC = tempDeltaC(today, baseline);
  if (deltaC !== null && Math.abs(deltaC) >= 0.3) tempNote = `Wrist temp ${deltaC > 0 ? "+" : "−"}${Math.abs(deltaC).toFixed(1)} °C ${deltaC > 0 ? "above" : "below"} usual`;

  const sorted = reasons.sort((a, b) => b.weight - a.weight).map((r) => r.text);
  return {
    score: Math.round(clamp(50 + 25 * (weighted / totalWeight), 0, 100)),
    reasons: tempNote ? [...sorted, tempNote] : sorted,
  };
}

const mean = (values: number[]) => values.reduce((a, b) => a + b, 0) / values.length;
const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};
const clamp = (value: number, low: number, high: number) => Math.min(Math.max(value, low), high);

function zScore(value: number, history: number[]): number | null {
  const m = mean(history);
  const sd = Math.sqrt(history.reduce((acc, v) => acc + (v - m) ** 2, 0) / (history.length - 1));
  return sd > 0 ? (value - m) / sd : null;
}

function percentChange(value: number, typical: number): string {
  const pct = Math.round((value / typical - 1) * 100);
  return pct === 0 ? "at" : `${Math.abs(pct)}% ${pct > 0 ? "above" : "below"}`;
}

/** One stored morning, as recovery_days holds it. */
export interface RecoveryDay extends RecoveryInputs {
  day: string;
  hrvKind: "rmssd" | "sdnn" | null;
}

export interface RecoveryTrendDay {
  day: string;
  score: number | null;
  hrv: number | null;
  restingHeartRate: number | null;
  sleepHours: number | null;
  /** Wrist temperature against your normal, °C. */
  wristTempDeltaC: number | null;
  respiratoryRate: number | null;
}

/** Your normal over the baseline window: the reference lines on the Health charts. */
export interface RecoveryNormals {
  hrv: number | null;
  restingHeartRate: number | null;
  sleepHours: number | null;
  respiratoryRate: number | null;
}

/**
 * Each day from `from` on, scored against the `baselineDays` before it, exactly as that morning's score
 * was. HRV compares like with like (RMSSD vs SDNN). `normals` are taken over the window before the last
 * day, in the last day's HRV kind. `rows` oldest first.
 */
export function recoveryTrend(
  rows: RecoveryDay[],
  from: string,
  sleepNeedHours = 8,
  baselineDays = 60,
  /** Each morning's prior-day exertion, when daytime heart rate is in. */
  loadFor: (day: string) => PriorLoad | null = () => null,
): { days: RecoveryTrendDay[]; normals: RecoveryNormals } {
  const windowBefore = (day: string) => {
    const start = addDays(day, -baselineDays);
    return rows.filter((r) => r.day >= start && r.day < day);
  };
  const asBaseline = (window: RecoveryDay[], kind: RecoveryDay["hrvKind"]): RecoveryInputs[] =>
    window.map((r) => ({
      hrv: r.hrvKind === kind ? r.hrv : undefined,
      restingHeartRate: r.restingHeartRate,
      wristTempC: r.wristTempC,
      respiratoryRate: r.respiratoryRate,
    }));

  const days = rows
    .filter((r) => r.day >= from)
    .map((r): RecoveryTrendDay => {
      const window = windowBefore(r.day);
      return {
        day: r.day,
        score: recoveryScore(r, asBaseline(window, r.hrvKind), sleepNeedHours, loadFor(r.day))?.score ?? null,
        hrv: r.hrv ?? null,
        restingHeartRate: r.restingHeartRate ?? null,
        sleepHours: r.sleepHours ?? null,
        wristTempDeltaC: tempDeltaC(r, window),
        respiratoryRate: r.respiratoryRate ?? null,
      };
    });

  const last = rows.at(-1);
  const window = last ? windowBefore(last.day) : [];
  const hrvs = window.flatMap((d) => (d.hrvKind === last?.hrvKind && d.hrv && d.hrv > 0 ? [Math.log(d.hrv)] : []));
  const rhrs = window.flatMap((d) => (d.restingHeartRate ? [d.restingHeartRate] : []));
  const sleeps = window.flatMap((d) => (d.sleepHours !== undefined ? [d.sleepHours] : []));
  const resps = window.flatMap((d) => (d.respiratoryRate ? [d.respiratoryRate] : []));
  return {
    days,
    normals: {
      hrv: hrvs.length >= MINIMUM_BASELINE_DAYS ? Math.exp(mean(hrvs)) : null,
      restingHeartRate: rhrs.length >= MINIMUM_BASELINE_DAYS ? mean(rhrs) : null,
      sleepHours: sleeps.length >= MINIMUM_TEMP_BASELINE_DAYS ? mean(sleeps) : null,
      respiratoryRate: resps.length >= MINIMUM_TEMP_BASELINE_DAYS ? mean(resps) : null,
    },
  };
}
