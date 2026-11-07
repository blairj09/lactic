/**
 * Reads intervals.icu wellness records: the overnight numbers intervals.icu collects from Garmin, Oura,
 * WHOOP, Polar, Coros, Suunto and others. One record per date, keyed by its `id` (YYYY-MM-DD).
 *
 * These only fill in: a morning another source already measured (Apple Health, say) keeps its own
 * numbers, and intervals.icu fills the fields that source left empty.
 */

/** The fields Lactic reads from an intervals.icu wellness record. All optional; intervals.icu leaves out what it doesn't have. */
export interface IntervalsWellness {
  id: string;
  restingHR?: number | null;
  /** RMSSD, ms (what Garmin, Oura, WHOOP and Polar report). */
  hrv?: number | null;
  /** SDNN, ms (what Apple Watch reports). */
  hrvSDNN?: number | null;
  sleepSecs?: number | null;
  respiration?: number | null;
  weight?: number | null;
  bodyFat?: number | null;
}

export interface WellnessDay {
  day: string;
  hrvMs: number | null;
  hrvKind: "rmssd" | "sdnn" | null;
  restingHr: number | null;
  sleepHours: number | null;
  respiratoryRate: number | null;
  weightKg: number | null;
  bodyFatPct: number | null;
}

const inRange = (v: unknown, lo: number, hi: number) => (typeof v === "number" && Number.isFinite(v) && v >= lo && v <= hi ? v : null);

/** Wellness records as days, oldest first. Records with nothing Lactic uses are dropped. */
export function wellnessDays(records: IntervalsWellness[]): WellnessDay[] {
  const days: WellnessDay[] = [];
  for (const r of records) {
    if (typeof r.id !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(r.id)) continue;
    const rmssd = inRange(r.hrv, 1, 400);
    const sdnn = inRange(r.hrvSDNN, 1, 400);
    const sleepSecs = inRange(r.sleepSecs, 0, 24 * 3600);
    const d: WellnessDay = {
      day: r.id,
      hrvMs: rmssd ?? sdnn,
      hrvKind: rmssd !== null ? "rmssd" : sdnn !== null ? "sdnn" : null,
      restingHr: inRange(r.restingHR, 25, 150),
      // Zero means no sleep was recorded, not a sleepless night.
      sleepHours: sleepSecs ? Math.round((sleepSecs / 3600) * 100) / 100 : null,
      respiratoryRate: inRange(r.respiration, 4, 40),
      weightKg: inRange(r.weight, 20, 300),
      bodyFatPct: inRange(r.bodyFat, 2, 70),
    };
    if (d.hrvMs !== null || d.restingHr !== null || d.sleepHours !== null || d.respiratoryRate !== null || d.weightKg !== null) days.push(d);
  }
  return days.sort((a, b) => a.day.localeCompare(b.day));
}

/** A recovery_days row as far as this merge cares. */
export interface RecoveryRow {
  day: string;
  hrv_ms: number | null;
  hrv_kind: string | null;
  resting_hr: number | null;
  sleep_hours: number | null;
  respiratory_rate: number | null;
  source: string;
}

export const WELLNESS_SOURCE = "intervals";

/**
 * The row to write for a wellness day, or null when nothing would change. A day intervals.icu owns
 * takes its new numbers; a day another source owns only gets the fields it was missing.
 */
export function mergeWellness(existing: RecoveryRow | undefined, w: WellnessDay): RecoveryRow | null {
  const ours = !existing || existing.source === WELLNESS_SOURCE;
  const pick = <T>(theirs: T | null | undefined, mine: T | null) => (ours ? (mine ?? theirs ?? null) : (theirs ?? mine ?? null));
  // HRV value and kind travel together.
  const keepHrv = !ours && existing?.hrv_ms != null;
  const row: RecoveryRow = {
    day: w.day,
    hrv_ms: keepHrv ? existing!.hrv_ms : (w.hrvMs ?? existing?.hrv_ms ?? null),
    hrv_kind: keepHrv ? existing!.hrv_kind : w.hrvMs !== null ? w.hrvKind : (existing?.hrv_kind ?? null),
    resting_hr: pick(existing?.resting_hr, w.restingHr),
    sleep_hours: pick(existing?.sleep_hours, w.sleepHours),
    respiratory_rate: pick(existing?.respiratory_rate, w.respiratoryRate),
    source: existing?.source ?? WELLNESS_SOURCE,
  };
  if (row.hrv_ms === null && row.resting_hr === null && row.sleep_hours === null && row.respiratory_rate === null) return null;
  if (
    existing &&
    num(existing.hrv_ms) === num(row.hrv_ms) &&
    existing.hrv_kind === row.hrv_kind &&
    num(existing.resting_hr) === num(row.resting_hr) &&
    num(existing.sleep_hours) === num(row.sleep_hours) &&
    num(existing.respiratory_rate) === num(row.respiratory_rate)
  )
    return null;
  return row;
}

const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
