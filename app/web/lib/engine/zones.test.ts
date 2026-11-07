import { describe, expect, it } from "vitest";
import { hrZones, powerZones } from "./zones";
import { powerZone } from "./workout";

describe("zones", () => {
  it("power zones match powerZone at every boundary", () => {
    const zones = powerZones(290);
    expect(zones.map((z) => [z.low, z.high])).toEqual([
      [0, 159],
      [160, 217],
      [218, 260],
      [261, 304],
      [305, 347],
      [348, 434],
      [435, null],
    ]);
    for (const z of zones) expect(powerZone(z.low / 290 + 1e-9)).toBe(z.zone);
  });

  it("heart rate zones from threshold, capped at max", () => {
    expect(hrZones(175, 190).map((z) => [z.low, z.high])).toEqual([
      [0, 120],
      [121, 146],
      [147, 165],
      [166, 185],
      [186, 190],
    ]);
    expect(hrZones(175).at(-1)).toMatchObject({ low: 186, high: null });
    expect(hrZones(175, 180).at(-1)).toMatchObject({ low: 186, high: null });
  });
});
