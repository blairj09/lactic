import { describe, expect, it } from "vitest";
import { contourInterval, doubleHeights, metersPerPixel, paintLandscape, terrariumHeights, tileLat } from "./landscape";

describe("landscape", () => {
  it("reads Terrarium heights", () => {
    // 1,500 m is 32768 + 1500 = 34268 = 133 * 256 + 220.
    expect(Array.from(terrariumHeights([133, 220, 0, 255, 128, 0, 128, 255]))).toEqual([1500, 0.5]);
  });

  it("doubles heights smoothly", () => {
    const out = doubleHeights([0, 10, 0, 10], 2);
    expect(out).toHaveLength(16);
    expect(Array.from(out.slice(0, 4))).toEqual([0, 2.5, 7.5, 10]);
  });

  it("knows a tile's scale and picks closer contours up close", () => {
    expect(tileLat(0, 0)).toBeCloseTo(0, 5);
    expect(metersPerPixel(14, 42.5)).toBeCloseTo(7.04, 1);
    expect(contourInterval(7)).toBe(10);
    expect(contourInterval(30)).toBe(50);
    expect(contourInterval(600)).toBe(250);
  });

  it("paints higher ground lighter, lit slopes brighter, and draws contours", () => {
    const size = 16;
    // Slopes of 2 m a pixel across 10 m pixels: one rising to the east (it faces west), one rising to the west.
    const east = Float32Array.from({ length: size * size }, (_, i) => 1500 + (i % size) * 2);
    const west = Float32Array.from({ length: size * size }, (_, i) => 1530 - (i % size) * 2);
    const flatLow = new Float32Array(size * size).fill(1403);
    const flatHigh = new Float32Array(size * size).fill(2203);
    const lum = (px: Uint8ClampedArray, i: number) => px[i * 4] + px[i * 4 + 1] + px[i * 4 + 2];
    const low = paintLandscape(flatLow, size, 10, 1400, 2300, "night");
    const high = paintLandscape(flatHigh, size, 10, 1400, 2300, "night");
    expect(lum(high, 40)).toBeGreaterThan(lum(low, 40));
    expect(low[40 * 4 + 3]).toBe(255);
    // Light comes from the northwest: the west-facing slope is lit, the east-facing one is in shade.
    const lit = paintLandscape(east, size, 10, 1400, 2300, "day");
    const shaded = paintLandscape(west, size, 10, 1400, 2300, "day");
    const mid = 8 * size + 7;
    expect(lum(shaded, mid)).toBeLessThan(lum(lit, mid));
    // 10 m contours on the 2 m-a-pixel slope: every fifth column carries a line, flat ground has none.
    const row = Array.from({ length: size - 1 }, (_, x) => lum(shaded, 8 * size + x));
    expect(new Set(row).size).toBeGreaterThan(1);
    expect(new Set(Array.from({ length: size }, (_, x) => lum(low, 8 * size + x))).size).toBe(1);
  });
});
