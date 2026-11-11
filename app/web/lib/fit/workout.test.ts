import { describe, expect, it } from "vitest";
import { encodeWorkoutFit, foldRepeats, workoutSteps } from "./workout";
import { fitCrc } from "./writer";
import { ramp, sprint, steady, type Workout } from "@/lib/engine/workout";

const intervals = Array.from({ length: 5 }, () => [steady(240, 1.1), steady(120, 0.5)]).flat();
const workout: Workout = {
  name: "5x4 VO2",
  segments: [ramp(600, 0.5, 0.75), ...intervals, sprint(15, 2), { kind: "freeRide", duration: 300 }, ramp(240, 0.6, 0.4)],
};

describe("FIT workout", () => {
  it("writes a file whose checksums hold", () => {
    const bytes = encodeWorkoutFit(workout, new Date("2026-11-10T12:00:00Z"));
    expect(fitCrc(bytes.subarray(0, 14))).toBe(0);
    expect(fitCrc(bytes)).toBe(0);
    expect(String.fromCharCode(...bytes)).toContain("5x4 VO2\u0000");
  });

  it("splits ramps into steps and gives each steady target a range in percent of FTP", () => {
    const steps = workoutSteps(workout);
    const warmup = steps.filter((s) => s.intensity === "warmup");
    expect(warmup).toHaveLength(5);
    expect(warmup.reduce((t, s) => t + s.seconds, 0)).toBe(600);
    expect(steps.find((s) => s.name === "Work")).toMatchObject({ seconds: 240, power: { low: 107, high: 113 }, intensity: "active" });
    expect(steps.find((s) => s.name === "Easy")).toMatchObject({ seconds: 120, intensity: "rest" });
    expect(steps.find((s) => s.name === "All out")?.power).toBeNull();
    expect(steps.find((s) => s.name === "Free ride")?.power).toBeNull();
    expect(steps.at(-1)?.intensity).toBe("cooldown");
  });

  it("folds repeated intervals into a repeat step", () => {
    const planned = foldRepeats(workoutSteps(workout));
    const repeat = planned.find((p) => "repeatFrom" in p);
    expect(repeat).toEqual({ repeatFrom: 5, times: 5 });
    // 5 warm-up steps, on, off, repeat, all out, free ride, 2 cool-down steps.
    expect(planned).toHaveLength(12);
  });
});
