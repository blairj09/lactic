import { describe, expect, it } from "vitest";
import { buildSession, openers, rampTest, ZONES } from "./library";
import { TEMPLATES } from "./templates";
import { alignRamps, ramp, sprint, steady, type Segment } from "./workout";
import { updateSegment } from "./workout-edit";
import { WORKOUT_LIBRARY } from "./workout-library";

const start = (s: Segment) => (s.kind === "steady" ? s.target : s.kind === "ramp" ? s.from : null);
const end = (s: Segment) => (s.kind === "steady" ? s.target : s.kind === "ramp" ? s.to : null);

/** The warm-up never overshoots an easy first interval, and the cool-down never starts above an easy last one. */
function expectNoOvershoot(segments: Segment[]) {
  const [first, next] = segments;
  if (first?.kind === "ramp" && first.to > first.from && next) {
    const meet = start(next);
    if (meet !== null && meet <= 0.8 && meet > first.from) expect(first.to).toBe(meet);
  }
  const last = segments[segments.length - 1];
  const prev = segments[segments.length - 2];
  if (last?.kind === "ramp" && last.from > last.to && prev) {
    const leave = end(prev);
    if (leave !== null && leave <= 0.8 && leave > last.to) expect(last.from).toBe(leave);
  }
}

describe("alignRamps", () => {
  it("ends the warm-up at the first interval and starts the cool-down at the last", () => {
    const out = alignRamps([ramp(600, 0.45, 0.7), steady(300, 0.65), steady(600, 0.6), ramp(300, 0.65, 0.4)]);
    expect(out[0]).toEqual(ramp(600, 0.45, 0.65));
    expect(out[3]).toEqual(ramp(300, 0.6, 0.4));
  });

  it("keeps the step up into a hard first effort and down from a hard last one", () => {
    const segments = [ramp(600, 0.45, 0.7), steady(300, 1.1), steady(300, 1.2), ramp(300, 0.65, 0.4)];
    expect(alignRamps(segments)).toEqual(segments);
    const sprinted = [ramp(600, 0.45, 0.7), sprint(10, 0.75), ramp(300, 0.65, 0.4)];
    expect(alignRamps(sprinted)[0]).toEqual(sprinted[0]);
  });

  it("leaves ramps in the middle of a workout alone", () => {
    const segments = [steady(300, 0.6), ramp(300, 0.9, 1.05), steady(300, 0.6)];
    expect(alignRamps(segments)).toEqual(segments);
  });
});

describe("built workouts", () => {
  it("line up for every zone, level and template", () => {
    for (const zone of ZONES)
      for (const level of [1, 4, 8])
        for (const duration of [2700, 3600, 5400]) expectNoOvershoot(buildSession(zone, level, duration).workout.segments);
    for (const t of TEMPLATES) expectNoOvershoot(buildSession(t.zone, 4, 3600, { template: t.id }).workout.segments);
    expectNoOvershoot(openers().workout.segments);
    expectNoOvershoot(rampTest().workout.segments);
  });

  it("line up in the starter library", () => {
    for (const w of WORKOUT_LIBRARY) expectNoOvershoot(w.workout.segments);
  });

  it("the classic structure's warm-up meets its first interval", () => {
    const segments = openers().workout.segments;
    expect(segments[0]).toEqual(ramp(600, 0.45, 0.65));
  });
});

describe("editing", () => {
  it("a joined warm-up follows the first interval", () => {
    const workout = { name: "w", segments: [ramp(600, 0.45, 0.6), steady(600, 0.6), ramp(300, 0.6, 0.4)] };
    const edited = updateSegment(workout, 1, steady(600, 0.7));
    expect(edited.segments[0]).toEqual(ramp(600, 0.45, 0.7));
    expect(edited.segments[2]).toEqual(ramp(300, 0.7, 0.4));
  });

  it("a warm-up the rider set apart stays where they put it", () => {
    const workout = { name: "w", segments: [ramp(600, 0.45, 0.5), steady(600, 0.6), steady(600, 0.6)] };
    expect(updateSegment(workout, 1, steady(600, 0.7)).segments[0]).toEqual(ramp(600, 0.45, 0.5));
  });
});
