import { describe, expect, it } from "vitest";
import { workoutDuration } from "../engine/workout";
import { addErgChange, clampErg, defaultErg, ergWorkout } from "./erg";

describe("free ERG", () => {
  it("keeps targets on the 5 W grid and in range", () => {
    expect(clampErg(183)).toBe(185);
    expect(clampErg(10)).toBe(50);
    expect(clampErg(5000)).toBe(1000);
    expect(clampErg(Number.NaN)).toBe(50);
    expect(defaultErg(250)).toBe(150);
    expect(defaultErg(0)).toBe(150);
  });

  it("starts at zero and steps when the target moves", () => {
    let changes = addErgChange([], 0, 150);
    changes = addErgChange(changes, 60, 200);
    changes = addErgChange(changes, 120, 200);
    expect(changes).toEqual([
      { at: 0, watts: 150 },
      { at: 60, watts: 200 },
    ]);
  });

  it("folds quick taps into one step, and drops one that comes back", () => {
    let changes = addErgChange([], 0, 150);
    changes = addErgChange(changes, 60, 155);
    changes = addErgChange(changes, 61, 160);
    changes = addErgChange(changes, 62, 165);
    expect(changes).toEqual([
      { at: 0, watts: 150 },
      { at: 60, watts: 165 },
    ]);
    changes = addErgChange(changes, 200, 170);
    changes = addErgChange(changes, 201, 165);
    expect(changes).toEqual([
      { at: 0, watts: 150 },
      { at: 60, watts: 165 },
    ]);
  });

  it("draws the ride so far plus the current target ahead", () => {
    const changes = [
      { at: 0, watts: 150 },
      { at: 60, watts: 200 },
    ];
    const workout = ergWorkout(changes, 100, 200, 300);
    expect(workout.segments).toEqual([
      { kind: "steady", duration: 60, target: 0.75 },
      { kind: "steady", duration: 340, target: 1 },
    ]);
    expect(workoutDuration(workout)).toBe(400);
  });
});
