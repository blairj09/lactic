import { describe, expect, it } from "vitest";
import { CATEGORY_RINGS, powerProfile, profileCategory, profileScore } from "./profile";

describe("power profile", () => {
  it("anchors the table's untrained and world class rows at 0 and 100", () => {
    expect(profileScore(1.86, "ft")).toBeCloseTo(0);
    expect(profileScore(6.4, "ft")).toBeCloseTo(100);
    expect(profileScore(4.13, "ft")).toBeCloseTo(50);
  });

  it("clamps outside the table", () => {
    expect(profileScore(1, "ft")).toBe(0);
    expect(profileScore(30, "5s")).toBe(100);
  });

  it("rates against the women's table when asked", () => {
    expect(profileScore(5.69, "ft", "female")).toBeCloseTo(100);
    expect(profileScore(5.69, "ft", "male")).toBeLessThan(100);
  });

  it("spreads eight categories evenly", () => {
    expect(profileCategory(0)).toBe("Untrained");
    expect(profileCategory(12.4)).toBe("Untrained");
    expect(profileCategory(12.5)).toBe("Fair");
    expect(profileCategory(45)).toBe("Good");
    expect(profileCategory(100)).toBe("World class");
    expect(CATEGORY_RINGS).toHaveLength(7);
  });

  it("rates a 75 kg rider with a 300 W FTP as good at threshold", () => {
    // 20 minute best of 316 W: 95% is 300 W, 4.0 W/kg.
    const profile = powerProfile({ 5: 1000, 60: 600, 300: 360, 1200: 316, 3600: 290 }, 75, "male");
    const threshold = profile.points.find((p) => p.axis === "threshold")!;
    expect(threshold.wattsPerKg).toBeCloseTo(4.21, 2);
    expect(threshold.category).toBe("Good");
    expect(profile.points.map((p) => p.axis)).toEqual(["sprint", "anaerobic", "vo2max", "threshold", "endurance"]);
  });

  it("leaves durations without an effort unrated", () => {
    const profile = powerProfile({ 5: 900, 60: 500, 300: 320 }, 70, null);
    const endurance = profile.points.find((p) => p.axis === "endurance")!;
    expect(endurance).toMatchObject({ watts: null, wattsPerKg: null, score: null, category: null });
  });

  it("reads the rider type from the shape", () => {
    expect(powerProfile({ 5: 1400, 60: 700, 300: 330, 1200: 280, 3600: 250 }, 75).type).toBe("sprinter");
    expect(powerProfile({ 5: 850, 60: 480, 300: 380, 1200: 340, 3600: 320 }, 75).type).toBe("time trialist");
    // Every axis near 50.
    const even = { 5: 75 * 17.7, 60: 75 * 8.57, 300: 75 * 4.97, 1200: (75 * 4.13) / 0.95, 3600: 75 * 4.13 };
    expect(powerProfile(even, 75).type).toBe("all-rounder");
  });

  it("needs at least three rated durations for a type", () => {
    expect(powerProfile({ 5: 900, 60: 500 }, 70).type).toBeNull();
  });
});
