import { afterEach, describe, expect, it } from "vitest";
import { defaultUnits, formatDistance, formatElevation, formatWeight, heightToCm, parseUnits, readUnits, setUnits, speedIn, tempDeltaIn, weightToKg, UNITS_KEY } from "./units";

const store = new Map<string, string>();
Object.assign(globalThis, {
  localStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) },
});

afterEach(() => store.clear());

describe("units", () => {
  it("defaults from the locale's region", () => {
    expect(defaultUnits("en-US")).toBe("imperial");
    expect(defaultUnits("en")).toBe("imperial"); // English alone maximizes to en-Latn-US
    expect(defaultUnits("en-GB")).toBe("metric");
    expect(defaultUnits("de-DE")).toBe("metric");
    expect(defaultUnits("es-US")).toBe("imperial");
    expect(defaultUnits("my-MM")).toBe("imperial");
    expect(defaultUnits(undefined)).toBe("metric");
    expect(defaultUnits("not a locale")).toBe("metric");
  });

  it("keeps the rider's choice over the locale, and the first-run pick of imperial", () => {
    expect(parseUnits("furlongs")).toBeNull();
    store.set("lactic.units", "imperial");
    expect(readUnits()).toBe("imperial");
    setUnits("metric");
    expect(store.get(UNITS_KEY)).toBe("metric");
    expect(readUnits()).toBe("metric");
  });

  it("converts for show and back for saving", () => {
    expect(formatWeight(72, "metric")).toBe("72.0 kg");
    expect(formatWeight(72, "imperial")).toBe("158.7 lb");
    expect(weightToKg(158.7, "imperial")).toBeCloseTo(71.99, 2);
    expect(heightToCm(70, "imperial")).toBeCloseTo(177.8, 1);
    expect(formatDistance(40_000, "metric")).toBe("40.0 km");
    expect(formatDistance(40_000, "imperial")).toBe("24.9 mi");
    expect(formatElevation(500, "imperial")).toBe("1640 ft");
    expect(speedIn(10, "imperial")).toBeCloseTo(22.37, 2);
    expect(tempDeltaIn(0.5, "imperial")).toBeCloseTo(0.9, 5);
  });
});
