import { describe, expect, it } from "vitest";
import { AppWatch } from "./app-watch";

describe("AppWatch", () => {
  it("gets the head unit ready once each time a training app opens", () => {
    const w = new AppWatch();
    expect(w.update(null, false)).toBe(false);
    expect(w.update("Zwift", false)).toBe(true);
    expect(w.update("Zwift", false)).toBe(false);
    expect(w.update("Zwift", false)).toBe(false);
    expect(w.update(null, false)).toBe(false);
    expect(w.update("Zwift", false)).toBe(true);
  });

  it("leaves a ride under way alone, and doesn't come back to it later in the same session", () => {
    const w = new AppWatch();
    expect(w.update("Zwift", true)).toBe(false);
    expect(w.update("Zwift", false)).toBe(false);
  });

  it("counts a different app as a new open", () => {
    const w = new AppWatch();
    expect(w.update("Zwift", false)).toBe(true);
    expect(w.update("Rouvy", false)).toBe(true);
  });
});
