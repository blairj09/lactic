import { describe, expect, it } from "vitest";
import { isAllOut, sprint, steady, type Workout } from "../engine/workout";
import { templateById } from "../engine/templates";
import { parseZwo } from "../engine/zwo";
import { allOutAt, clampGrade } from "./sprint";

describe("sprints", () => {
  const workout: Workout = { name: "w", segments: [steady(60, 0.5), sprint(10, 1.6), steady(60, 0.5), steady(10, 2.2), { ...steady(10, 2.5), allOut: false }] };

  it("marks sprints and anything from 2x FTP as all out, unless told otherwise", () => {
    expect(workout.segments.map(isAllOut)).toEqual([false, true, false, true, false]);
    expect(isAllOut({ kind: "freeRide", duration: 30 })).toBe(false);
  });

  it("finds the sprint under way", () => {
    expect(allOutAt(workout, 59)).toBe(false);
    expect(allOutAt(workout, 60)).toBe(true);
    expect(allOutAt(workout, 69)).toBe(true);
    expect(allOutAt(workout, 70)).toBe(false);
    expect(allOutAt(workout, 135)).toBe(true);
    expect(allOutAt(workout, 145)).toBe(false);
    expect(allOutAt(workout, 500)).toBe(false);
  });

  it("keeps the grade in range", () => {
    expect(clampGrade(20)).toBe(15);
    expect(clampGrade(-9)).toBe(-5);
    expect(clampGrade(2.6)).toBe(3);
    expect(clampGrade(NaN)).toBe(0);
  });

  it("comes from Sprints workouts and Zwift's MaxEffort blocks", () => {
    const t = templateById("anaerobic-sprints")!;
    const main = t.main(t.defaults(3), 3, 3600)!;
    expect(main.segments.filter(isAllOut).length).toBeGreaterThanOrEqual(3);
    expect(main.segments.filter((s) => s.kind === "steady" && s.target < 1).some(isAllOut)).toBe(false);
    const zwo = parseZwo('<workout_file><name>S</name><workout><SteadyState Duration="60" Power="0.5"/><MaxEffort Duration="15"/></workout></workout_file>');
    expect(zwo.segments.map(isAllOut)).toEqual([false, true]);
  });
});
