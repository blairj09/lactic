import { describe, expect, it } from "vitest";
import { contourInterval, doubleHeights, metersPerPixel, paintLandscape, resampleHeights, terrariumHeights, tileLat } from "./landscape";

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

  it("cuts a closer tile out of a height grid", () => {
    // A 4-pixel grid rising 10 m a pixel to the east; its east half redrawn at 4 samples.
    const heights = Float32Array.from({ length: 16 }, (_, i) => (i % 4) * 10);
    const out = resampleHeights(heights, 4, 2, 0, 2, 4);
    expect(Array.from(out.slice(0, 4))).toEqual([17.5, 22.5, 27.5, 30]);
  });

  it("paints the grid look dark, with grid lines that meet across tiles and contours on slopes", () => {
    const size = 64;
    const lum = (px: Uint8ClampedArray, x: number, y: number) => px[(y * size + x) * 4] + px[(y * size + x) * 4 + 1] + px[(y * size + x) * 4 + 2];
    // Flat ground at zoom 16: the small squares are a sixteenth of the tile (too small to show at this size), the next a quarter, so lines fall on columns 0, 16, 32, 48.
    const flat = paintLandscape(new Float32Array(size * size).fill(1403), size, 2, 1400, 2300, "grid", { z: 16, x: 5, y: 9 });
    expect(lum(flat, 8, 8)).toBeLessThan(60);
    expect(lum(flat, 16, 8)).toBeGreaterThan(lum(flat, 8, 8) + 60);
    expect(lum(flat, 8, 32)).toBe(lum(flat, 16, 8));
    // A line is centered on the boundary between two pixels, and every fourth line is bolder: here the tile's edges.
    expect(lum(flat, 15, 8)).toBe(lum(flat, 16, 8));
    expect(lum(flat, 63, 8)).toBeGreaterThan(lum(flat, 16, 8));
    // A 20% slope crossing 1,500 m at column 32: a bright contour there, dark between lines.
    const slope = paintLandscape(Float32Array.from({ length: size * size }, (_, i) => 1500.2 + ((i % size) - 32) * 0.4), size, 2, 1400, 2300, "grid", { z: 16, x: 5, y: 9 });
    expect(lum(slope, 31, 8)).toBeGreaterThan(300);
    expect(lum(slope, 24, 8)).toBeLessThan(lum(slope, 31, 8) / 3);
  });
});
