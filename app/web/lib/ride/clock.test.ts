import { describe, expect, it } from "vitest";
import { RideClock } from "./clock";

describe("ride clock", () => {
  it("counts wall time, not ticks", () => {
    const clock = new RideClock();
    clock.start(1_000);
    // A throttled tab might only wake once a minute; the clock still reads the real time.
    expect(clock.elapsed(61_500)).toBe(60);
  });

  it("leaves pauses out", () => {
    const clock = new RideClock();
    clock.start(0);
    clock.pause(10_000);
    expect(clock.elapsed(50_000)).toBe(10);
    clock.start(50_000);
    expect(clock.elapsed(55_000)).toBe(15);
    expect(clock.running).toBe(true);
  });

  it("starts at zero after a reset", () => {
    const clock = new RideClock();
    clock.start(0);
    clock.reset();
    expect(clock.running).toBe(false);
    expect(clock.elapsed(99_000)).toBe(0);
  });
});
