import { describe, expect, it } from "vitest";
import { ageOn, bodyComposition, bodyTrend, type BodyPoint } from "./body";

const z = { rightArm: 250, leftArm: 252, trunk: 25, rightLeg: 225, leftLeg: 226 };

describe("body composition", () => {
  it("applies the Sun et al. equation to right-side impedance", () => {
    const b = bodyComposition({ weightKg: 75, heightCm: 180, male: true, impedance50kHz: z });
    // R = 500: FFM = -10.68 + 0.65 * 180²/500 + 0.26 * 75 + 0.02 * 500 = 60.94
    expect(b.fatFreeMassKg).toBeCloseTo(60.94, 2);
    expect(b.bodyFatPercent).toBeCloseTo(18.75, 2);
    expect(b.bmi).toBeCloseTo(23.15, 2);
  });

  it("uses the women's equation", () => {
    const b = bodyComposition({ weightKg: 60, heightCm: 165, male: false, impedance50kHz: z });
    expect(b.fatFreeMassKg).toBeCloseTo(-9.53 + (0.69 * 165 * 165) / 500 + 0.17 * 60 + 10, 2);
  });

  it("gives weight and BMI only when contact was poor", () => {
    const b = bodyComposition({ weightKg: 75, heightCm: 180, male: true, impedance50kHz: { ...z, leftLeg: 0 } });
    expect(b).toMatchObject({ fatFreeMassKg: null, bodyFatPercent: null });
    expect(b.bmi).toBeGreaterThan(0);
  });

  it("counts whole years of age", () => {
    expect(ageOn("1990-10-30", "2026-10-29")).toBe(35);
    expect(ageOn("1990-10-29", "2026-10-29")).toBe(36);
  });
});

describe("body trend", () => {
  const now = new Date("2026-10-29T12:00:00Z");
  const at = (daysAgo: number, weightKg: number, bodyFatPercent: number | null): BodyPoint => ({
    measuredAt: new Date(now.getTime() - daysAgo * 86_400_000),
    weightKg,
    bodyFatPercent,
  });

  it("compares this week's average with the week a month ago", () => {
    const t = bodyTrend([at(33, 76, 20), at(31, 76.4, 19), at(3, 75, 18), at(1, 75.4, null)], now);
    expect(t.weightKg).toBeCloseTo(-1, 5);
    expect(t.bodyFatPercent).toBeCloseTo(-1.5, 5);
  });

  it("has no trend without readings at both ends", () => {
    expect(bodyTrend([at(1, 75, 18)], now)).toEqual({ weightKg: null, bodyFatPercent: null });
  });
});
