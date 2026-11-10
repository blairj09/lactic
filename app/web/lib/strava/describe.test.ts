import { describe, expect, it } from "vitest";
import type { RideInterval } from "../engine/ride-detail";
import { ramp, steady, type Workout } from "../engine/workout";
import { intervalLines, LACTIC_SIGNATURE, stravaDescription, stravaTitle, totalsLine, type PostedRide } from "./describe";

const workout: Workout = {
  name: "Sweet Spot 3×12",
  segments: [ramp(600, 0.45, 0.7), steady(720, 0.9), steady(300, 0.5), steady(720, 0.9), steady(300, 0.5), steady(720, 0.9), steady(300, 1.05), ramp(600, 0.6, 0.45)],
};

const iv = (index: number, planned: number, target: number | null, power: number | null, ridden = planned): RideInterval => ({ index, kind: workout.segments[index].kind, planned, ridden, target, power, heartRate: null, cadence: null });

const intervals = [iv(0, 600, 150, 152), iv(1, 720, 265, 268), iv(2, 300, 148, 150), iv(3, 720, 265, 266), iv(4, 300, 148, 149), iv(5, 720, 265, 263), iv(6, 300, 309, 312), iv(7, 600, 150, 140)];

const ride: PostedRide = { name: "Sweet Spot 3×12", durationSeconds: 4500, averagePower: 220, normalizedPower: 241.4, trainingStress: 82.2, intensityFactor: 0.857, averageHr: 148.3, workout, intervals };

describe("rides posted to Strava", () => {
  it("groups matching work intervals and leaves warm-up, recoveries and cool-down out", () => {
    expect(intervalLines(workout, intervals)).toEqual(["3 × 12 min at 265 W: 268, 266, 263 W", "5 min at 309 W: 312 W"]);
  });

  it("marks skipped intervals", () => {
    const skipped = intervals.map((x) => (x.index === 5 ? { ...x, ridden: 0, power: null } : x));
    expect(intervalLines(workout, skipped)[0]).toBe("3 × 12 min at 265 W: 268, 266, skipped W");
  });

  it("writes the totals the engine worked out", () => {
    expect(totalsLine(ride)).toBe("1h15 · NP 241 W · TSS 82 · IF 0.86 · Avg HR 148");
    expect(totalsLine({ ...ride, normalizedPower: null, trainingStress: null, intensityFactor: null, averageHr: null })).toBe("1h15 · Avg 220 W");
  });

  it("signs the description and titles a free ride", () => {
    const text = stravaDescription(ride);
    expect(text.startsWith("3 × 12 min at 265 W")).toBe(true);
    expect(text.endsWith(LACTIC_SIGNATURE)).toBe(true);
    expect(stravaDescription({ ...ride, workout: null, intervals: null })).toBe(`1h15 · NP 241 W · TSS 82 · IF 0.86 · Avg HR 148\n\n${LACTIC_SIGNATURE}`);
    expect(stravaTitle({ name: "", workout: null })).toBe("Lactic ride");
  });
});
