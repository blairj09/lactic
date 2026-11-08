import { describe, expect, it } from "vitest";
import { checkFtp, retestDay } from "./ftp-check";
import { STARTING_LEVELS } from "./library";
import { buildPlan, type Availability } from "./plan";

const today = "2026-11-12";
const estimate = (watts: number) => ({ watts, method: "criticalPower" as const });

describe("FTP check", () => {
  it("suggests a retest when the last test is over eight weeks old, or there's none", () => {
    expect(checkFtp({ today, ftp: 250, history: [{ effectiveDate: "2026-09-01", watts: 250, method: "rampTest" }], estimate: null, plan: null }).stale).toEqual({ lastTest: "2026-09-01", days: 72 });
    expect(checkFtp({ today, ftp: 250, history: [{ effectiveDate: "2026-10-20", watts: 250, method: "rampTest" }], estimate: null, plan: null }).stale).toBeNull();
    // An estimate applied from rides isn't a test.
    expect(checkFtp({ today, ftp: 250, history: [{ effectiveDate: "2026-11-01", watts: 250, method: "criticalPower" }], estimate: null, plan: null }).stale).toEqual({ lastTest: null, days: null });
    expect(checkFtp({ today, ftp: null, history: [], estimate: null, plan: null }).stale).toBeNull();
  });

  it("doesn't nudge when the plan already has a test coming", () => {
    const plan = buildPlan({ today, goals: [], availability: [0, 60, 60, 60, 0, 120, 90], fitness: 50, fatigue: 50, levels: STARTING_LEVELS, frame: { start: "2026-10-01", end: "2026-11-15", goal: "ftp" } });
    expect(plan.weeks.some((w) => w.days.some((d) => d.role === "test"))).toBe(true);
    expect(checkFtp({ today, ftp: 250, history: [], estimate: null, plan }).stale).toBeNull();
  });

  it("says FTP looks higher only when the estimate is clearly above it and FTP hasn't just changed", () => {
    const history = [{ effectiveDate: "2026-10-01", watts: 250, method: "rampTest" }];
    expect(checkFtp({ today, ftp: 250, history, estimate: estimate(262.4), plan: null }).higher).toEqual({ watts: 262, gain: 12, method: "criticalPower" });
    expect(checkFtp({ today, ftp: 250, history, estimate: estimate(254), plan: null }).higher).toBeNull();
    expect(checkFtp({ today, ftp: 250, history: [{ effectiveDate: "2026-11-10", watts: 250, method: "manual" }], estimate: estimate(270), plan: null }).higher).toBeNull();
  });
});

describe("retest day", () => {
  const availability: Availability = [0, 60, 90, 60, 0, 180, 120];
  const plan = buildPlan({ today: "2026-11-09", goals: [], availability, fitness: 50, fatigue: 50, levels: STARTING_LEVELS });
  const minutes = (date: string) => availability[(new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7];

  it("takes a key session's place when no easy day is clear of hard days", () => {
    // Tue and Thu sit beside Wednesday's key day and Saturday's long ride before Sunday's, so the test takes Wednesday.
    expect(retestDay(plan, "2026-11-09", minutes, false)).toBe("2026-11-11");
  });

  it("prefers an easy day clear of hard days", () => {
    const roomy: Availability = [60, 60, 0, 60, 0, 180, 0];
    const p = buildPlan({ today: "2026-11-09", goals: [], availability: roomy, fitness: 50, fatigue: 50, levels: STARTING_LEVELS });
    const at = (date: string) => roomy[(new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7];
    const day = retestDay(p, "2026-11-09", at, false)!;
    const roles = new Map(p.weeks.flatMap((w) => w.days).map((d) => [d.date, d.role]));
    expect(["easy", "rest", "long"]).toContain(roles.get(day));
  });

  it("skips today once it's ridden", () => {
    expect(retestDay(plan, "2026-11-11", minutes, true)).not.toBe("2026-11-11");
  });
});

describe("an estimate applied today", () => {
  it("can be undone back to the FTP before it", () => {
    const history = [
      { effectiveDate: "2026-09-01", watts: 240, method: "rampTest" },
      { effectiveDate: today, watts: 259, method: "criticalPower" },
    ];
    expect(checkFtp({ today, ftp: 259, history, estimate: estimate(259), plan: null }).applied).toEqual({ watts: 259, previous: 240 });
    expect(checkFtp({ today, ftp: 259, history: [{ effectiveDate: today, watts: 259, method: "rampTest" }], estimate: null, plan: null }).applied).toBeNull();
  });
});
