import { describe, expect, it } from "vitest";
import { endAlert, endAlertKey, type EndAlertRide } from "./end-alert";

const ride: EndAlertRide = {
  workoutName: "Sweet spot 3x12",
  position: 3000,
  duration: 3600,
  running: true,
  finished: false,
  ended: false,
  erg: null,
  extend: { kind: "erg", minutes: 10, watts: 180, block: "VO2 max intervals" },
};

describe("ride-end alert", () => {
  it("is due when the workout's time runs out", () => {
    const a = endAlert(ride, "James's MacBook");
    expect(a).toMatchObject({ key: "Sweet spot 3x12|3600", inSeconds: 600, extendLabel: "Extend 10 min at 180 W", extendSeconds: 600 });
    expect(a?.body).toContain("James's MacBook");
  });

  it("goes off now once the workout has finished", () => {
    expect(endAlert({ ...ride, running: false, finished: true, position: 3600 }, "Mac")?.inSeconds).toBe(0);
  });

  it("isn't waiting while paused, after End, with no ride or in free ERG", () => {
    expect(endAlert({ ...ride, running: false }, "Mac")).toBeNull();
    expect(endAlert({ ...ride, ended: true, finished: true }, "Mac")).toBeNull();
    expect(endAlert({ ...ride, erg: { watts: 200 } }, "Mac")).toBeNull();
    expect(endAlert(null, "Mac")).toBeNull();
  });

  it("names the Extend pick and gets a new key once extended", () => {
    expect(endAlert({ ...ride, extend: { ...ride.extend, kind: "freeRide" } }, "Mac")?.extendLabel).toBe("Free ride 10 min");
    expect(endAlert({ ...ride, extend: { ...ride.extend, kind: "block", minutes: 12 } }, "Mac")?.extendLabel).toBe("Add VO2 max intervals (12 min)");
    expect(endAlertKey("Sweet spot 3x12", 3600 + 600)).not.toBe(endAlert(ride, "Mac")?.key);
  });
});
