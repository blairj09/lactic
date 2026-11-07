import { describe, expect, it } from "vitest";
import { AutoStart } from "./auto-start";

describe("auto-start", () => {
  it("starts after a few seconds of pedaling", () => {
    const auto = new AutoStart();
    expect(auto.update(0, 0, 0)).toBe(false);
    expect(auto.countdown(0)).toBe(null);
    expect(auto.update(80, 150, 1000)).toBe(false);
    expect(auto.countdown(2000)).toBe(2);
    expect(auto.update(85, 160, 3000)).toBe(false);
    expect(auto.update(85, 160, 4000)).toBe(true);
  });

  it("starts over when you stop before it starts", () => {
    const auto = new AutoStart();
    auto.update(80, 150, 0);
    auto.update(80, 150, 2000);
    expect(auto.update(0, 0, 2500)).toBe(false);
    expect(auto.update(80, 150, 3000)).toBe(false);
    expect(auto.update(80, 150, 5500)).toBe(false);
    expect(auto.update(80, 150, 6000)).toBe(true);
  });

  it("ignores a crank turned slowly while clipping in", () => {
    const auto = new AutoStart();
    for (let t = 0; t <= 10_000; t += 1000) expect(auto.update(10, 15, t)).toBe(false);
  });
});
