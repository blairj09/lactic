import { describe, expect, it } from "vitest";
import { combineFits, fitDrag, timeError, type RideRecord } from "./calibrate";
import { airDensity, speedFor } from "./pacing";

/** A synthetic outdoor ride ridden by the physics with a known drag area, with noisy heights. */
function ride(cda: number, minutes = 60, seed = 1, draft = 0): RideRecord[] {
  let s = seed;
  const rand = () => ((s = (s * 16807) % 2147483647) / 2147483647) - 0.5;
  const setup = { cda, crr: 0.0045, bikeKg: 0, maxKmh: 70 };
  const out: RideRecord[] = [];
  let d = 0;
  let ele = 1300;
  for (let t = 0; t <= minutes * 60; t++) {
    const grade = 0.03 * Math.sin(t / 400) + 0.01 * Math.sin(t / 97);
    const watts = 200 + 60 * Math.sin(t / 150) + 20 * rand();
    const v = speedFor(watts, grade, 83, setup, airDensity(ele), 0, draft);
    out.push({ t, distance: d, altitude: ele + rand() * 1.0, power: Math.round(watts) });
    d += v;
    ele += v * grade;
  }
  return out;
}

describe("measuring drag from rides", () => {
  it("recovers the drag area a ride was ridden with", () => {
    for (const cda of [0.26, 0.32, 0.4]) {
      const fit = fitDrag(ride(cda), 83);
      expect(fit).not.toBeNull();
      expect(Math.abs(fit!.cda - cda) / cda).toBeLessThan(0.05);
    }
  });

  it("needs enough riding to say", () => {
    expect(fitDrag(ride(0.32, 5), 83)).toBeNull();
    expect(fitDrag(ride(0.32).map((r) => ({ ...r, altitude: null })), 83)).toBeNull();
  });

  it("leans on the higher-reading rides, since group rides read low", () => {
    const fits = [0.33, 0.32, 0.34, 0.2, 0.18].map((cda) => ({ cda, crr: 0.0045, blocks: 100 }));
    expect(combineFits(fits)!.cda).toBeCloseTo(0.33, 2);
    expect(combineFits(fits.slice(0, 1))).toBeNull();
  });

  it("times a ride from its own power within a couple of percent with the right drag", () => {
    const r = ride(0.32, 60, 7);
    expect(Math.abs(timeError(r, 83, { cda: 0.32, crr: 0.0045, maxKmh: 70 })!)).toBeLessThan(0.02);
    // With drag 15% too high, the model is slow.
    expect(timeError(r, 83, { cda: 0.37, crr: 0.0045, maxKmh: 70 })!).toBeGreaterThan(0.02);
  });
});
