// A believable athlete for the coach evals, built with the real engine: eight weeks of rides, the
// fitness series from them, the engine's plan toward an event, recovery and weigh-ins. Each scenario
// starts from `athlete()` and changes only what it's about (poor sleep, a check-in, a sore knee...).

import { dailyStress, localDate } from "@shared/engine/activity";
import { applyOutcomes, seedLevels } from "@shared/engine/levels";
import { mergeCurves, type PowerCurve } from "@shared/engine/power";
import { addDays, fitnessSeries } from "@shared/engine/pmc";
import { buildPlan, type Availability, type Break, type Goal } from "@shared/engine/plan";
import type { Difficulty } from "@shared/engine/feedback";
import type { Feel } from "@shared/engine/checkin";
import type { StoredRide } from "@shared/activities";
import type { BodyMeasurement } from "@shared/body-data";
import type { CheckinRecord, StoredFeedback, StoredPlanDay, TrainingState } from "@shared/training";
import type { RecoveryToday } from "@shared/recovery-data";
import type { CoachData, MemoryFact, RecoveryDay } from "@shared/coach/tools";

/** A Thursday, so the week has days on both sides. */
export const TODAY = "2026-10-29";
const TZ = "America/Los_Angeles";

export interface AthleteOptions {
  today?: string;
  ftp?: number;
  weightKg?: number;
  availability?: Availability;
  rampRate?: number;
  goals?: Goal[];
  breaks?: Break[];
  /** Weekly load as a multiple of the usual weeks: above 1 piles on fatigue (applied to the last two weeks). */
  recentLoad?: number;
  /** Rides in the last few days, newest first, on top of the usual weeks. */
  extraRides?: Partial<StoredRide>[];
  /** Today's recovery from Apple Health: score null while the baseline builds. */
  recovery?: { hrv: number; restingHr: number; sleepHours: number; score: number | null; reasons?: string[]; baselineDays?: number } | null;
  /** Nights before today, oldest first; defaults to a steady fortnight. */
  nights?: Partial<RecoveryDay>[];
  /** Today's check-in: how they feel, ill or not, time they have, and a note. */
  checkin?: { feel: Feel; sick?: boolean; minutes?: number | null; notes?: string } | null;
  /** Post-ride answers for the most recent rides, newest first. */
  feedback?: { difficulty: Difficulty; rpe?: number; note?: string }[];
  memory?: MemoryFact[];
  /** Daily weights for the last 45 days, oldest first; defaults to steady around weightKg. */
  weights?: number[];
}

/** The usual week: Tue sweet spot, Thu threshold, Sat long ride, Sun endurance. Days are offsets from Monday. */
const WEEK: { day: number; name: string; minutes: number; np: number; tss: number; hr: number; curve: PowerCurve }[] = [
  { day: 1, name: "Sweet spot 3 x 15", minutes: 75, np: 228, tss: 82, hr: 148, curve: { 5: 640, 60: 330, 300: 262, 1200: 244, 3600: 220 } },
  { day: 3, name: "Threshold 4 x 8", minutes: 70, np: 236, tss: 86, hr: 152, curve: { 5: 700, 60: 360, 300: 281, 1200: 252, 3600: 226 } },
  { day: 5, name: "Long endurance", minutes: 200, np: 182, tss: 152, hr: 132, curve: { 5: 820, 60: 390, 300: 268, 1200: 236, 3600: 205 } },
  { day: 6, name: "Endurance with sprints", minutes: 110, np: 175, tss: 82, hr: 128, curve: { 5: 960, 15: 820, 30: 610, 60: 410, 300: 240, 1200: 205, 3600: 178 } },
];

const monday = (date: string) => {
  const d = new Date(`${date}T12:00:00Z`).getUTCDay();
  return addDays(date, -((d + 6) % 7));
};

/** Builds the athlete's state the way the app loads it, but from fixed numbers. */
export function athlete(o: AthleteOptions = {}): CoachData {
  const today = o.today ?? TODAY;
  const ftp = o.ftp ?? 262;
  const weightKg = o.weightKg ?? 74;
  const availability: Availability = o.availability ?? [0, 75, 60, 75, 0, 210, 120];
  const thisMonday = monday(today);

  // Eight weeks of the usual week, before today; the last two scaled by recentLoad.
  const rides: StoredRide[] = [];
  for (let w = 8; w >= 0; w--) {
    const start = addDays(thisMonday, -7 * w);
    const scale = w <= 1 ? (o.recentLoad ?? 1) : w % 4 === 0 ? 0.7 : 1;
    for (const r of WEEK) {
      const date = addDays(start, r.day);
      if (date >= today) continue;
      rides.push(ride({ id: `r-${date}`, name: r.name, date, minutes: Math.round(r.minutes * Math.min(scale, 1.4)), np: r.np, tss: Math.round(r.tss * scale), hr: r.hr, curve: r.curve, ftp }));
    }
  }
  for (const [i, extra] of (o.extraRides ?? []).entries()) rides.push({ ...ride({ id: `x${i}`, name: "Ride", date: addDays(today, -1 - i), minutes: 60, np: 180, tss: 50, hr: 130, curve: {}, ftp }), ...extra });
  rides.sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime());

  const firstDay = addDays(thisMonday, -56);
  const series = fitnessSeries(dailyStress(rides, TZ), firstDay, today, { startingFitness: 48, startingFatigue: 50 });
  const yesterday = series.find((d) => d.date === addDays(today, -1))!;
  const curves = rides.flatMap((r) => (r.powerCurve && Object.keys(r.powerCurve).length ? [r.powerCurve] : []));
  const levels = applyOutcomes(seedLevels(mergeCurves(...curves), ftp, Math.max(...rides.map((r) => r.durationSeconds))), []);

  const goals = o.goals ?? [{ id: "g1", name: "Ridgeline Gravel 100", date: "2026-12-12", priority: "A", kind: "gravel", minutes: 330, intensity: "moderate" }];
  const plan = buildPlan({ today, goals, breaks: o.breaks ?? [], availability, fitness: yesterday.fitness, fatigue: yesterday.fatigue, levels, rampRate: o.rampRate ?? 5 });
  const todayPlan = plan.weeks.flatMap((w) => w.days).find((d) => d.date === today) ?? null;

  const feedback: StoredFeedback[] = (o.feedback ?? [{ difficulty: "right", rpe: 6 }]).map((f, i) => {
    const r = rides[i];
    return { rideId: r.id, day: localDate(r.startedAt, TZ), difficulty: f.difficulty, rpe: f.rpe ?? null, note: f.note ?? "", session: null };
  });

  const rec = o.recovery === undefined ? { hrv: 62, restingHr: 49, sleepHours: 7.6, score: 64, reasons: ["HRV at your normal", "Slept well"], baselineDays: 30 } : o.recovery;
  const recovery: RecoveryToday | null = rec
    ? {
        today: { hrv: rec.hrv, restingHeartRate: rec.restingHr, sleepHours: rec.sleepHours, hrvKind: "sdnn" },
        source: "apple_health",
        score: rec.score === null ? null : { score: rec.score, reasons: rec.reasons ?? [] },
        baselineDays: rec.baselineDays ?? 30,
        sleep: null,
      }
    : null;
  const nights = o.nights ?? Array.from({ length: 13 }, (_, i) => ({ hrvMs: 60 + ((i * 7) % 9) - 4, restingHr: 49 + (i % 3) - 1, sleepHours: 7.4 + ((i * 3) % 5) / 10 - 0.2 }));
  const recoveryDays: RecoveryDay[] = [
    ...(rec ? [{ day: today, hrvMs: rec.hrv, hrvKind: "sdnn" as const, restingHr: rec.restingHr, sleepHours: rec.sleepHours }] : []),
    ...nights
      .map((n, i) => ({ day: addDays(today, -(nights.length - i)), hrvMs: null, hrvKind: "sdnn" as const, restingHr: null, sleepHours: null, ...n }))
      .reverse(),
  ];

  const weights = o.weights ?? Array.from({ length: 45 }, (_, i) => weightKg + 0.9 - i * 0.02 + ((i * 5) % 7) / 20 - 0.15);
  const body: BodyMeasurement[] = weights.map((kg, i) => ({
    id: `w${i}`,
    measuredAt: new Date(`${addDays(today, i - weights.length + 1)}T14:30:00Z`),
    weightKg: Math.round(kg * 10) / 10,
    bodyFatPercent: 14.2,
    bmi: null,
    fatFreeMassKg: null,
    source: "body_pod",
  }));

  const checkin: CheckinRecord | null = o.checkin
    ? { feel: o.checkin.feel, sick: o.checkin.sick ?? false, minutes: o.checkin.minutes ?? null, notes: o.checkin.notes ?? "", recovery: rec?.score ?? null, form: yesterday.form, recommended: "asPlanned", reasons: [], coach: null, at: `${today}T15:00:00Z` }
    : null;
  const todayStored: StoredPlanDay | null = checkin ? { day: today, planned: null, chosen: null, checkin, activityId: null, feelAfter: null, movedFrom: null } : null;

  const state = {
    athlete: {
      userId: "eval",
      ftp,
      thresholdHr: 172,
      maxHr: 189,
      weightKg,
      heightCm: 178,
      birthDate: "1986-04-12",
      sex: "male",
      sleepNeedHours: 8,
      timezone: TZ,
      ftpHistory: [
        { effectiveDate: "2026-07-01", watts: 248 },
        { effectiveDate: "2026-09-15", watts: ftp },
      ],
      availability,
      rampRate: o.rampRate ?? 5,
    },
    today,
    rides,
    series,
    fitness: yesterday.fitness,
    fatigue: yesterday.fatigue,
    form: yesterday.form,
    recovery,
    exertion: null,
    goals,
    plans: [],
    activePlan: null,
    breaks: o.breaks ?? [],
    levels,
    levelSeed: levels,
    levelOutcomes: [],
    plan,
    basePlan: plan,
    picks: [],
    outdoor: [],
    moves: [],
    weekDrift: null,
    rebuiltWeek: null,
    planInputs: "",
    changedDays: [],
    todayPlan,
    todayStored,
    recentDays: [],
    storedDays: todayStored ? [todayStored] : [],
    feedback,
    rideLinks: new Map(),
    favorites: [],
  } satisfies TrainingState;
  return { state, planDays: todayStored ? [todayStored] : [], recoveryDays, body, memory: o.memory ?? [] };
}

function ride(r: { id: string; name: string; date: string; minutes: number; np: number; tss: number; hr: number; curve: PowerCurve; ftp: number }): StoredRide {
  return {
    id: r.id,
    source: "zwift_fit",
    name: r.name,
    // Early evening Pacific, so the ride's local date is `date`.
    startedAt: new Date(`${r.date}T01:30:00Z`.replace(r.date, addDays(r.date, 1))),
    durationSeconds: r.minutes * 60,
    distanceMeters: Math.round(r.minutes * 0.5) * 1000,
    averagePower: Math.round(r.np * 0.92),
    normalizedPower: r.np,
    intensityFactor: Math.round((r.np / r.ftp) * 100) / 100,
    trainingStress: r.tss,
    stressMethod: "power",
    averageHr: r.hr,
    powerCurve: r.curve,
    powerHistogram: null,
    duplicateOf: null,
    intervalsId: null,
  };
}

/** The plan's key days in the next week, for the weekly planning run. */
export function keyDays(data: CoachData, days = 7) {
  const { today } = data.state;
  return data.state.basePlan.weeks
    .flatMap((w) => w.days)
    .filter((d) => d.role === "key" && d.session && d.date >= today && d.date < addDays(today, days));
}
