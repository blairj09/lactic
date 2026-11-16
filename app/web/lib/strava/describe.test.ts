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
    expect(workoutShape(workout)).toBe("▂▃▃▅▅▅▂▅▅▅▂▅▅▅▇▃▂▂");
  });

  it("gives every short rep a bar", () => {
    const vo2: Workout = { name: "VO2", segments: [ramp(600, 0.45, 0.7), ...Array.from({ length: 5 }, () => [steady(180, 1.15), steady(180, 0.5)]).flat(), ramp(600, 0.6, 0.45)] };
    expect(workoutShape(vo2).match(/█/g)?.length).toBe(5);
  });

  it("keeps long, busy workouts to a phone line", () => {
    const busy: Workout = { name: "30/30s", segments: [ramp(600, 0.45, 0.7), ...Array.from({ length: 40 }, () => [steady(30, 1.3), steady(30, 0.5)]).flat(), ramp(600, 0.6, 0.45)] };
    expect([...workoutShape(busy)]).toHaveLength(20);
  });

  it("is the shape and the signature, nothing else", () => {
    expect(stravaDescription(ride)).toBe(`▂▃▃▅▅▅▂▅▅▅▂▅▅▅▇▃▂▂\n\n${LACTIC_SIGNATURE}`);
    expect(stravaDescription({ ...ride, workout: null })).toBe(LACTIC_SIGNATURE);
    expect(workoutShape({ name: "Free", segments: [{ kind: "freeRide", duration: 3600 }] })).toBe("▂".repeat(20));
  });

  it("titles a free ride", () => {
    expect(stravaTitle({ name: "", workout: null })).toBe("Lactic ride");
    expect(stravaTitle({ name: null, workout })).toBe("Sweet Spot 3×12");
  });
});
