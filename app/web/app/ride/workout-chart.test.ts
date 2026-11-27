import { describe, expect, it } from "vitest";
import { thinTrace, traceStep, type TracePoint } from "./workout-chart";

const ride = (seconds: number): TracePoint[] => Array.from({ length: seconds }, (_, t) => [t, 200 + (t % 7), 140, 90]);

describe("thinTrace", () => {
  it("keeps one point per step of workout", () => {
    expect(thinTrace(ride(30), 10).map(([p]) => p)).toEqual([0, 10, 20]);
  });

  it("keeps the same points as the trace grows, so the chart holds still", () => {
    const step = traceStep(3600);
    const before = thinTrace(ride(1200), step);
    const after = thinTrace(ride(1201), step);
    expect(after.slice(0, before.length)).toEqual(before);
  });

  it("draws the same points from a trace the computer already thinned for the phone", () => {
    const step = traceStep(3600);
    for (const seconds of [900, 901, 902, 1500]) {
      const full = ride(seconds);
      const recent = seconds - 600;
      const sent = thinTrace(full, step, ([t]) => t >= recent);
      expect(thinTrace(sent, step)).toEqual(thinTrace(full, step));
    }
  });

  it("starts a new stretch after a jump back", () => {
    const trace: TracePoint[] = [[0, 1, 0, 0], [12, 1, 0, 0], [5, 1, 0, 0]];
    expect(thinTrace(trace, 10).map(([p]) => p)).toEqual([0, 12, 5]);
  });
});
