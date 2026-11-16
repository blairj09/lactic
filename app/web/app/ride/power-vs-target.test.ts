import { describe, expect, it } from "vitest";
import { powerVsTarget } from "./player";

describe("powerVsTarget", () => {
  it("works from the power reading shown, so the two always agree", () => {
    expect(powerVsTarget({ power: 230, targetWatts: 250, running: true })).toEqual({ tone: "warning", text: "20 W under" });
    expect(powerVsTarget({ power: 280, targetWatts: 250, running: true })).toEqual({ tone: "negative", text: "30 W over" });
    expect(powerVsTarget({ power: 245, targetWatts: 250, running: true })?.text).toBe("On target");
  });

  it("says nothing without a reading, a target, or while stopped", () => {
    expect(powerVsTarget({ power: undefined, targetWatts: 250, running: true })).toBeNull();
    expect(powerVsTarget({ power: 230, targetWatts: null, running: true })).toBeNull();
    expect(powerVsTarget({ power: 230, targetWatts: 250, running: false })).toBeNull();
  });
});
