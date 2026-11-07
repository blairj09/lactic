import { describe, expect, it } from "vitest";
import {
  clampRange,
  keepersWithCopyData,
  compareRange,
  matchingPreset,
  powerDistribution,
  presetRange,
  rangeLength,
  summarizeRange,
  timeInZones,
  zoomRange,
  type RangeRide,
} from "./analysis";
import { powerHistogram, sumHistograms } from "./power";

describe("power histogram", () => {
  it("counts seconds per 10 W bin and ends at the top bin", () => {
    expect(powerHistogram([0, 5, 12, 19, 20, 35])).toEqual([2, 2, 1, 1]);
  });

  it("sums bin by bin across lengths", () => {
    expect(sumHistograms([1, 2], [0, 1, 5])).toEqual([1, 3, 5]);
  });
});

describe("date ranges", () => {
  it("presets end today and count today", () => {
    expect(presetRange("4w", "2026-10-29", "2024-01-01")).toEqual({ from: "2026-10-02", to: "2026-10-29" });
    expect(rangeLength(presetRange("4w", "2026-10-29", "2024-01-01"))).toBe(28);
    expect(presetRange("all", "2026-10-29", "2024-01-01")).toEqual({ from: "2024-01-01", to: "2026-10-29" });
    expect(matchingPreset({ from: "2026-10-02", to: "2026-10-29" }, "2026-10-29", "2024-01-01")).toBe("4w");
    expect(matchingPreset({ from: "2026-10-03", to: "2026-10-29" }, "2026-10-29", "2024-01-01")).toBeNull();
  });

  it("compares with the period just before or a year earlier", () => {
    const range = { from: "2026-10-02", to: "2026-10-29" };
    expect(compareRange(range, "previous")).toEqual({ from: "2026-09-04", to: "2026-10-01" });
    expect(compareRange({ from: "2024-02-29", to: "2024-03-10" }, "lastYear")).toEqual({ from: "2023-02-28", to: "2023-03-10" });
  });

  it("zooms around the middle and stays inside the bounds", () => {
    const bounds = { from: "2026-01-01", to: "2026-12-31" };
    const zoomedIn = zoomRange({ from: "2026-03-01", to: "2026-04-29" }, 0.5, bounds);
    expect(rangeLength(zoomedIn)).toBe(30);
    expect(zoomedIn.from > "2026-03-01" && zoomedIn.to < "2026-04-29").toBe(true);
    expect(zoomRange({ from: "2026-12-01", to: "2026-12-31" }, 4, bounds)).toEqual({ from: "2026-08-30", to: "2026-12-31" });
    expect(zoomRange(bounds, 2, bounds)).toEqual(bounds);
    expect(rangeLength(zoomRange({ from: "2026-03-01", to: "2026-03-08" }, 0.1, bounds))).toBe(7);
  });

  it("clamps and orders a range", () => {
    expect(clampRange({ from: "2027-02-01", to: "2025-06-01" }, { from: "2026-01-01", to: "2026-12-31" })).toEqual({
      from: "2026-01-01",
      to: "2026-12-31",
    });
  });
});

describe("range summaries", () => {
  const ride = (date: string, watts: number[], ftp: number | null = 200): RangeRide => ({
    date,
    durationSeconds: watts.length,
    ftp,
    powerCurve: { 1: Math.max(...watts) },
    powerHistogram: powerHistogram(watts),
  });

  it("adds up only the rides in the range", () => {
    const rides = [ride("2026-10-01", [100, 100, 300]), ride("2026-10-05", [150, 400]), ride("2026-11-01", [900])];
    const summary = summarizeRange(rides, { from: "2026-10-01", to: "2026-10-31" });
    expect(summary.rides).toBe(2);
    expect(summary.seconds).toBe(5);
    expect(summary.curve[1]).toBe(400);
    expect(summary.histogram.reduce((a, b) => a + b, 0)).toBe(5);
  });

  it("splits a bin across a zone boundary", () => {
    // FTP 200: zone 1 ends at 110 W, so the 100-110 bin is all zone 1 and 105 W sits in it.
    expect(timeInZones(powerHistogram([105]), 200)[0]).toBeCloseTo(1);
    // FTP 190: zone 1 ends at 104.5 W, so the 100-110 bin is 45% zone 1, 55% zone 2.
    const zones = timeInZones(powerHistogram([105]), 190);
    expect(zones[0]).toBeCloseTo(0.45);
    expect(zones[1]).toBeCloseTo(0.55);
    expect(timeInZones(powerHistogram([1000]), 200)[6]).toBeCloseTo(1);
  });

  it("leaves rides without an FTP out of zones", () => {
    const summary = summarizeRange([ride("2026-10-01", [100, 200], null)], { from: "2026-10-01", to: "2026-10-01" });
    expect(summary.zones.reduce((a, b) => a + b, 0)).toBe(0);
  });

  it("shares distribution bins and leaves coasting out by default", () => {
    const histogram = powerHistogram([0, 0, 0, 0, 100, 110, 120, 250]);
    const bins = powerDistribution(histogram, 50);
    expect(bins.map((b) => b.from)).toEqual([0, 50, 100, 150, 200, 250]);
    expect(bins[2].seconds).toBe(3);
    expect(bins[2].share).toBeCloseTo(0.75);
    expect(powerDistribution(histogram, 50, { includeCoasting: true })[0].seconds).toBe(4);
  });
});

describe("copies", () => {
  it("keeps one ride per real ride and borrows a copy's histogram", () => {
    const rides = [
      { id: "app", duplicateOf: null, powerCurve: { 1: 500 }, powerHistogram: null },
      { id: "zwift", duplicateOf: "app", powerCurve: { 1: 490 }, powerHistogram: [0, 5] },
      { id: "other", duplicateOf: null, powerCurve: null, powerHistogram: null },
    ];
    expect(keepersWithCopyData(rides)).toEqual([
      { id: "app", duplicateOf: null, powerCurve: { 1: 500 }, powerHistogram: [0, 5] },
      { id: "other", duplicateOf: null, powerCurve: null, powerHistogram: null },
    ]);
  });
});
