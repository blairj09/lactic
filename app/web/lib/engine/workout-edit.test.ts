import { describe, expect, it } from "vitest";
import { ramp, steady, workoutDuration, type Workout } from "./workout";
import {
  blankWorkout,
  changeKind,
  duplicateSegment,
  editable,
  insertSegments,
  minDuration,
  moveSegment,
  parseDuration,
  readWorkout,
  removeSegment,
  repeats,
  updateSegment,
} from "./workout-edit";

const workout: Workout = { name: "Test", segments: [ramp(600, 0.5, 0.75), steady(300, 1), steady(180, 0.5), ramp(300, 0.65, 0.45)] };

describe("workout editing", () => {
  it("updates one interval and clamps its numbers", () => {
    const next = updateSegment(workout, 1, steady(1.4, 9));
    expect(next.segments[1]).toEqual(steady(5, 3));
    expect(next.segments[0]).toBe(workout.segments[0]);
    expect(workout.segments[1]).toEqual(steady(300, 1));
  });

  it("inserts, duplicates, removes and moves", () => {
    expect(insertSegments(workout, -1, [steady(60, 0.4)]).segments[0]).toEqual(steady(60, 0.4));
    expect(insertSegments(workout, 3, [steady(60, 0.4)]).segments[4]).toEqual(steady(60, 0.4));
    const dup = duplicateSegment(workout, 1);
    expect(dup.segments.map((s) => s.duration)).toEqual([600, 300, 300, 180, 300]);
    expect(removeSegment(workout, 0).segments).toHaveLength(3);
    expect(removeSegment({ name: "x", segments: [steady(60, 1)] }, 0).segments).toHaveLength(1);
    expect(moveSegment(workout, 1, 1).segments.slice(1, 3)).toEqual([steady(180, 0.5), steady(300, 1)]);
    expect(moveSegment(workout, 0, -1)).toBe(workout);
  });

  it("builds repeats and a blank workout", () => {
    const block = repeats(3, { duration: 240, target: 1.05 }, { duration: 120, target: 0.5 });
    expect(block).toHaveLength(6);
    expect(block[4]).toEqual(steady(240, 1.05));
    expect(workoutDuration(blankWorkout())).toBe(900);
  });

  it("changes an interval's kind keeping its length", () => {
    expect(changeKind(steady(300, 1), "ramp")).toEqual(ramp(300, 0.85, 1.15));
    expect(changeKind(ramp(300, 0.5, 0.7), "steady")).toEqual(steady(300, 0.6));
    expect(changeKind(steady(300, 1), "freeRide")).toEqual({ kind: "freeRide", duration: 300 });
  });

  it("locks what's ridden mid-ride", () => {
    expect(editable(workout, 0, 0)).toBe("free");
    expect(editable(workout, 700, 0)).toBe("done");
    expect(editable(workout, 700, 1)).toBe("current");
    expect(editable(workout, 700, 2)).toBe("free");
    expect(minDuration(workout, 700, 1)).toBe(105);
    expect(minDuration(workout, 700, 2)).toBe(5);
  });

  it("reads durations", () => {
    expect(parseDuration("6:30")).toBe(390);
    expect(parseDuration("1:02:00")).toBe(3720);
    expect(parseDuration("90s")).toBe(90);
    expect(parseDuration("5")).toBe(300);
    expect(parseDuration("2.5m")).toBe(150);
    expect(parseDuration("6:75")).toBeNull();
    expect(parseDuration("abc")).toBeNull();
  });

  it("reads saved workouts and rejects bad ones", () => {
    expect(readWorkout(JSON.parse(JSON.stringify(workout)))).toEqual(workout);
    expect(readWorkout({ name: "  ", segments: [{ kind: "steady", duration: 60, target: 0.7 }] })?.name).toBe("My workout");
    expect(readWorkout({ name: "x", segments: [] })).toBeNull();
    expect(readWorkout({ name: "x", segments: [{ kind: "steady", duration: "60", target: 1 }] })).toBeNull();
    expect(readWorkout({ name: "x", segments: [{ kind: "sprint", duration: 60 }] })).toBeNull();
    expect(readWorkout(null)).toBeNull();
  });
});
