import { describe, expect, it } from "vitest";
import { ramp, steady, type Workout } from "../engine/workout";
import { LACTIC_SIGNATURE, stravaDescription, stravaTitle, workoutShape, type PostedRide } from "./describe";

const workout: Workout = {
  name: "Sweet Spot 3×12",
  segments: [ramp(600, 0.45, 0.7), steady(720, 0.9), steady(300, 0.5), steady(720, 0.9), steady(300, 0.5), steady(720, 0.9), steady(300, 1.05), ramp(600, 0.6, 0.45)],
};

const ride: PostedRide = { name: "Sweet Spot 3×12", durationSeconds: 4500, averagePower: 220, normalizedPower: 241.4, trainingStress: 82.2, intensityFactor: 0.857, averageHr: 148.3, workout, intervals: null };

describe("rides posted to Strava", () => {
  it("draws the workout as one line of bars", () => {
    expect(workoutShape(workout)).toBe("▂▂▃▅▅▅▂▂▅▅▅▂▂▅▅▅▆▆▂▂▁");
  });

  it("gives every longer rep its own bar", () => {
    const vo2: Workout = { name: "VO2", segments: [ramp(600, 0.45, 0.7), ...Array.from({ length: 5 }, () => [steady(180, 1.15), steady(180, 0.5)]).flat(), ramp(600, 0.6, 0.45)] };
    expect(workoutShape(vo2).match(/▇/g)?.length).toBe(5);
  });

  it("draws each set of short efforts as one block, and lone ones as a bar each", () => {
    const set = Array.from({ length: 9 }, () => [steady(30, 1.17), steady(15, 0.5)]).flat().slice(0, -1);
    const openers = [steady(20, 1.1), steady(40, 0.55), steady(20, 1.2), steady(40, 0.55), steady(20, 1.3)];
    const sets: Workout = {
      name: "30/15s",
      segments: [ramp(360, 0.45, 0.7), ...openers, steady(100, 0.55), ...set, steady(180, 0.5), ...set, steady(180, 0.5), ...set, steady(1740, 0.6), ramp(300, 0.6, 0.4)],
    };
    expect(workoutShape(sets)).toBe("▂▂▆▇▇▂▇▇▇▂▇▇▇▂▇▇▇▂▂▂▂▂▁");
  });

  it("uses only bars from one font, so the line stays even on Strava", () => {
    const shapes = [workout, { name: "Max", segments: [steady(600, 2)] }].map((w) => workoutShape(w as Workout)).join("");
    expect(shapes).not.toMatch(/[▄█▌]/);
  });

  it("keeps long, busy workouts to a phone line", () => {
    const busy: Workout = { name: "Pyramid", segments: [ramp(600, 0.45, 0.7), ...Array.from({ length: 40 }, (_, i) => [steady(120, 0.9 + (i % 4) * 0.1), steady(120, 0.5)]).flat(), ramp(600, 0.6, 0.45)] };
    expect([...workoutShape(busy)]).toHaveLength(20);
  });

  it("is the shape and the signature, nothing else", () => {
    expect(stravaDescription(ride)).toBe(`▂▂▃▅▅▅▂▂▅▅▅▂▂▅▅▅▆▆▂▂▁\n\n${LACTIC_SIGNATURE}`);
    expect(stravaDescription({ ...ride, workout: null })).toBe(LACTIC_SIGNATURE);
    expect(workoutShape({ name: "Free", segments: [{ kind: "freeRide", duration: 3600 }] })).toBe("▂".repeat(5));
  });

  it("titles a free ride", () => {
    expect(stravaTitle({ name: "", workout: null })).toBe("Lactic ride");
    expect(stravaTitle({ name: null, workout })).toBe("Sweet Spot 3×12");
  });
});
