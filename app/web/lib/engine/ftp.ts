import { powerCurve, type PowerCurve } from "./power";

export interface FtpEstimate {
  watts: number;
  /** criticalPower: 2-parameter fit over 3 to 20 minute efforts. twentyMinute: 95% of best 20 minutes. */
  method: "criticalPower" | "twentyMinute";
  /** Anaerobic work capacity in joules, when the critical power fit produced one. */
  wPrime?: number;
}

/** Short efforts are dominated by W', long ones by fatigue, so the fit uses the middle. */
export const FIT_DURATIONS = [180, 300, 480, 600, 720, 1200];

/**
 * Estimates FTP from a power curve. Prefers a critical power fit (work = CP x t + W'),
 * falls back to 95% of 20 minute power, and returns null without enough data.
 */
export function estimateFtp(curve: PowerCurve): FtpEstimate | null {
  const points = FIT_DURATIONS.filter((d) => curve[d] !== undefined).map((d) => [d, curve[d] * d] as const);
  if (points.length >= 3) {
    const fit = linearFit(points);
    // CP sits close to FTP for most riders; treat them as equal until test data lets us calibrate.
    if (fit && fit.slope > 0 && fit.intercept >= 0) {
      return { watts: fit.slope, method: "criticalPower", wPrime: fit.intercept };
    }
  }
  if (curve[1200] !== undefined) return { watts: curve[1200] * 0.95, method: "twentyMinute" };
  return null;
}

export function linearFit(points: ReadonlyArray<readonly [number, number]>): { slope: number; intercept: number } | null {
  const n = points.length;
  let sx = 0, sy = 0, sxy = 0, sxx = 0;
  for (const [x, y] of points) {
    sx += x;
    sy += y;
    sxy += x * y;
    sxx += x * x;
  }
  const denominator = n * sxx - sx * sx;
  if (denominator === 0) return null;
  const slope = (n * sxy - sx * sy) / denominator;
  return { slope, intercept: (sy - slope * sx) / n };
}

/** Ramp test FTP is this share of the best minute. */
export const RAMP_TEST_FACTOR = 0.75;
/** The ramp test's warm-up plus three steps: a ride stopped sooner hasn't tested anything. */
const RAMP_TEST_MIN_SECONDS = 480 + 180;

/** FTP from a ramp test ride (1 Hz watts): 75% of its best minute, or null if it ended too soon. */
export function rampTestFtp(watts: number[]): { watts: number; bestMinute: number } | null {
  if (watts.length < RAMP_TEST_MIN_SECONDS) return null;
  const bestMinute = powerCurve(watts, [60])[60];
  if (!bestMinute) return null;
  const ftp = Math.round(bestMinute * RAMP_TEST_FACTOR);
  return ftp > 50 && ftp < 700 ? { watts: ftp, bestMinute: Math.round(bestMinute) } : null;
}

/** 20-minute test FTP is this share of the best 20 minutes. */
export const TWENTY_MINUTE_TEST_FACTOR = 0.95;

/** FTP from a 20-minute test ride (1 Hz watts): 95% of its best 20 minutes, or null without 20 minutes ridden. */
export function twentyMinuteTestFtp(watts: number[]): { watts: number; best: number } | null {
  if (watts.length < 1200) return null;
  const best = powerCurve(watts, [1200])[1200];
  if (!best) return null;
  const ftp = Math.round(best * TWENTY_MINUTE_TEST_FACTOR);
  return ftp > 50 && ftp < 700 ? { watts: ftp, best: Math.round(best) } : null;
}
