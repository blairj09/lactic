import { describe, expect, it } from "vitest";
import { healthWorkout, rideKcal } from "./health-export";

const ride = {
  id: "r1",
  name: "Sweet spot",
  startedAt: "2026-11-09T17:00:00Z",
  durationSeconds: 3600,
  distanceMeters: 30123.4,
  averagePower: 200,
  indoor: true,
  stepSeconds: 5,
  watts: new Array(720).fill(200),
  heartRate: new Array(720).fill(140),
  cadence: new Array(720).fill(90),
};

describe("rides into Apple Health", () => {
  it("counts a kilojoule of work as about a kcal burned", () => {
    // 200 W for an hour is 720 kJ.
    expect(rideKcal(ride)).toBe(717);
    expect(rideKcal({ ...ride, watts: null })).toBe(717);
    expect(rideKcal({ ...ride, watts: null, averagePower: null })).toBeNull();
  });

  it("makes a workout with timed samples", () => {
    const w = healthWorkout(ride)!;
    expect(w.end - w.start).toBe(3600);
    expect(w.distanceMeters).toBe(30123);
    expect(w.heartRate).toHaveLength(720);
    expect(w.heartRate[1]).toEqual([5, 140]);
    expect(w.power[0]).toEqual([0, 200]);
  });

  it("thins one-second streams and drops gaps and nonsense", () => {
    const w = healthWorkout({ ...ride, stepSeconds: 1, heartRate: [120, 121, 122, 123, 124, null, 0, 0, 0, 0, 500], watts: null, cadence: null })!;
    expect(w.heartRate).toEqual([[0, 120]]);
    expect(healthWorkout({ ...ride, durationSeconds: 30 })).toBeNull();
  });
});
