import { describe, expect, it } from "vitest";
import { executionGrade, rideExecution, scoreExecution, scoreTotal } from "./execution";
import type { RideInterval } from "./ride-detail";
import { ramp, steady, type Workout } from "./workout";

const FTP = 250;
// Warm-up, 3 x 5 min at threshold with 3 min easy between, cool-down.
const workout: Workout = {
  name: "Threshold 3 x 5",
  segments: [ramp(600, 0.45, 0.7), steady(300, 1), steady(180, 0.5), steady(300, 1), steady(180, 0.5), steady(300, 1), ramp(300, 0.65, 0.4)],
};
const target = (i: number) => {
  const s = workout.segments[i];
  return Math.round(FTP * (s.kind === "steady" ? s.target : s.kind === "ramp" ? (s.from + s.to) / 2 : 0));
};
/** Rode each block as planned at `factor` of its target, with changes by index. */
const ride = (factor = 1, changes: Record<number, Partial<RideInterval>> = {}): RideInterval[] =>
  workout.segments.map((s, index) => ({
    index,
    kind: s.kind,
    planned: s.duration,
    ridden: s.duration,
    target: target(index),
    power: Math.round(target(index) * factor),
    heartRate: null,
    cadence: null,
    ...changes[index],
  }));

describe("execution score", () => {
  it("is 100 for a workout ridden on target", () => {
    const e = scoreExecution(workout, ride())!;
    expect(e.score).toBe(100);
    expect(e.blocks.every((b) => b.check === "on")).toBe(true);
    expect(executionGrade(e.score)).toBe("nailed");
  });

  it("names each block for what it is", () => {
    const roles = scoreExecution(workout, ride())!.blocks.map((b) => b.role);
    expect(roles[0]).toBe("Warm-up");
    expect(roles[1]).toMatch(/1 of 3/);
  });

  it("costs more to fade in an effort than to cut the warm-up", () => {
    const faded = scoreExecution(workout, ride(1, { 5: { power: Math.round(target(5) * 0.85) } }))!;
    const shortWarm = scoreExecution(workout, ride(1, { 0: { ridden: 300 } }))!;
    expect(faded.blocks[5].check).toBe("under");
    expect(faded.blocks[5].score).toBeCloseTo(50, -1);
    expect(shortWarm.blocks[0].check).toBe("short");
    expect(faded.score).toBeLessThan(shortWarm.score);
    expect(faded.score).toBeLessThan(100);
  });

  it("scores a skipped effort zero and lets going easy on recoveries go", () => {
    const e = scoreExecution(workout, ride(1, { 3: { ridden: 0, power: null }, 2: { power: 80 } }))!;
    expect(e.blocks[3]).toMatchObject({ check: "skipped", score: 0 });
    expect(e.blocks[2].check).toBe("on");
    // An easy block ridden hard is over.
    expect(scoreExecution(workout, ride(1, { 2: { power: 200 } }))!.blocks[2].check).toBe("over");
  });

  it("gives efforts nothing well under target, leaving only the easy riding", () => {
    const e = scoreExecution(workout, ride(0.6))!;
    expect(e.blocks.filter((b) => b.effort).every((b) => b.score === 0)).toBe(true);
    expect(e.score).toBeLessThan(40);
  });

  it("scores rides without block data from their totals", () => {
    expect(scoreTotal({ duration: 3600, stress: 60 }, { durationSeconds: 3600, trainingStress: 60 }).score).toBe(100);
    expect(scoreTotal({ duration: 3600, stress: 60 }, { durationSeconds: 1800, trainingStress: 30 }).score).toBe(50);
    expect(scoreTotal({ duration: 3600, stress: 60 }, { durationSeconds: 7200, trainingStress: 90 }).score).toBe(70);
    expect(rideExecution(null, null, { durationSeconds: 3600, trainingStress: 50 })).toBeNull();
    expect(rideExecution({ workout, intervals: ride() }, { duration: 3600, stress: 60 }, { durationSeconds: 100, trainingStress: 1 })!.method).toBe("blocks");
  });
});
