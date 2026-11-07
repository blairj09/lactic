import { describe, expect, it } from "vitest";
import { STARTING_LEVELS } from "./library";
import { reviewTime, weekReview } from "./review";
import type { ComplianceDay } from "./compliance";
import { buildPlan } from "./plan";

const session = (stress: number) => ({ duration: 3600, stress });
const ride = (id: string, trainingStress: number) => ({ id, durationSeconds: 3600, trainingStress });

describe("weekReview", () => {
  // Monday Oct 26 to Sunday Nov 1, with the Sunday before and the Monday after.
  const days: ComplianceDay[] = [
    { date: "2026-10-25", planned: null, rides: [ride("x", 40)] },
    { date: "2026-10-26", planned: session(60), rides: [ride("a", 62)] },
    { date: "2026-10-27", planned: session(80), rides: [ride("b", 40)] },
    { date: "2026-10-28", planned: session(50), rides: [] },
    { date: "2026-10-29", planned: null, rides: [ride("c", 52)] },
    { date: "2026-10-30", planned: session(70), rides: [] },
    { date: "2026-10-31", planned: null, rides: [] },
    { date: "2026-11-01", planned: session(100), rides: [ride("d", 110), ride("e", 20)] },
    { date: "2026-11-02", planned: session(60), rides: [] },
  ];
  const review = weekReview({
    start: "2026-10-26",
    days,
    feedback: [
      { day: "2026-10-25", difficulty: "tooHard", rpe: 9 },
      { day: "2026-10-26", difficulty: "right", rpe: 6 },
      { day: "2026-10-27", difficulty: "tooHard", rpe: 9 },
    ],
    levelsBefore: STARTING_LEVELS,
    levelsAfter: { ...STARTING_LEVELS, threshold: STARTING_LEVELS.threshold + 0.6, vo2max: STARTING_LEVELS.vo2max - 0.5 },
    series: [
      { date: "2026-10-25", fitness: 50, fatigue: 55 },
      { date: "2026-11-01", fitness: 53.4, fatigue: 60 },
    ],
  });

  it("adds up the week's stress, rides and days against the plan", () => {
    expect(review).toMatchObject({ start: "2026-10-26", end: "2026-11-01", planned: 360, done: 284, rides: 5, seconds: 5 * 3600 });
    // Wednesday was ridden on Thursday's rest day; Friday was missed; Tuesday half done.
    expect(review.marks).toEqual({ done: 2, partial: 1, moved: 1, missed: 1, unplanned: 0 });
  });

  it("counts the week's answers and the levels that moved", () => {
    expect(review.felt).toEqual({ tooEasy: 0, right: 1, tooHard: 1, failed: 0 });
    expect(review.rpe).toBe(7.5);
    expect(review.levels.map((l) => l.zone)).toEqual(["threshold", "vo2max"]);
  });

  it("reads fitness at the end of the week against the day before it", () => {
    expect(review).toMatchObject({ fitness: 53, fitnessChange: 3, form: -7 });
  });
});

describe("reviewTime", () => {
  it("is the first three days of the week", () => {
    expect(reviewTime("2026-11-02", "2026-11-02")).toBe(true);
    expect(reviewTime("2026-11-04", "2026-11-02")).toBe(true);
    expect(reviewTime("2026-11-05", "2026-11-02")).toBe(false);
  });
});

describe("the plan's first week", () => {
  it("covers the whole week, so a snapshot taken midweek has its earlier days", () => {
    const plan = buildPlan({ today: "2026-10-31", goals: [], availability: [60, 60, 60, 60, 60, 120, 120], fitness: 50, fatigue: 50, levels: STARTING_LEVELS });
    expect(plan.weeks[0].days[0].date).toBe("2026-10-26");
  });
});
