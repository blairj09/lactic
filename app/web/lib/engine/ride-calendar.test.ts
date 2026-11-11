import { describe, expect, it } from "vitest";
import { filterRides, monthWeeks, NO_FILTERS, rideSetting, rideTotals, rideType, shiftMonth, zoneFromIntensity, zoneFromName, type CalendarRide } from "./ride-calendar";

const ride = (over: Partial<CalendarRide>): CalendarRide => ({
  id: "a",
  name: "Ride",
  startedAt: "2026-10-01T15:00:00Z",
  date: "2026-10-01",
  source: "app",
  durationSeconds: 3600,
  distanceMeters: null,
  normalizedPower: 200,
  trainingStress: 60,
  stressMethod: "power",
  duplicateOf: null,
  intervalsId: null,
  setting: "indoor",
  zone: "endurance",
  zoneEstimated: false,
  note: "",
  ...over,
});

describe("rideSetting", () => {
  it("puts app and Zwift rides indoors and tracked rides outside", () => {
    expect(rideSetting("app", false)).toBe("indoor");
    expect(rideSetting("zwift_fit", true)).toBe("indoor");
    expect(rideSetting("karoo_fit", true)).toBe("outdoor");
    expect(rideSetting("fit", false)).toBe("indoor");
    expect(rideSetting("strava", false)).toBeNull();
  });
});

describe("rideType", () => {
  it("prefers the planned zone", () => {
    expect(rideType("vo2max", 0.8)).toEqual({ zone: "vo2max", estimated: false });
  });
  it("guesses from intensity otherwise", () => {
    expect(rideType(null, 0.72)).toEqual({ zone: "endurance", estimated: true });
    expect(zoneFromIntensity(0.5)).toBe("recovery");
    expect(zoneFromIntensity(0.9)).toBe("sweetSpot");
    expect(zoneFromIntensity(1.1)).toBe("vo2max");
    expect(rideType(null, null)).toBeNull();
  });
  it("reads the workout from the ride's name before its intensity", () => {
    // A sweet spot ride whose whole-ride intensity reads as threshold against an older, lower FTP.
    expect(rideType(null, 0.95, "Sweet spot 3 × 12")).toEqual({ zone: "sweetSpot", estimated: true });
    expect(rideType("tempo", 0.95, "Sweet spot 3 × 12")).toEqual({ zone: "tempo", estimated: false });
    expect(rideType(null, 0.95, "Evening ride")).toEqual({ zone: "threshold", estimated: true });
    expect(zoneFromName("SST (Long)")).toBe("sweetSpot");
    expect(zoneFromName("Threshold 2 × 20")).toBe("threshold");
    expect(zoneFromName("VO2 max 5 × 4")).toBe("vo2max");
    // Names that point two ways, or nowhere, leave it to intensity.
    expect(zoneFromName("Endurance with tempo bursts")).toBeNull();
    expect(zoneFromName("Zwift ride")).toBeNull();
    expect(zoneFromName(null)).toBeNull();
  });
});

describe("filterRides", () => {
  const rides = [
    ride({ id: "1", name: "Sweet spot 3x15", zone: "sweetSpot", note: "Legs felt heavy" }),
    ride({ id: "2", name: "Café ride", source: "karoo_fit", setting: "outdoor" }),
    ride({ id: "3", name: "Zwift copy", source: "zwift_fit", duplicateOf: "1" }),
  ];
  it("hides copies unless asked", () => {
    expect(filterRides(rides, NO_FILTERS).map((r) => r.id)).toEqual(["1", "2"]);
    expect(filterRides(rides, { ...NO_FILTERS, copies: true })).toHaveLength(3);
  });
  it("searches name, note and type, every word, ignoring case and accents", () => {
    expect(filterRides(rides, { ...NO_FILTERS, query: "heavy SWEET" }).map((r) => r.id)).toEqual(["1"]);
    expect(filterRides(rides, { ...NO_FILTERS, query: "cafe" }).map((r) => r.id)).toEqual(["2"]);
    expect(filterRides(rides, { ...NO_FILTERS, query: "sweet spot" }).map((r) => r.id)).toEqual(["1"]);
  });
  it("filters by source, setting and zone", () => {
    expect(filterRides(rides, { ...NO_FILTERS, setting: "outdoor" }).map((r) => r.id)).toEqual(["2"]);
    expect(filterRides(rides, { ...NO_FILTERS, source: "app" }).map((r) => r.id)).toEqual(["1"]);
    expect(filterRides(rides, { ...NO_FILTERS, zone: "endurance" }).map((r) => r.id)).toEqual(["2"]);
  });
});

describe("month grid", () => {
  it("covers the month in Monday-first weeks", () => {
    const weeks = monthWeeks("2026-11");
    expect(weeks[0][0]).toBe("2026-10-26");
    expect(weeks.at(-1)!.at(-1)).toBe("2026-12-06");
    expect(weeks).toHaveLength(6);
    expect(monthWeeks("2027-02")).toHaveLength(4);
  });
  it("shifts months across years", () => {
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
  });
  it("totals leave copies out", () => {
    expect(rideTotals([ride({}), ride({ id: "b", duplicateOf: "a" })])).toEqual({ count: 1, durationSeconds: 3600, trainingStress: 60 });
  });
});
