import { describe, expect, it } from "vitest";
import { steady, targetWattsAt, workoutDuration, type Workout } from "../engine/workout";
import { templateById } from "../engine/templates";
import { blockMinutes, defaultExtendWatts, extendWorkout, extensionMinutes } from "./extend";

const base: Workout = { name: "Test", segments: [steady(600, 0.6), steady(300, 0.9)] };

describe("extend workout", () => {
  it("adds an ERG block at the watts asked for", () => {
    const next = extendWorkout(base, { kind: "erg", watts: 200, minutes: 10 }, 250);
    expect(workoutDuration(next)).toBe(1500);
    expect(targetWattsAt(next, 1000, 250)).toBe(200);
    expect(base.segments).toHaveLength(2);
  });

  it("lands on the watts asked for at a scaled intensity", () => {
    const next = extendWorkout(base, { kind: "erg", watts: 200, minutes: 5 }, 250, 1.1);
    const scaled = { ...next, segments: next.segments.map((s) => (s.kind === "steady" ? { ...s, target: s.target * 1.1 } : s)) };
    expect(targetWattsAt(scaled, 1000, 250)).toBe(200);
  });

  it("adds a free ride with no ERG target", () => {
    const next = extendWorkout(base, { kind: "freeRide", minutes: 20 }, 250);
    expect(next.segments[2]).toEqual({ kind: "freeRide", duration: 1200 });
    expect(targetWattsAt(next, 1000, 250)).toBe(null);
  });

  it("starts the block at endurance pace or the last steady target, whichever is lower", () => {
    expect(defaultExtendWatts(base, 250)).toBe(190);
    expect(defaultExtendWatts({ name: "x", segments: [steady(60, 0.5)] }, 250)).toBe(125);
  });

  it("marks an ERG hold so the player can move its watts", () => {
    const next = extendWorkout(base, { kind: "erg", watts: 200, minutes: 5 }, 250);
    expect(next.segments[2]).toMatchObject({ kind: "steady", duration: 300, hold: true });
  });

  it("adds a workout block from a structure, padded easy to the minutes asked for", () => {
    const vo2 = templateById("vo2max-intervals")!;
    const shortest = blockMinutes(vo2, 3);
    const next = extendWorkout(base, { kind: "block", template: vo2.id, level: 3, minutes: shortest + 5 }, 250);
    expect(workoutDuration(next)).toBe(900 + (shortest + 5) * 60);
    const added = next.segments.slice(2);
    expect(added.some((s) => s.kind === "steady" && s.target > 1)).toBe(true);
    expect(added[0]).toMatchObject({ kind: "steady", duration: 120 });
  });

  it("never makes a block shorter than its main set", () => {
    const vo2 = templateById("vo2max-intervals")!;
    const shortest = blockMinutes(vo2, 3);
    expect(shortest).toBeGreaterThan(1);
    expect(extensionMinutes({ kind: "block", template: vo2.id, level: 3, minutes: 1 })).toBe(shortest);
    const next = extendWorkout(base, { kind: "block", template: vo2.id, level: 3, minutes: 1 }, 250);
    expect(workoutDuration(next)).toBe(900 + shortest * 60);
  });
});
