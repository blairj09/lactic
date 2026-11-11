import { addDays } from "./engine/pmc";
import { MINIMUM_BASELINE_DAYS, recoveryScore, recoveryTrend, type RecoveryDay, type RecoveryInputs, type RecoveryNormals, type RecoveryScore, type RecoveryTrendDay } from "./engine/recovery";
import type { SleepSegment, SleepStage } from "./engine/health-import";
import { localMinute, priorLoad, type Daytime } from "./daytime-data";
import { GLANCE_NIGHTS, RANGE_WINDOW_DAYS, recoveryGlance, recoverySignals, type GlanceMetric, type RecoverySignal } from "./engine/recovery-glance";
import { MIN_COVERED_MINUTES } from "./engine/exertion";
import { sleepDebt, sleepNeedTonight, sleepScore, type SleepNight, type SleepScore } from "./engine/sleep-score";
import type { createClient } from "./supabase/server";

type Supabase = Awaited<ReturnType<typeof createClient>>;

const BASELINE_DAYS = 60;

export interface RecoveryToday {
  /** Today's inputs, if the shortcut has sent any. */
  today: (RecoveryInputs & { hrvKind: "rmssd" | "sdnn" | null }) | null;
  score: RecoveryScore | null;
  /** Days of history behind the HRV baseline, so the page can say how long until a score. */
  baselineDays: number;
  /** Last night's stages and times, when the source records them. */
  sleep: SleepDetail | null;
  /** Where last night's numbers came from (apple_health, shortcut, intervals). */
  source: string | null;
  /** Last night against recent weeks, for Today's Last night card and the warning signs. */
  glance: RecoveryGlance;
}

export interface RecoveryGlance {
  /** HRV, resting HR, sleep, breathing, wrist temperature and yesterday's exertion: two weeks each, with your usual range. */
  metrics: GlanceMetric[];
  /** Runs of poor nights and signs of illness that today's options and the coach take into account. */
  signals: RecoverySignal[];
  /** The last 7 mornings' recovery scores, oldest first (null where there was none). */
  scores: { day: string; score: number | null }[];
  sleepScore: SleepScore | null;
  sleepDebtHours: number | null;
  sleepNeedTonight: number;
}

export interface SleepDetail {
  deepHours: number | null;
  remHours: number | null;
  coreHours: number | null;
  awakeHours: number | null;
  /** ISO times asleep and awake. */
  start: string | null;
  end: string | null;
  /** The night's stage timeline (unix seconds), oldest first. Empty when the source sends totals only. */
  segments: SleepSegment[];
}

const STAGES: SleepStage[] = ["deep", "rem", "core", "asleep", "awake"];

/** Reads the stored `[[start, end, stage], ...]` timeline, dropping anything malformed. */
export function readSegments(value: unknown): SleepSegment[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((g) =>
    Array.isArray(g) && typeof g[0] === "number" && typeof g[1] === "number" && g[1] > g[0] && STAGES.includes(g[2])
      ? [{ start: g[0], end: g[1], stage: g[2] as SleepStage }]
      : [],
  );
}

/**
 * Today's recovery against your own last 60 days. HRV only compares like with like (RMSSD vs SDNN).
 * With `daytime`, yesterday's exertion counts too.
 */
export async function loadRecovery(
  supabase: Supabase,
  today: string,
  sleepNeedHours: number,
  daytimeLoad: Daytime | null | Promise<Daytime | null> = null,
  /** For bedtimes in the sleep score's regularity; UTC without it. */
  timeZone?: string,
): Promise<RecoveryToday> {
  // The glance's oldest night needs its own month of range and two months of baseline behind it.
  const firstTrendDay = addDays(today, -(GLANCE_NIGHTS + RANGE_WINDOW_DAYS));
  // `daytime` may still be loading: the rows are read meanwhile.
  const [{ data, error }, daytime] = await Promise.all([
    supabase
      .from("recovery_days")
      .select("day, hrv_ms, hrv_kind, resting_hr, sleep_hours, sleep_deep_hours, sleep_rem_hours, sleep_core_hours, sleep_awake_hours, sleep_start, sleep_end, wrist_temp_c, respiratory_rate, sleep_segments, source")
      .gte("day", addDays(firstTrendDay, -BASELINE_DAYS))
      .lte("day", today)
      .order("day"),
    daytimeLoad,
  ]);
  if (error) throw error;

  const num = (v: string | number | null) => (v === null ? undefined : Number(v));
  const row = data.find((r) => r.day === today);
  const kind = row?.hrv_kind ?? null;
  const baselineStart = addDays(today, -BASELINE_DAYS);
  const baseline: RecoveryInputs[] = data
    .filter((r) => r.day >= baselineStart && r.day < today)
    .map((r) => ({
      hrv: r.hrv_kind === kind ? num(r.hrv_ms) : undefined,
      restingHeartRate: num(r.resting_hr),
      wristTempC: num(r.wrist_temp_c),
      respiratoryRate: num(r.respiratory_rate),
    }));
  const todayInputs = row
    ? {
        hrv: num(row.hrv_ms),
        restingHeartRate: num(row.resting_hr),
        sleepHours: num(row.sleep_hours),
        wristTempC: num(row.wrist_temp_c),
        respiratoryRate: num(row.respiratory_rate),
        hrvKind: kind,
      }
    : null;

  const score = todayInputs ? recoveryScore(todayInputs, baseline, sleepNeedHours, daytime ? priorLoad(daytime.days, today) : null) : null;
  return {
    today: todayInputs,
    score,
    baselineDays: Math.min(baseline.filter((b) => b.hrv !== undefined).length, MINIMUM_BASELINE_DAYS),
    sleep: row ? sleepDetail(row) : null,
    source: row?.source ?? null,
    glance: glanceFrom(data, today, sleepNeedHours, daytime, timeZone),
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function glanceFrom(data: any[], today: string, sleepNeedHours: number, daytime: Daytime | null, timeZone?: string): RecoveryGlance {
  const num = (v: string | number | null) => (v === null || v === undefined ? undefined : Number(v));
  const rows: RecoveryDay[] = data.map((r) => ({
    day: r.day,
    hrvKind: r.hrv_kind ?? null,
    hrv: num(r.hrv_ms),
    restingHeartRate: num(r.resting_hr),
    sleepHours: num(r.sleep_hours),
    wristTempC: num(r.wrist_temp_c),
    respiratoryRate: num(r.respiratory_rate),
  }));
  const loadFor = (day: string) => (daytime ? priorLoad(daytime.days, day) : null);
  const trend = recoveryTrend(rows, addDays(today, -(GLANCE_NIGHTS + RANGE_WINDOW_DAYS)), sleepNeedHours, BASELINE_DAYS, loadFor).days;
  const exertion = new Map((daytime?.days ?? []).filter((d) => d.coveredMinutes >= MIN_COVERED_MINUTES || d.rideTrimp > 0).map((d) => [d.day, d.exertion]));
  const metrics = recoveryGlance({ today, trend, exertion });

  const n = (v: string | number | null) => (v === null || v === undefined ? null : Number(v));
  const nights: SleepNight[] = data
    .filter((r) => r.day >= addDays(today, -21) && r.sleep_hours !== null)
    .map((r) => ({
      day: r.day,
      asleepHours: n(r.sleep_hours),
      awakeHours: n(r.sleep_awake_hours),
      deepHours: n(r.sleep_deep_hours),
      remHours: n(r.sleep_rem_hours),
      start: r.sleep_start ? Date.parse(r.sleep_start) / 1000 : null,
      end: r.sleep_end ? Date.parse(r.sleep_end) / 1000 : null,
      bedMinute: r.sleep_start && timeZone ? localMinute(new Date(r.sleep_start), timeZone) : undefined,
    }));
  const i = nights.findIndex((x) => x.day === today);
  const debt = nights.length ? sleepDebt(nights, sleepNeedHours, 7, today) : null;
  const todayExertion = daytime?.days.find((d) => d.day === today)?.exertion ?? null;
  const byDay = new Map(trend.map((d) => [d.day, d.score]));
  return {
    metrics,
    signals: recoverySignals(metrics, debt),
    scores: Array.from({ length: 7 }, (_, k) => {
      const day = addDays(today, k - 6);
      return { day, score: byDay.get(day) ?? null };
    }),
    sleepScore: i < 0 ? null : sleepScore(nights[i], nights.slice(0, i), sleepNeedHours),
    sleepDebtHours: debt,
    sleepNeedTonight: sleepNeedTonight(sleepNeedHours, debt ?? 0, todayExertion),
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function sleepDetail(row: any): SleepDetail | null {
  const n = (v: string | number | null) => (v === null || v === undefined ? null : Number(v));
  const detail: SleepDetail = {
    deepHours: n(row.sleep_deep_hours),
    remHours: n(row.sleep_rem_hours),
    coreHours: n(row.sleep_core_hours),
    awakeHours: n(row.sleep_awake_hours),
    start: row.sleep_start ?? null,
    end: row.sleep_end ?? null,
    segments: readSegments(row.sleep_segments),
  };
  const { segments, ...rest } = detail;
  return segments.length || Object.values(rest).some((v) => v !== null) ? detail : null;
}

/** One night as the sleep score reads it; times are ISO. */
export interface SleepNightRow {
  day: string;
  asleepHours: number | null;
  awakeHours: number | null;
  deepHours: number | null;
  remHours: number | null;
  start: string | null;
  end: string | null;
}

/** One night's hours in each stage, for the stacked stage chart. */
export interface StageNight {
  day: string;
  deepHours: number | null;
  remHours: number | null;
  coreHours: number | null;
  awakeHours: number | null;
}

/** The last `days` mornings (today included), each scored as it was that morning, plus your current normals. */
export async function loadRecoveryTrend(
  supabase: Supabase,
  today: string,
  sleepNeedHours: number,
  days = 30,
  daytimeLoad: Daytime | null | Promise<Daytime | null> = null,
): Promise<{ days: RecoveryTrendDay[]; normals: RecoveryNormals; stages: StageNight[]; nights: SleepNightRow[] }> {
  const from = addDays(today, -(days - 1));
  const [{ data, error }, daytime] = await Promise.all([
    supabase
      .from("recovery_days")
      .select("day, hrv_ms, hrv_kind, resting_hr, sleep_hours, wrist_temp_c, respiratory_rate, sleep_deep_hours, sleep_rem_hours, sleep_core_hours, sleep_awake_hours, sleep_start, sleep_end")
      .gte("day", addDays(from, -BASELINE_DAYS))
      .lte("day", today)
      .order("day"),
    daytimeLoad,
  ]);
  if (error) throw error;
  const num = (v: string | number | null) => (v === null ? undefined : Number(v));
  const rows: RecoveryDay[] = data.map((r) => ({
    day: r.day,
    hrvKind: (r.hrv_kind as RecoveryDay["hrvKind"]) ?? null,
    hrv: num(r.hrv_ms),
    restingHeartRate: num(r.resting_hr),
    sleepHours: num(r.sleep_hours),
    wristTempC: num(r.wrist_temp_c),
    respiratoryRate: num(r.respiratory_rate),
  }));
  const n = (v: string | number | null) => (v === null ? null : Number(v));
  const stages: StageNight[] = data
    .filter((r) => r.day >= from && (r.sleep_deep_hours !== null || r.sleep_rem_hours !== null || r.sleep_core_hours !== null))
    .map((r) => ({ day: r.day, deepHours: n(r.sleep_deep_hours), remHours: n(r.sleep_rem_hours), coreHours: n(r.sleep_core_hours), awakeHours: n(r.sleep_awake_hours) }));
  const nights: SleepNightRow[] = data
    .filter((r) => r.day >= addDays(from, -14) && r.sleep_hours !== null)
    .map((r) => ({
      day: r.day,
      asleepHours: n(r.sleep_hours),
      awakeHours: n(r.sleep_awake_hours),
      deepHours: n(r.sleep_deep_hours),
      remHours: n(r.sleep_rem_hours),
      start: r.sleep_start ?? null,
      end: r.sleep_end ?? null,
    }));
  const loadFor = (day: string) => (daytime ? priorLoad(daytime.days, day) : null);
  return { ...recoveryTrend(rows, from, sleepNeedHours, BASELINE_DAYS, loadFor), stages, nights };
}

/** Makes a new shortcut token, replacing any old one. Only its hash is stored; the token is shown once. */
export async function createIngestToken(supabase: Supabase, userId: string): Promise<string> {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const token = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token)));
  const hash = Array.from(digest, (b) => b.toString(16).padStart(2, "0")).join("");
  const { error } = await supabase
    .from("ingest_tokens")
    .upsert({ user_id: userId, token_hash: hash, created_at: new Date().toISOString(), last_used_at: null }, { onConflict: "user_id" });
  if (error) throw error;
  return token;
}

export async function loadIngestToken(supabase: Supabase): Promise<{ createdAt: Date; lastUsedAt: Date | null } | null> {
  const { data, error } = await supabase.from("ingest_tokens").select("created_at, last_used_at").maybeSingle();
  if (error) throw error;
  return data ? { createdAt: new Date(data.created_at), lastUsedAt: data.last_used_at ? new Date(data.last_used_at) : null } : null;
}
