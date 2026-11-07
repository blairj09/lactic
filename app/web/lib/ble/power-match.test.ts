import { describe, expect, it } from "vitest";
import { PowerMatch } from "./power-match";

/** Feeds a second of riding: the trainer and the meter each report once. */
function ride(match: PowerMatch, seconds: number, trainer: number, meter: number, from = 0) {
  let changed = false;
  for (let s = 0; s < seconds; s++) {
    const at = (from + s) * 1000;
    changed = match.addTrainer(trainer, at) || changed;
    changed = match.addMeter(meter, at + 200) || changed;
  }
  return changed;
}

describe("power match", () => {
  it("asks the trainer for more when it reads high against the pedals", () => {
    const match = new PowerMatch();
    expect(match.target(200)).toBe(200);
    // The trainer says 206 W while the pedals say 200: it reads 3% high.
    expect(ride(match, 15, 206, 200)).toBe(true);
    expect(match.ratio).toBeCloseTo(1.03, 3);
    expect(match.target(200)).toBe(206);
  });

  it("waits for enough riding before moving", () => {
    const match = new PowerMatch();
    expect(ride(match, 5, 220, 200)).toBe(false);
    expect(match.target(200)).toBe(200);
  });

  it("ignores coasting and readings that have gone stale", () => {
    const match = new PowerMatch();
    ride(match, 30, 30, 0);
    expect(match.ratio).toBe(1);
    // Only the trainer is talking: the last pedal reading is too old to pair with.
    match.addMeter(200, 0);
    for (let s = 5; s < 40; s++) match.addTrainer(220, s * 1000);
    expect(match.ratio).toBe(1);
  });

  it("doesn't chase small wobbles or a wild difference", () => {
    const match = new PowerMatch();
    ride(match, 30, 201, 200);
    expect(match.ratio).toBe(1);
    ride(match, 60, 300, 200, 100);
    expect(match.ratio).toBe(1.2);
  });

  it("starts over on reset", () => {
    const match = new PowerMatch();
    ride(match, 30, 190, 200);
    expect(match.ratio).toBeCloseTo(0.95, 3);
    match.reset();
    expect(match.target(250)).toBe(250);
  });
});
