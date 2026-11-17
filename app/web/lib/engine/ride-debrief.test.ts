import { describe, expect, it } from "vitest";
import { afterRideKey, rideDebrief } from "./ride-debrief";
import type { Workout } from "./workout";

const ride = { id: "r1", name: "Threshold 2 × 20", durationSeconds: 4200, trainingStress: 88, normalizedPower: 232.4, averagePower: 215, averageHr: 159 };

describe("rideDebrief", () => {
  it("lays the ride against its plan, effort by effort when Lactic recorded the workout", () => {
    const workout = { name: "Threshold 2 × 20", segments: [
      { kind: "steady", duration: 600, target: 0.6 },
      { kind: "steady", duration: 1200, target: 0.95 },
      { kind: "steady", duration: 300, target: 0.5 },
      { kind: "steady", duration: 1200, target: 0.95 },
    ] } as unknown as Workout;
    const intervals = [
      { index: 0, kind: "steady" as const, planned: 600, ridden: 600, target: 160, power: 158, heartRate: 120, cadence: 90 },
      { index: 1, kind: "steady" as const, planned: 1200, ridden: 1200, target: 252, power: 251, heartRate: 160, cadence: 90 },
      { index: 2, kind: "steady" as const, planned: 300, ridden: 300, target: 134, power: 130, heartRate: 130, cadence: 90 },
      { index: 3, kind: "steady" as const, planned: 1200, ridden: 1200, target: 252, power: 231, heartRate: 168, cadence: 88 },
    ];
    const d = rideDebrief(ride, { name: "Threshold 2 × 20", duration: 3300, stress: 88 }, { workout, intervals }, { difficulty: "Very hard", rpe: 9, note: "" });
    expect(d.percentOfPlan).toBe(100);
    expect(d.normalizedWatts).toBe(232);
    expect(d.execution?.method).toBe("blocks");
    expect(d.efforts).toHaveLength(2);
    expect(d.efforts[0]).toMatchObject({ targetWatts: 252, watts: 251, check: "on" });
    expect(d.efforts[1]).toMatchObject({ targetWatts: 252, watts: 231, check: "under" });
    expect(d.felt?.difficulty).toBe("Very hard");
  });

  it("scores a ride from elsewhere by its totals, and an unplanned one not at all", () => {
    const zwift = rideDebrief(ride, { name: null, duration: 3600, stress: 88 }, null, null);
    expect(zwift.execution?.method).toBe("total");
    expect(zwift.efforts).toEqual([]);
    const free = rideDebrief(ride, null, null, null, [{ ...ride, id: "r2", name: null, durationSeconds: 1800, trainingStress: 20 }]);
    expect(free.planned).toBeNull();
    expect(free.execution).toBeNull();
    expect(free.alsoToday).toEqual([{ name: "Ride", minutes: 30, stress: 20 }]);
  });
});

describe("afterRideKey", () => {
  it("changes with a new ride or answer, not with order", () => {
    expect(afterRideKey([], [])).toBeNull();
    const one = afterRideKey([{ id: "a" }], []);
    expect(afterRideKey([{ id: "b" }, { id: "a" }], [])).toBe(afterRideKey([{ id: "a" }, { id: "b" }], []));
    const answered = afterRideKey([{ id: "a" }], [{ rideId: "a", difficulty: "hard", rpe: 8, note: "legs heavy" }]);
    expect(answered).not.toBe(one);
    expect(afterRideKey([{ id: "a" }], [{ rideId: "a", difficulty: "hard", rpe: 8, note: "legs fine" }])).not.toBe(answered);
  });
});
