import { describe, expect, it } from "vitest";
import type { Goal } from "../plan";
import type { Route } from "../ride-detail";
import { FOLLOW_UP_DAYS, eventOnDay, raceFollowUp, raceRide } from "./followup";
import { raceGlance, sameCourse, trackFromStored, type HistoryRide, type RideFigures } from "./glance";
import { parseResults } from "./results";

// A made-up 40 km out-and-back, north from a town square.
const LAT0 = 41.7;
const LNG0 = -111.8;
const north = (meters: number, east = 0): [number, number] => [LAT0 + meters / 110_540, LNG0 + east / (111_320 * Math.cos((LAT0 * Math.PI) / 180))];
const outAndBack = (km: number, east = 0): Route => {
  const out: Route = [];
  for (let m = 0; m <= km * 500; m += 50) out.push(north(m, east));
  for (let m = km * 500; m >= 0; m -= 50) out.push(north(m, east));
  return out;
};

const race: RideFigures = {
  id: "race",
  name: "Valley Classic",
  startedAt: Date.UTC(2026, 9, 3, 15),
  durationSeconds: 3900,
  distanceMeters: 40_000,
  averagePower: 228,
  normalizedPower: 262,
  averageHr: 168,
  powerCurve: { 15: 880, 60: 520, 300: 352, 1200: 291, 3600: 265 },
};

const past = (id: string, year: number, seconds: number, route = outAndBack(40), event: string | null = "Valley Classic"): HistoryRide => ({
  ...race,
  id,
  startedAt: Date.UTC(year, 9, 4, 15),
  durationSeconds: seconds,
  powerCurve: { 15: 800, 60: 470, 300: 330 },
  route,
  event,
});

const RESULTS = parseResults(`1 Rowan Pike 1:03:40
2 Ellis Marsh 1:04:02
3 Tobin Reyes 1:04:30
4 Sam Quill 1:04:51
5 Avery Lake 1:05:00
6 Jordan Fell 1:06:10
7 Casey Wren 1:07:45
8 Dana Holt 1:09:12`);

describe("raceGlance", () => {
  it("puts peak powers against the 90-day best, in W/kg", () => {
    const g = raceGlance({ race, route: outAndBack(40), weightKg: 72, bestCurve: { 15: 950, 60: 540, 300: 340, 1200: 300, 3600: 270 }, results: [], ownRow: null, history: [] });
    expect(g.peaks.map((p) => p.seconds)).toEqual([15, 60, 300, 1200, 3600]);
    const five = g.peaks.find((p) => p.seconds === 300)!;
    expect(five).toMatchObject({ watts: 352, wkg: 4.89, best: 340, newBest: true });
    expect(g.npWkg).toBe(3.64);
    expect(g.headlines[0]).toBe("Your best 5-minute power in 90 days: 352 W (4.9 W/kg).");
  });

  it("lists several new bests in one line", () => {
    const g = raceGlance({ race, route: null, weightKg: 72, bestCurve: { 15: 800, 60: 500, 300: 340, 1200: 300, 3600: 270 }, results: [], ownRow: null, history: [] });
    expect(g.headlines[0]).toBe("New 90-day bests over 15 s, 1 min and 5 min, 352 W (4.9 W/kg) for 5 min.");
  });

  it("leaves out peaks longer than the race", () => {
    const g = raceGlance({ race: { ...race, durationSeconds: 2400 }, route: null, weightKg: null, bestCurve: null, results: [], ownRow: null, history: [] });
    expect(g.peaks.map((p) => p.seconds)).toEqual([15, 60, 300, 1200]);
    expect(g.peaks[0].wkg).toBeNull();
  });

  it("reads the placing from the results", () => {
    const own = RESULTS.find((r) => r.name === "Sam Quill")!;
    const g = raceGlance({ race, route: null, weightKg: 72, bestCurve: null, results: RESULTS, ownRow: own, history: [] });
    expect(g.placing).toMatchObject({ place: 4, of: 8, share: 0.5, toWinner: 71, toPodium: 21, ahead: { name: "Tobin Reyes", gap: 21 }, behind: { name: "Avery Lake", gap: 9 } });
    expect(g.headlines[0]).toBe("4th of 8, top 50%, 1:11 behind Rowan Pike.");
    expect(g.headlines[1]).toBe("0:21 from 3rd, Tobin Reyes.");
  });

  it("finds earlier rides of the same course, newest first", () => {
    const history = [
      past("y2024", 2024, 4100),
      past("y2025", 2025, 4020),
      past("elsewhere", 2025, 3900, outAndBack(40, 3000), null),
      past("short", 2025, 1900, outAndBack(20), null),
    ];
    const g = raceGlance({ race, route: outAndBack(40), weightKg: 72, bestCurve: null, results: [], ownRow: null, history });
    expect(g.past.map((p) => p.id)).toEqual(["y2025", "y2024"]);
    expect(g.past[0]).toMatchObject({ delta: -120, peaks: { 300: 330 } });
    expect(g.headlines).toContain("2:00 faster than Valley Classic (2025).");
  });
});

describe("sameCourse", () => {
  it("is near 1 on the same roads and low for a short loop inside a long ride", () => {
    expect(sameCourse(outAndBack(40), outAndBack(40, 40))).toBeGreaterThan(0.95);
    expect(sameCourse(outAndBack(40), outAndBack(10))).toBeLessThan(0.5);
    expect(sameCourse(outAndBack(40), outAndBack(40, 2000))).toBe(0);
  });
});

describe("raceFollowUp", () => {
  const goal = (id: string, date: string, priority: Goal["priority"] = "A"): Goal => ({ id, name: `Race ${id}`, date, priority, kind: "roadRace" });
  const rides = [
    { id: "warmup", day: "2026-11-07", durationSeconds: 1200, hasRoute: true },
    { id: "race", day: "2026-11-07", durationSeconds: 2500, hasRoute: true },
    { id: "trainer", day: "2026-11-07", durationSeconds: 3600, hasRoute: false },
  ];
  const none = new Set<string>();

  it("points to the longest GPS ride on the event's day", () => {
    expect(raceRide(rides, "2026-11-07")?.id).toBe("race");
    expect(raceFollowUp({ goals: [goal("a", "2026-11-07")], rides, today: "2026-11-09", opened: none, dismissed: none })).toMatchObject({ rideId: "race", daysAgo: 2 });
  });

  it("stops once opened, dismissed, or a week has gone by", () => {
    const goals = [goal("a", "2026-11-07")];
    expect(raceFollowUp({ goals, rides, today: "2026-11-09", opened: new Set(["race"]), dismissed: none })).toBeNull();
    expect(raceFollowUp({ goals, rides, today: "2026-11-09", opened: none, dismissed: new Set(["race"]) })).toBeNull();
    expect(raceFollowUp({ goals, rides, today: `2026-11-${7 + FOLLOW_UP_DAYS + 1}`, opened: none, dismissed: none })).toBeNull();
  });

  it("skips an event with no ride, and picks the higher priority on a shared day", () => {
    expect(raceFollowUp({ goals: [goal("a", "2026-11-08")], rides, today: "2026-11-09", opened: none, dismissed: none })).toBeNull();
    expect(eventOnDay([goal("c", "2026-11-07", "C"), goal("b", "2026-11-07", "B")], "2026-11-07")?.id).toBe("b");
  });
});

describe("trackFromStored", () => {
  it("turns a stored route and stream into a timed track", () => {
    const route: Route = [[LAT0, LNG0, 0], [LAT0 + 0.001, LNG0, 20], [LAT0 + 0.002, LNG0, 41]];
    const t = trackFromStored(route, 1_700_000_000_000, { step: 5, watts: [200, 210, 220, 230, 240, 250, 260, 270, 280], heartRate: null, cadence: null }, "You, 2025");
    expect(t?.points.map((p) => [p.t, p.watts])).toEqual([[1_700_000_000, 200], [1_700_000_020, 240], [1_700_000_041, 280]]);
    expect(trackFromStored([[LAT0, LNG0], [LAT0 + 0.001, LNG0]], 0, { step: 5, watts: null, heartRate: null, cadence: null }, null)).toBeNull();
  });
});
