import { loadRides, type Athlete } from "./activities";
import { localDate } from "./engine/activity";
import { ageOn } from "./engine/body";
import {
  dayExertion,
  estimatedMaxHr,
  exertionNormal,
  MIN_COVERED_MINUTES,
  streamMinutes,
  type DayExertion,
  type ExertionNormal,
  type HeartProfile,
  type RideMinutes,
} from "./engine/exertion";
import { MINUTES_PER_DAY } from "./engine/health-import";
import { addDays } from "./engine/pmc";
import type { PriorLoad } from "./engine/recovery";
import type { createClient } from "./supabase/server";

type Supabase = Awaited<ReturnType<typeof createClient>>;

/** Apple Health's daytime data and the rides, as exertion per day. */
export interface Daytime {
  /** Every day from the window's start to today with heart rate or a ride, oldest first. */
  days: DayExertion[];
  /** Active energy and steps by day. */
  activity: Map<string, { activeKcal: number | null; steps: number | null }>;
  /** Apple's latest VO2 max, if the watch has measured one. */
  appleVo2max: { day: string; value: number } | null;
  heart: HeartProfile;
  /** True once any daytime heart rate has arrived from Health. */
  hasWatch: boolean;
}

/** Days of daytime data loaded: the trend plus a month for the normal before it. */
export const DAYTIME_DAYS = 60;

/** Minute of the local day an instant falls on. */
export function localMinute(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(instant);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  return get("hour") * 60 + get("minute");
}

export async function loadDaytime(supabase: Supabase, athlete: Athlete, today: string, days = DAYTIME_DAYS): Promise<Daytime> {
  const tz = athlete.timezone;
  const from = addDays(today, -(days - 1));
  const [health, rides, rest] = await Promise.all([
    supabase.from("health_days").select("day, hr_minutes, active_kcal, steps, vo2max").gte("day", from).lte("day", today).order("day"),
    loadRides(supabase, new Date(`${addDays(from, -1)}T00:00:00Z`)),
    supabase.from("recovery_days").select("resting_hr").gte("day", addDays(today, -30)).lte("day", today).not("resting_hr", "is", null),
  ]);
  // Before the table exists (or on any read error) the page still works, with rides only.
  if (health.error) console.error(health.error);
  const healthRows = health.error ? [] : (health.data ?? []);

  const rhrs = (rest.data ?? []).map((r) => Number(r.resting_hr)).filter((v) => v > 0);
  const age = athlete.birthDate ? ageOn(athlete.birthDate, today) : null;
  const heart: HeartProfile = {
    restingHr: rhrs.length ? rhrs.reduce((a, b) => a + b, 0) / rhrs.length : 60,
    maxHr: athlete.maxHr ?? (age !== null ? estimatedMaxHr(age) : 185),
    male: athlete.sex !== "female",
  };

  const inWindow = rides.filter((r) => localDate(r.startedAt, tz) >= from);
  const streams = new Map<string, { step: number; heartRate: number[] | null }>();
  for (let i = 0; i < inWindow.length; i += 20) {
    const ids = inWindow.slice(i, i + 20).map((r) => r.id);
    const { data, error } = await supabase.from("activity_streams").select("activity_id, step_seconds, heart_rate").in("activity_id", ids);
    if (error) {
      console.error(error);
      break;
    }
    for (const s of data) streams.set(s.activity_id, { step: s.step_seconds, heartRate: s.heart_rate });
  }
  const ridesByDay = new Map<string, RideMinutes[]>();
  for (const r of inWindow) {
    const day = localDate(r.startedAt, tz);
    const stream = streams.get(r.id);
    let bpm = stream ? streamMinutes(stream.heartRate, stream.step) : [];
    // Without a stored stream, the ride's average heart rate stands in for each minute.
    if (!bpm.some((v) => v !== null) && r.averageHr) bpm = new Array(Math.round(r.durationSeconds / 60)).fill(Math.round(r.averageHr));
    if (!bpm.length) continue;
    ridesByDay.set(day, [...(ridesByDay.get(day) ?? []), { startMinute: localMinute(r.startedAt, tz), bpm }]);
  }

  const watchByDay = new Map<string, (number | null)[]>();
  const activity = new Map<string, { activeKcal: number | null; steps: number | null }>();
  let appleVo2max: Daytime["appleVo2max"] = null;
  for (const row of healthRows) {
    if (Array.isArray(row.hr_minutes) && row.hr_minutes.length === MINUTES_PER_DAY) watchByDay.set(row.day, row.hr_minutes as (number | null)[]);
    activity.set(row.day, { activeKcal: row.active_kcal === null ? null : Number(row.active_kcal), steps: row.steps });
    if (row.vo2max !== null) appleVo2max = { day: row.day, value: Number(row.vo2max) };
  }

  const out: DayExertion[] = [];
  for (let day = from; day <= today; day = addDays(day, 1)) {
    const watch = watchByDay.get(day) ?? null;
    const dayRides = ridesByDay.get(day) ?? [];
    if (!watch && !dayRides.length) continue;
    out.push(dayExertion(day, watch, dayRides, heart));
  }
  return { days: out, activity, appleVo2max, heart, hasWatch: watchByDay.size > 0 };
}

/** The exertion of the day before `day` against the normal before it, for that morning's recovery score. */
export function priorLoad(days: DayExertion[], day: string): PriorLoad | null {
  const yesterday = addDays(day, -1);
  const prior = days.find((d) => d.day === yesterday);
  if (!prior) return null;
  const normal: ExertionNormal | null = exertionNormal(days, yesterday);
  // A day the watch mostly missed would read as easy, so it doesn't count.
  if (!normal || prior.coveredMinutes < MIN_COVERED_MINUTES) return null;
  return { exertion: prior.exertion, normal };
}
