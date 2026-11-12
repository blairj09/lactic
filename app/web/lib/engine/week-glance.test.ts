import { describe, expect, it } from "vitest";
import { planWeek, rideShape, weekGlance } from "./week-glance";
import type { ComplianceDay } from "./compliance";

const day = (date: string, planned: number, ridden: number[] = []): ComplianceDay => ({
  date,
  planned: planned ? { duration: 3600, stress: planned } : null,
  rides: ridden.map((s, i) => ({ id: `${date}-${i}`, durationSeconds: 3600, trainingStress: s })),
});

// Week of Monday 2026-11-09.
const week = (today: string, rides: Record<string, number[]>) =>
  weekGlance(
    [
      day("2026-11-08", 0),
      day("2026-11-09", 60, rides["2026-11-09"]),
      day("2026-11-10", 0, rides["2026-11-10"]),
      day("2026-11-11", 50, rides["2026-11-11"]),
      day("2026-11-12", 0),
      day("2026-11-13", 70),
      day("2026-11-14", 0),
      day("2026-11-15", 100),
      day("2026-11-16", 60),
    ],
    "2026-11-09",
    today,
  );

describe("weekGlance", () => {
  it("counts the week, the plan to date and what's ridden", () => {
    const g = week("2026-11-11", { "2026-11-09": [62] });
    expect(g.days).toHaveLength(7);
    expect(g.planned).toBe(280);
    // Today's 50 isn't due until ridden.
    expect(g.plannedToDate).toBe(60);
    expect(g.done).toBe(62);
    expect(g.tracking).toBe("onTrack");
    expect(g.sessions).toBe(4);
    expect(g.sessionsDone).toBe(1);
  });

  it("is behind after a missed session, and counts today once ridden", () => {
    expect(week("2026-11-11", {}).tracking).toBe("behind");
    const g = week("2026-11-11", { "2026-11-09": [60], "2026-11-11": [90] });
    expect(g.plannedToDate).toBe(110);
    expect(g.tracking).toBe("ahead");
  });

  it("is early on a Monday before riding", () => {
    expect(week("2026-11-09", {}).tracking).toBe("early");
  });
});

describe("planWeek", () => {
  it("numbers weeks from the plan's first Monday", () => {
    expect(planWeek("2026-11-02", "2027-01-24", "2026-11-09")).toEqual({ n: 2, of: 12 });
    expect(planWeek("2026-11-04", "2027-01-24", "2026-11-02")).toEqual({ n: 1, of: 12 });
    expect(planWeek("2026-11-16", "2027-01-24", "2026-11-09")).toBeNull();
  });
});

describe("weekGlance before a plan starts", () => {
  it("shows those rides but doesn't measure them", () => {
    const before = (d: ComplianceDay): ComplianceDay => ({ ...d, planned: null, beforePlan: true });
    const g = weekGlance(
      [before(day("2026-11-08", 0)), before(day("2026-11-09", 0, [80])), day("2026-11-10", 40, [40]), day("2026-11-11", 50), day("2026-11-12", 0), day("2026-11-13", 0), day("2026-11-14", 0), day("2026-11-15", 0), day("2026-11-16", 0)],
      "2026-11-09",
      "2026-11-11",
    );
    expect(g.days[0]).toMatchObject({ done: 80, beforePlan: true });
    // Every ride this week counts toward the total; only the plan's days count toward tracking.
    expect(g.done).toBe(120);
    expect(g.tracking).toBe("onTrack");
  });
});

describe("rideShape", () => {
  it("averages power into even slices", () => {
    expect(rideShape([100, 100, 200, 200, null, 0], 3)).toEqual([100, 200, 0]);
    expect(rideShape([150], 48)).toEqual([150]);
    expect(rideShape([])).toEqual([]);
  });
});
