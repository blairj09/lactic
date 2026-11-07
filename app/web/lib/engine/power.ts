// Ride-level power metrics from 1 Hz power samples (watts).

/** Normalized power: 30 s rolling average, raised to the 4th power, averaged, then 4th root. */
export function normalizedPower(watts: number[], window = 30): number | null {
  if (window <= 0 || watts.length < window) return null;
  let sum = 0;
  for (let i = 0; i < window; i++) sum += watts[i];
  let fourth = (sum / window) ** 4;
  let count = 1;
  for (let i = window; i < watts.length; i++) {
    sum += watts[i] - watts[i - window];
    fourth += (sum / window) ** 4;
    count++;
  }
  return (fourth / count) ** 0.25;
}

export function intensityFactor(np: number, ftp: number): number {
  return ftp > 0 ? np / ftp : 0;
}

/** Training stress score. One hour at FTP is 100. */
export function trainingStress(durationSeconds: number, np: number, ftp: number): number {
  if (ftp <= 0) return 0;
  return ((durationSeconds * np * intensityFactor(np, ftp)) / (ftp * 3600)) * 100;
}

export function rideStress(watts: number[], ftp: number): number | null {
  const np = normalizedPower(watts);
  return np === null ? null : trainingStress(watts.length, np, ftp);
}

export const STANDARD_DURATIONS = [1, 5, 15, 30, 60, 120, 180, 300, 480, 600, 720, 1200, 1800, 2400, 3600];

/** Duration in seconds mapped to best average watts (mean-maximal power). */
export type PowerCurve = Record<number, number>;

export function powerCurve(watts: number[], durations = STANDARD_DURATIONS): PowerCurve {
  const prefix = new Float64Array(watts.length + 1);
  for (let i = 0; i < watts.length; i++) prefix[i + 1] = prefix[i] + watts[i];
  const curve: PowerCurve = {};
  for (const d of durations) {
    if (d <= 0 || d > watts.length) continue;
    let top = 0;
    for (let end = d; end <= watts.length; end++) top = Math.max(top, prefix[end] - prefix[end - d]);
    curve[d] = top / d;
  }
  return curve;
}

/** Keeps the higher value at each duration, so curves from many rides combine into one. */
export function mergeCurves(...curves: PowerCurve[]): PowerCurve {
  const merged: PowerCurve = {};
  for (const curve of curves) {
    for (const [d, w] of Object.entries(curve)) {
      const key = Number(d);
      merged[key] = Math.max(merged[key] ?? 0, w);
    }
  }
  return merged;
}

/** Width of the stored power histogram's bins, in watts. */
export const POWER_BIN_WATTS = 10;

/**
 * Seconds spent in each power bin: index i counts samples in [i x width, (i + 1) x width) watts.
 * Trailing empty bins are left off, so the array ends at the ride's top bin.
 */
export function powerHistogram(watts: number[], width = POWER_BIN_WATTS): number[] {
  const bins: number[] = [];
  for (const w of watts) {
    if (!Number.isFinite(w) || w < 0) continue;
    const i = Math.floor(w / width);
    while (bins.length <= i) bins.push(0);
    bins[i]++;
  }
  return bins;
}

/** Adds histograms bin by bin. */
export function sumHistograms(...histograms: number[][]): number[] {
  const total: number[] = [];
  for (const h of histograms) {
    for (let i = 0; i < h.length; i++) total[i] = (total[i] ?? 0) + h[i];
  }
  return Array.from(total, (v) => v ?? 0);
}
