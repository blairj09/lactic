import { describe, expect, it } from "vitest";
import { AutoPause, easeIn } from "./auto-pause";

describe("auto-pause", () => {
  it("pauses a few seconds after you stop pedaling, and resumes when you start again", () => {
    const auto = new AutoPause();
    expect(auto.update(true, 90, 200, 0)).toBe(null);
    expect(auto.update(true, 0, 0, 1000)).toBe(null);
    expect(auto.update(true, 0, 0, 3000)).toBe(null);
    expect(auto.update(true, 0, 0, 4000)).toBe("pause");
    expect(auto.paused).toBe(true);
    expect(auto.update(false, 0, 0, 9000)).toBe(null);
    expect(auto.update(false, 60, 80, 10_000)).toBe(null);
    expect(auto.update(false, 70, 120, 11_000)).toBe("resume");
    expect(auto.paused).toBe(false);
  });

  it("ignores a short stop, like standing up to stretch", () => {
    const auto = new AutoPause();
    auto.update(true, 0, 0, 0);
    auto.update(true, 0, 0, 2000);
    expect(auto.update(true, 85, 190, 2500)).toBe(null);
    expect(auto.update(true, 0, 0, 3500)).toBe(null);
  });

  it("leaves a ride you paused yourself paused", () => {
    const auto = new AutoPause();
    expect(auto.update(false, 90, 200, 0)).toBe(null);
    expect(auto.update(false, 90, 200, 5000)).toBe(null);
  });

  it("counts power alone as pedaling when there's no cadence", () => {
    const auto = new AutoPause();
    auto.update(true, undefined, 150, 0);
    expect(auto.update(true, undefined, 150, 10_000)).toBe(null);
  });

  it("eases ERG back to the target over ten seconds", () => {
    expect(easeIn(200, 0)).toBe(100);
    expect(easeIn(200, 5)).toBe(150);
    expect(easeIn(200, 10)).toBe(200);
  });
});
