// Heart rate recovery: how far heart rate falls in the minute after a hard effort, when the rider
// eases off. A bigger drop means a fitter, fresher heart; one well below your usual can mean
// fatigue. Read from a ride's chart stream, so it works for rides from anywhere with power and HR.

/** Power from this share of FTP up, held for `MIN_EFFORT_SECONDS`, is a hard effort. */
export const EFFORT_SHARE = 0.88;
/** The shortest effort worth reading a recovery after. */
export const MIN_EFFORT_SECONDS = 60;
/** Easier dips inside an effort up to this long don't end it. */
const BRIDGE_SECONDS = 15;
/** Seconds after the effort the drop is read at. */
export const RECOVERY_SECONDS = 60;
/** The minute after counts only if power stays under this share of FTP (the rider eased off). */
const EASY_SHARE = 0.65;
/** Heart rate peaks a little after the effort ends; look this far either side for the peak. */
const PEAK_BEFORE = 30;
const PEAK_AFTER = 15;
/** Rides with at least this many readings make a usual. */
export const USUAL_MIN_RIDES = 3;

export interface HrRecoveryEffort {
  /** Ride seconds the effort ran over, [start, end). */
  from: number;
  to: number;
  /** Mean watts over the effort. */
  watts: number;
  /** Highest heart rate around the end of the effort. */
  peak: number;
  /** Heart rate a minute after the effort ended. */
  after: number;
  /** Beats per minute it fell: peak minus after. */
  drop: number;
}

export interface HrRecovery {
  efforts: HrRecoveryEffort[];
  /** Mean drop over the efforts, in bpm. */
  drop: number;
}

/**
 * Each hard effort in a ride (power at `EFFORT_SHARE` of FTP or more for a minute or longer) that
 * was followed by a minute of easy riding, with heart rate at its peak and a minute later. Null
 * when the ride has no such effort, no power or no heart rate.
 */
export function hrRecovery(
  stream: { step: number; watts: (number | null)[] | null; heartRate: (number | null)[] | null },
  ftp: number | null,
): HrRecovery | null {
  const { step, watts, heartRate } = stream;
  if (!ftp || ftp <= 0 || !watts?.length || !heartRate?.some((h) => (h ?? 0) > 0) || step <= 0) return null;
  const hard = watts.map((w) => (w ?? 0) >= EFFORT_SHARE * ftp);
  const bridge = Math.floor(BRIDGE_SECONDS / step);
  const window = Math.round(RECOVERY_SECONDS / step);

  // Runs of hard points, bridged across short dips.
  const runs: [number, number][] = [];
  for (let i = 0; i < hard.length; i++) {
    if (!hard[i]) continue;
    const last = runs.at(-1);
    if (last && i - last[1] <= bridge) last[1] = i + 1;
    else runs.push([i, i + 1]);
  }

  const hr = (i: number) => {
    const v = heartRate[i];
    return v && v > 0 ? v : null;
  };
  const efforts: HrRecoveryEffort[] = [];
  for (const [start, end] of runs) {
    if ((end - start) * step < MIN_EFFORT_SECONDS) continue;
    // The minute after must be there, easy, and free of the next effort.
    if (end + window > watts.length) continue;
    const after = watts.slice(end, end + window).map((w) => w ?? 0);
    if (hard.slice(end, end + window).some(Boolean)) continue;
    if (after.reduce((a, b) => a + b, 0) / after.length > EASY_SHARE * ftp) continue;

    const around: number[] = [];
    for (let i = Math.max(start, end - Math.round(PEAK_BEFORE / step)); i < end + Math.round(PEAK_AFTER / step); i++) {
      const v = hr(i);
      if (v !== null) around.push(v);
    }
    // The reading a minute on, steadied with the point either side.
    const later = [end + window - 1, end + window, end + window + 1].flatMap((i) => (i < heartRate.length && hr(i) !== null ? [hr(i)!] : []));
    if (!around.length || !later.length) continue;
    const peak = Math.max(...around);
    const at = Math.round(later.reduce((a, b) => a + b, 0) / later.length);
    const effortWatts = watts.slice(start, end).map((w) => w ?? 0);
    efforts.push({
      from: start * step,
      to: end * step,
      watts: Math.round(effortWatts.reduce((a, b) => a + b, 0) / effortWatts.length),
      peak,
      after: at,
      drop: Math.max(0, peak - at),
    });
  }
  if (!efforts.length) return null;
  return { efforts, drop: Math.round(efforts.reduce((a, e) => a + e.drop, 0) / efforts.length) };
}

export interface UsualHrRecovery {
  /** The middle ride's drop, in bpm. */
  drop: number;
  rides: number;
}

/** Your usual drop: the median of earlier rides' drops. Null with fewer than `USUAL_MIN_RIDES`. */
export function usualHrRecovery(drops: number[]): UsualHrRecovery | null {
  if (drops.length < USUAL_MIN_RIDES) return null;
  const sorted = [...drops].sort((a, b) => a - b);
  const mid = sorted.length / 2;
  const drop = sorted.length % 2 ? sorted[Math.floor(mid)] : (sorted[mid - 1] + sorted[mid]) / 2;
  return { drop: Math.round(drop), rides: drops.length };
}

/** How a ride's drop compares with your usual: a few beats either way is the same. */
export function recoveryAgainstUsual(drop: number, usual: UsualHrRecovery | null): "faster" | "usual" | "slower" | null {
  if (!usual) return null;
  const gap = drop - usual.drop;
  return gap >= 4 ? "faster" : gap <= -4 ? "slower" : "usual";
}
