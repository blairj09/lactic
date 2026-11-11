import { describe, expect, it } from "vitest";
import { parseZwo, writeZwo } from "./zwo";
import { ramp, sprint, steady, type Workout } from "./workout";

const workout: Workout = {
  name: "Over-unders & <stuff>",
  segments: [ramp(600, 0.5, 0.75), steady(300, 1.05), steady(180, 0.55), sprint(15, 2), { kind: "freeRide", duration: 300 }, ramp(300, 0.6, 0.4)],
};

describe("writeZwo", () => {
  it("reads back as the same workout", () => {
    expect(parseZwo(writeZwo(workout))).toEqual(workout);
  });

  it("tags the first ramp up as the warm-up and the last ramp down as the cool-down", () => {
    const xml = writeZwo(workout);
    expect(xml).toContain('<Warmup Duration="600" PowerLow="0.5" PowerHigh="0.75"/>');
    expect(xml).toContain('<Cooldown Duration="300" PowerLow="0.6" PowerHigh="0.4"/>');
    expect(xml).toContain('<MaxEffort Duration="15"/>');
    expect(xml).toContain("<name>Over-unders &amp; &lt;stuff&gt;</name>");
  });
});
