// Everything the Health page shows beyond the raw nights (exertion and sleep score), and the
// VO2 max and fitness age that Progress shows, put together from the loaded data with the
// engine's functions.

import type { Athlete } from "./activities";
import { localMinute, type Daytime } from "./daytime-data";
import { ageOn } from "./engine/body";
import { exertionBaselineDays, exertionNormal, exertionTarget, MIN_COVERED_MINUTES, type DayExertion, type ExertionNormal } from "./engine/exertion";
import { averageVo2max, fitnessAge, vo2maxFromPower, vo2maxRating } from "./engine/fitness-age";
import { addDays } from "./engine/pmc";
import { bedtimeSpreadMinutes, sleepDebt, sleepNeedTonight, sleepScore, type SleepNight, type SleepScore } from "./engine/sleep-score";
import type { RecoveryTrendDay } from "./engine/recovery";
import type { SleepNightRow } from "./recovery-data";

export interface HealthSummary {
  exertion: {
    yesterday: DayExertion | null;
    today: DayExertion | null;
    normal: ExertionNormal | null;
    /** Days of heart rate the normal has so far, while it's still filling. */
    baselineDays: number;
    target: { low: number; high: number } | null;
    byDay: Map<string, number>;
  };
  sleep: {
    score: SleepScore | null;
    debtHours: number | null;
    needTonight: number;
    spreadMinutes: number | null;
    byDay: Map<string, number>;
    /** Each night's score with its parts. */
    scores: Map<string, SleepScore>;
  };
  activity: { activeKcal: number | null; steps: number | null } | null;
}

/** VO2 max and fitness age now. Shown on Progress: it's training fitness, from your power. */
export interface FitnessSummary {
  vo2max: number | null;
  source: "power" | "apple" | null;
  fiveMinuteWatts: number | null;
  appleVo2max: { day: string; value: number } | null;
  age: number | null;
  fitnessAge: number | null;
  averageForAge: number | null;
  rating: string | null;
}

export function healthSummary(input: {
  athlete: Athlete;
  today: string;
  daytime: Daytime | null;
  trend: RecoveryTrendDay[];
  nights: SleepNightRow[];
  /** Today's recovery score, for the exertion target. */
  recovery: number | null;
}): HealthSummary {
  const { athlete, today, daytime } = input;
  const tz = athlete.timezone;
  const yesterdayDay = addDays(today, -1);

  // Exertion.
  const days = daytime?.days ?? [];
  const find = (day: string) => days.find((d) => d.day === day) ?? null;
  const normal = exertionNormal(days, today);
  const byDay = new Map(days.filter((d) => d.coveredMinutes >= MIN_COVERED_MINUTES || d.rideTrimp > 0).map((d) => [d.day, d.exertion]));

  // Sleep.
  const asNight = (n: SleepNightRow): SleepNight => ({
    day: n.day,
    asleepHours: n.asleepHours,
    awakeHours: n.awakeHours,
    deepHours: n.deepHours,
    remHours: n.remHours,
    start: n.start ? Date.parse(n.start) / 1000 : null,
    end: n.end ? Date.parse(n.end) / 1000 : null,
    bedMinute: n.start ? localMinute(new Date(n.start), tz) : undefined,
  });
  const nights = input.nights.map(asNight);
  const scoreOn = (day: string) => {
    const i = nights.findIndex((n) => n.day === day);
    return i < 0 ? null : sleepScore(nights[i], nights.slice(0, i), athlete.sleepNeedHours);
  };
  const sleepByDay = new Map<string, number>();
  const scores = new Map<string, SleepScore>();
  for (const n of nights) {
    const s = scoreOn(n.day);
    if (s) {
      sleepByDay.set(n.day, s.score);
      scores.set(n.day, s);
    }
  }
  const upToToday = nights.filter((n) => n.day <= today);
  const debt = upToToday.length ? sleepDebt(upToToday, athlete.sleepNeedHours, 7, today) : null;

  return {
    exertion: { yesterday: find(yesterdayDay), today: find(today), normal, baselineDays: exertionBaselineDays(days, today), target: exertionTarget(input.recovery, normal), byDay },
    sleep: {
      score: scoreOn(today),
      debtHours: debt,
      needTonight: sleepNeedTonight(athlete.sleepNeedHours, debt ?? 0, find(today)?.exertion ?? null),
      spreadMinutes: bedtimeSpreadMinutes(upToToday.slice(-14)),
      byDay: sleepByDay,
      scores,
    },
    activity: daytime?.activity.get(yesterdayDay) ?? null,
  };
}


/** VO2 max from your best 5 minutes of power where there's power, else Apple Watch's Cardio Fitness, and the fitness age it gives. */
export function fitnessSummary(input: {
  athlete: Athlete;
  today: string;
  bestFiveMinuteWatts: number | null;
  weightKg: number | null;
  appleVo2max: { day: string; value: number } | null;
}): FitnessSummary {
  const { athlete, today, appleVo2max: apple } = input;
  const age = athlete.birthDate ? ageOn(athlete.birthDate, today) : null;
  const fromPower = input.bestFiveMinuteWatts && input.weightKg ? vo2maxFromPower(input.bestFiveMinuteWatts, input.weightKg) : null;
  const vo2max = fromPower ?? apple?.value ?? null;
  const sex = athlete.sex;
  return {
    vo2max,
    source: fromPower ? "power" : apple ? "apple" : null,
    fiveMinuteWatts: input.bestFiveMinuteWatts,
    appleVo2max: apple,
    age,
    fitnessAge: vo2max !== null && sex ? fitnessAge(vo2max, sex) : null,
    averageForAge: age !== null && sex ? Math.round(averageVo2max(age, sex) * 10) / 10 : null,
    rating: vo2max !== null && age !== null && sex ? vo2maxRating(vo2max, age, sex) : null,
  };
}
