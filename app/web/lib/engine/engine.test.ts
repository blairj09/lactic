import { describe, expect, it } from "vitest";
import { assignCopies, dailyStress, ftpOn, resampleTo1Hz, rideStressFromSummary } from "./activity";
import { estimateFtp, rampTestFtp } from "./ftp";
import { isRampTest, rampTest } from "./library";
import { addDays, fitnessSeries } from "./pmc";
import { mergeCurves, normalizedPower, powerCurve, rideStress } from "./power";
import { recoveryScore, recoveryTrend, rmssd, tempDeltaC, type RecoveryDay, type RecoveryInputs } from "./recovery";
import {
  intervalAt,
  intervals,
  plannedStress,
  powerZone,
  ramp,
  scaleWorkout,
  segmentRange,
  steady,
  targetAt,
  targetWattsAt,
  workoutDuration,
  type Workout,
} from "./workout";
import { parseZwo } from "./zwo";

const constant = (watts: number, seconds: number) => Array<number>(seconds).fill(watts);

describe("power metrics", () => {
  it("normalized power of a steady ride equals its power", () => {
    expect(normalizedPower(constant(200, 600))).toBeCloseTo(200, 6);
  });

  it("normalized power weights surges above the average", () => {
    const alternating = Array.from({ length: 1200 }, (_, i) => (Math.floor(i / 60) % 2 ? 300 : 100));
    expect(normalizedPower(alternating)!).toBeGreaterThan(220);
  });

  it("is null for rides shorter than the window", () => {
    expect(normalizedPower(constant(200, 10))).toBeNull();
  });

  it("one hour at FTP is 100 TSS", () => {
    expect(rideStress(constant(250, 3600), 250)).toBeCloseTo(100, 6);
  });

  it("power curve finds the best window", () => {
    const watts = [...constant(150, 300), ...constant(400, 60), ...constant(150, 300)];
    const curve = powerCurve(watts, [60, 300]);
    expect(curve[60]).toBeCloseTo(400);
    expect(curve[300]).toBeCloseTo((400 * 60 + 150 * 240) / 300);
    expect(curve[600]).toBeUndefined();
  });

  it("merging keeps the best value per duration", () => {
    expect(mergeCurves({ 60: 300, 300: 250 }, { 60: 320, 1200: 220 })).toEqual({ 60: 320, 300: 250, 1200: 220 });
  });
});

describe("FTP estimate", () => {
  it("recovers CP and W' from an exact critical power curve", () => {
    const cp = 260;
    const wPrime = 20000;
    const curve = Object.fromEntries([180, 300, 480, 600, 720, 1200].map((t) => [t, cp + wPrime / t]));
    const estimate = estimateFtp(curve)!;
    expect(estimate.method).toBe("criticalPower");
    expect(estimate.watts).toBeCloseTo(cp, 6);
    expect(estimate.wPrime).toBeCloseTo(wPrime, 3);
  });

  it("falls back to 95% of 20 minute power", () => {
    expect(estimateFtp({ 1200: 300 })).toEqual({ watts: 285, method: "twentyMinute" });
  });

  it("returns null with no usable efforts", () => {
    expect(estimateFtp({ 5: 900 })).toBeNull();
  });
});

describe("ramp test", () => {
  /** Rides the ramp test at FTP `ftp` to the end of minute `steps`, then stops. */
  const rideRamp = (ftp: number, steps: number) => {
    const watts: number[] = Array(480).fill(ftp * 0.47);
    for (let i = 0; i < steps; i++) watts.push(...Array(60).fill(ftp * (0.5 + 0.06 * i)));
    return watts;
  };

  it("sets FTP to 75% of the best minute", () => {
    // 250 W FTP, failing in the 14th step (128% = 320 W).
    expect(rampTestFtp(rideRamp(250, 14))).toEqual({ watts: 240, bestMinute: 320 });
  });

  it("needs the warm-up and a few steps", () => {
    expect(rampTestFtp(rideRamp(250, 2))).toBeNull();
    expect(rampTestFtp(rideRamp(250, 3))).not.toBeNull();
  });

  it("recognises the engine's ramp test", () => {
    expect(isRampTest(rampTest().workout)).toBe(true);
    expect(isRampTest({ ...rampTest().workout, name: "Threshold 60 min" })).toBe(false);
  });
});

describe("fitness, fatigue, form", () => {
  it("adds days across month ends", () => {
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
  });

  it("builds a daily series with yesterday-based form", () => {
    const series = fitnessSeries({ "2026-10-01": 100 }, "2026-10-01", "2026-10-03");
    expect(series.map((d) => d.date)).toEqual(["2026-10-01", "2026-10-02", "2026-10-03"]);
    expect(series[0].fitness).toBeCloseTo(100 / 42);
    expect(series[0].fatigue).toBeCloseTo(100 / 7);
    expect(series[0].form).toBe(0);
    expect(series[1].form).toBeCloseTo(100 / 42 - 100 / 7);
  });

  it("converges to the daily load when training is constant", () => {
    const daily = Object.fromEntries(Array.from({ length: 400 }, (_, i) => [addDays("2025-01-01", i), 60]));
    const last = fitnessSeries(daily, "2025-01-01", addDays("2025-01-01", 399)).at(-1)!;
    expect(last.fitness).toBeCloseTo(60, 1);
    expect(last.fatigue).toBeCloseTo(60, 1);
  });
});

describe("workouts", () => {
  const workout: Workout = { name: "Test", segments: [ramp(600, 0.5, 0.75), steady(300, 1), { kind: "freeRide", duration: 60 }] };

  it("knows its duration and targets", () => {
    expect(workoutDuration(workout)).toBe(960);
    expect(targetAt(workout, 0)).toBe(0.5);
    expect(targetAt(workout, 300)).toBeCloseTo(0.625);
    expect(targetAt(workout, 700)).toBe(1);
    expect(targetAt(workout, 930)).toBeNull();
    expect(targetAt(workout, 2000)).toBeNull();
    expect(targetWattsAt(workout, 700, 263)).toBe(263);
  });

  it("an hour at 100% plans 100 TSS", () => {
    expect(plannedStress({ name: "FTP hour", segments: [steady(3600, 1)] })).toBeCloseTo(100, 6);
  });

  it("parses .zwo files", () => {
    const parsed = parseZwo(`<workout_file>
      <name> Sweet spot 3x10 </name>
      <workout>
        <Warmup Duration="600" PowerLow="0.45" PowerHigh="0.75"/>
        <IntervalsT Repeat="3" OnDuration="600" OffDuration="300" OnPower="0.9" OffPower="0.55"/>
        <FreeRide Duration="120"/>
        <Cooldown Duration="300" PowerLow="0.7" PowerHigh="0.4"/>
      </workout>
    </workout_file>`);
    expect(parsed.name).toBe("Sweet spot 3x10");
    expect(parsed.segments).toHaveLength(1 + 6 + 1 + 1);
    expect(parsed.segments[1]).toEqual(steady(600, 0.9));
    expect(parsed.segments.at(-1)).toEqual(ramp(300, 0.7, 0.4));
    expect(workoutDuration(parsed)).toBe(600 + 3 * 900 + 120 + 300);
  });

  it("rejects files without a workout", () => {
    expect(() => parseZwo("<workout_file></workout_file>")).toThrow();
  });
});

describe("recovery", () => {
  it("computes RMSSD and skips artifacts", () => {
    expect(rmssd([1000, 1010, 1000, 1010])).toBeCloseTo(10);
    // 1500 is a missed beat: both pairs touching it are dropped.
    expect(rmssd([1000, 1010, 1500, 1000, 1010])).toBeCloseTo(10);
    expect(rmssd([1000])).toBeNull();
  });

  const baseline: RecoveryInputs[] = Array.from({ length: 30 }, (_, i) => ({
    hrv: 60 + (i % 5) - 2,
    restingHeartRate: 50 + (i % 3) - 1,
    sleepHours: 8,
  }));

  it("scores a normal day near 50", () => {
    const result = recoveryScore({ hrv: 60, restingHeartRate: 50, sleepHours: 8 }, baseline)!;
    expect(result.score).toBeGreaterThanOrEqual(45);
    expect(result.score).toBeLessThanOrEqual(55);
  });

  it("scores low HRV, high RHR and short sleep as poor, and explains why", () => {
    const result = recoveryScore({ hrv: 45, restingHeartRate: 56, sleepHours: 5.5 }, baseline)!;
    expect(result.score).toBeLessThan(15);
    expect(result.reasons[0]).toMatch(/^HRV \d+% below your usual$/);
    expect(result.reasons).toContain("Resting HR 6 bpm above usual");
    expect(result.reasons).toContain("Slept 5h 30m");
  });

  it("needs a week of nights before comparing wrist temperature", () => {
    const few = baseline.map((d, i) => (i >= 25 ? { ...d, wristTempC: 35.5 } : d));
    const result = recoveryScore({ hrv: 52, restingHeartRate: 55, sleepHours: 7, wristTempC: 36.5 }, few)!;
    expect(result.reasons.some((r) => r.includes("Wrist temp"))).toBe(false);
  });

  it("adds how far wrist temperature is from normal", () => {
    const wrist = baseline.map((d) => ({ ...d, wristTempC: 35.5 }));
    expect(tempDeltaC({ wristTempC: 36.1 }, wrist)).toBeCloseTo(0.6);
    expect(tempDeltaC({ wristTempC: 36.1 }, baseline)).toBeNull();
    const result = recoveryScore({ hrv: 60, restingHeartRate: 50, sleepHours: 8, wristTempC: 36.1 }, wrist)!;
    expect(result.reasons.at(-1)).toBe("Wrist temp +0.6 °C above usual");
  });

  it("lowers the score a little when breathing runs fast", () => {
    const breathing = baseline.map((d, i) => ({ ...d, respiratoryRate: 14 + (i % 3) * 0.2 - 0.2 }));
    const normal = recoveryScore({ hrv: 60, restingHeartRate: 50, sleepHours: 8, respiratoryRate: 14 }, breathing)!;
    const fast = recoveryScore({ hrv: 60, restingHeartRate: 50, sleepHours: 8, respiratoryRate: 16 }, breathing)!;
    expect(fast.score).toBeLessThan(normal.score);
    expect(normal.score - fast.score).toBeLessThanOrEqual(10);
    expect(fast.reasons).toContain("Breathing rate 2.0/min above usual");
  });

  it("needs a baseline before scoring HRV or RHR", () => {
    expect(recoveryScore({ hrv: 60, restingHeartRate: 50, sleepHours: 8 }, baseline.slice(0, 5))).toBeNull();
  });

  const nights: RecoveryDay[] = Array.from({ length: 40 }, (_, i) => ({
    day: addDays("2026-09-01", i),
    hrvKind: "rmssd",
    hrv: 60 + (i % 5) - 2,
    restingHeartRate: 50 + (i % 3) - 1,
    sleepHours: 8,
    wristTempC: 35.5,
  }));

  it("scores each day of a trend against the days before it", () => {
    const { days, normals } = recoveryTrend(nights, "2026-09-10");
    expect(days[0].day).toBe("2026-09-10");
    // Nine nights of baseline isn't enough for a score; the fifteenth morning has fourteen.
    expect(days[0].score).toBeNull();
    expect(days.find((d) => d.day === "2026-09-15")!.score).toBeGreaterThan(30);
    expect(days.find((d) => d.day === "2026-09-15")!.wristTempDeltaC).toBe(0);
    expect(normals.hrv).toBeCloseTo(60, 0);
    expect(normals.restingHeartRate).toBeCloseTo(50, 0);
    expect(normals.sleepHours).toBe(8);
  });

  it("matches the single-day score", () => {
    const { days } = recoveryTrend(nights, "2026-10-01");
    const last = nights.at(-1)!;
    expect(days.at(-1)!.score).toBe(recoveryScore(last, nights.slice(0, -1))!.score);
  });

  it("has no normals without a baseline", () => {
    expect(recoveryTrend(nights.slice(0, 3), "2026-09-01").normals).toEqual({ hrv: null, restingHeartRate: null, sleepHours: null, respiratoryRate: null });
  });
});

describe("rides", () => {
  it("holds short gaps and drops pauses when resampling", () => {
    const stream = resampleTo1Hz([
      { t: 0, watts: 100 },
      { t: 3, watts: 200 },
      { t: 4, watts: 300 },
      { t: 600, watts: 400 },
    ]);
    expect(stream.watts).toEqual([100, 100, 100, 200, 300, 400]);
    expect(stream.hasHeartRate).toBe(false);
  });

  it("uses power for stress when there is power, else heart rate", () => {
    const withPower = { durationSeconds: 3600, normalizedPower: 250, averageHeartRate: 150 };
    expect(rideStressFromSummary(withPower, 250, 160)).toMatchObject({ trainingStress: 100, method: "power" });
    const hrOnly = { durationSeconds: 3600, normalizedPower: null, averageHeartRate: 144 };
    expect(rideStressFromSummary(hrOnly, 250, 160)?.trainingStress).toBeCloseTo(81);
    expect(rideStressFromSummary(hrOnly, 250, null)).toBeNull();
  });

  it("finds the FTP in effect on a date", () => {
    const history = [
      { effectiveDate: "2026-06-01", watts: 250 },
      { effectiveDate: "2026-09-01", watts: 265 },
    ];
    expect(ftpOn("2026-08-31", history)).toBe(250);
    expect(ftpOn("2026-09-01", history)).toBe(265);
    expect(ftpOn("2026-01-01", history)).toBe(250);
    expect(ftpOn("2026-01-01", [], 240)).toBe(240);
  });

  it("groups stress by local calendar day", () => {
    const late = new Date("2026-10-29T05:00:00Z"); // 10 pm on the 28th in Los Angeles
    expect(dailyStress([{ startedAt: late, trainingStress: 50 }], "America/Los_Angeles")).toEqual({ "2026-10-28": 50 });
  });

  it("keeps this app's ride over Zwift's Strava copy, and leaves other rides alone", () => {
    const appRide = { id: "app", source: "app" as const, startedAt: new Date("2026-10-28T17:00:00Z"), durationSeconds: 3600 };
    const stravaCopy = { id: "strava", source: "strava" as const, startedAt: new Date("2026-10-28T16:59:00Z"), durationSeconds: 3700 };
    const nextDay = { ...stravaCopy, id: "other", startedAt: new Date("2026-10-29T17:00:00Z") };
    expect(Object.fromEntries(assignCopies([stravaCopy, nextDay, appRide]))).toEqual({ app: null, strava: "app", other: null });
  });
});

describe("workout player", () => {
  const workout: Workout = { name: "w", segments: [ramp(300, 0.5, 0.7), steady(120, 1.1), { kind: "freeRide", duration: 60 }] };

  it("lays intervals out on the clock", () => {
    expect(intervals(workout).map((i) => [i.start, i.end])).toEqual([
      [0, 300],
      [300, 420],
      [420, 480],
    ]);
  });

  it("finds the running interval", () => {
    expect(intervalAt(workout, 0)?.index).toBe(0);
    expect(intervalAt(workout, 300)?.index).toBe(1);
    expect(intervalAt(workout, 479)?.index).toBe(2);
    expect(intervalAt(workout, 480)).toBeNull();
  });

  it("gives target ranges and zones", () => {
    expect(segmentRange(ramp(60, 0.7, 0.4))).toEqual({ low: 0.4, high: 0.7 });
    expect(segmentRange({ kind: "freeRide", duration: 60 })).toBeNull();
    expect([0.5, 0.6, 0.8, 1, 1.1, 1.3, 1.6].map(powerZone)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it("scales intensity", () => {
    const harder = scaleWorkout(workout, 1.05);
    expect(targetWattsAt(harder, 310, 200)).toBe(Math.round(1.1 * 1.05 * 200));
    expect(targetAt(harder, 0)).toBeCloseTo(0.525);
    expect(targetAt(harder, 430)).toBeNull();
  });
});
