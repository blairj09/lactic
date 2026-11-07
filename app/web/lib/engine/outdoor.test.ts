import { describe, expect, it } from "vitest";
import { outdoorRange, outdoorWorkout } from "./outdoor";
import { ramp, steady, workoutDuration } from "./workout";

describe("outdoor workouts", () => {
  it("turns ramps into steps at their mean and keeps the rest", () => {
    const workout = { name: "Sweet spot", segments: [ramp(600, 0.5, 0.75), steady(1200, 0.9), { kind: "freeRide" as const, duration: 300 }] };
    const out = outdoorWorkout(workout);
    expect(out.segments.slice(0, 5)).toEqual([steady(120, 0.53), steady(120, 0.58), steady(120, 0.63), steady(120, 0.68), steady(120, 0.73)]);
    expect(out.segments.slice(5)).toEqual(workout.segments.slice(1));
    expect(workoutDuration(out)).toBe(workoutDuration(workout));
  });

  it("gives each target a range around it", () => {
    expect(outdoorRange(0.9)).toEqual({ low: 0.87, high: 0.93 });
    expect(outdoorRange(0.02)).toEqual({ low: 0, high: 0.05 });
  });
});
