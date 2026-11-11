import { describe, expect, it } from "vitest";
import { markDays, suggestDay, weekProgress, type ComplianceDay } from "./compliance";

const session = (stress: number) => ({ duration: 3600, stress });
const ride = (id: string, trainingStress: number) => ({ id, durationSeconds: 3600, trainingStress });

describe("markDays", () => {
  it("marks done, partial, missed and unplanned", () => {
    const days: ComplianceDay[] = [
      { date: "2026-10-26", planned: session(60), rides: [ride("a", 58)] },
      { date: "2026-10-27", planned: session(80), rides: [ride("b", 40)] },
      { date: "2026-10-28", planned: null, rides: [] },
      { date: "2026-10-29", planned: null, rides: [] },
      { date: "2026-10-30", planned: session(50), rides: [] },
      { date: "2026-10-31", planned: session(50), rides: [] },
    ];
    const marks = markDays(days, "2026-10-31");
    expect(marks.get("2026-10-26")?.mark).toBe("done");
    expect(marks.get("2026-10-27")).toMatchObject({ mark: "partial", share: 0.5 });
    expect(marks.has("2026-10-28")).toBe(false);
    expect(marks.get("2026-10-30")?.mark).toBe("missed");
    // Today isn't missed yet.
    expect(marks.has("2026-10-31")).toBe(false);
  });

  it("counts a session ridden on the rest day next to it as moved", () => {
    const days: ComplianceDay[] = [
      { date: "2026-10-26", planned: session(60), rides: [] },
      { date: "2026-10-27", planned: null, rides: [ride("a", 62)] },
      { date: "2026-10-28", planned: null, rides: [ride("b", 30)] },
    ];
    const marks = markDays(days, "2026-10-31");
    expect(marks.get("2026-10-26")).toMatchObject({ mark: "moved", movedTo: "2026-10-27" });
    expect(marks.get("2026-10-27")).toMatchObject({ mark: "moved", movedFrom: "2026-10-26" });
    expect(marks.get("2026-10-28")?.mark).toBe("unplanned");
  });

  it("ignores rides from before the plan started", () => {
    // The plan starts on Wednesday; Tuesday's ride came before it and can't stand in for Wednesday's session.
    const days: ComplianceDay[] = [
      { date: "2026-11-02", planned: null, rides: [ride("a", 50)], beforePlan: true },
      { date: "2026-11-03", planned: null, rides: [ride("b", 78)], beforePlan: true },
      { date: "2026-11-04", planned: session(60), rides: [] },
    ];
    const marks = markDays(days, "2026-11-04");
    expect(marks.size).toBe(0);
    expect(markDays(days, "2026-11-05").get("2026-11-04")?.mark).toBe("missed");
  });
});

describe("weekProgress", () => {
  it("adds up planned, planned to date and done", () => {
    const days: ComplianceDay[] = [
      { date: "2026-10-26", planned: session(60), rides: [ride("a", 55)] },
      { date: "2026-10-27", planned: null, rides: [ride("b", 20)] },
      { date: "2026-10-28", planned: session(80), rides: [] },
    ];
    expect(weekProgress(days, "2026-10-28")).toEqual({ planned: 140, plannedToDate: 60, done: 75 });
  });

  it("leaves out rides from before the plan started", () => {
    const days: ComplianceDay[] = [
      { date: "2026-11-03", planned: null, rides: [ride("a", 78)], beforePlan: true },
      { date: "2026-11-04", planned: session(60), rides: [ride("b", 58)] },
    ];
    expect(weekProgress(days, "2026-11-04")).toEqual({ planned: 60, plannedToDate: 0, done: 58 });
  });
});

describe("suggestDay", () => {
  it("suggests the nearest open planned day for a ride on an unplanned day", () => {
    const days: ComplianceDay[] = [
      { date: "2026-11-02", planned: session(60), rides: [] },
      { date: "2026-11-03", planned: session(60), rides: [ride("a", 60)] },
      { date: "2026-11-04", planned: null, rides: [ride("b", 70)] },
      { date: "2026-11-05", planned: session(50), rides: [] },
    ];
    // The day before is ridden; two days before ties with the day after, which is past today.
    expect(suggestDay(days, "2026-11-04", "2026-11-04")).toBe("2026-11-02");
    expect(suggestDay(days, "2026-11-04", "2026-11-06")).toBe("2026-11-05");
  });

  it("suggests nothing when the ride's own day was planned or nothing is open", () => {
    const days: ComplianceDay[] = [
      { date: "2026-11-03", planned: session(60), rides: [ride("a", 60)] },
      { date: "2026-11-04", planned: null, rides: [ride("b", 70)] },
    ];
    expect(suggestDay(days, "2026-11-03", "2026-11-04")).toBeNull();
    expect(suggestDay(days, "2026-11-04", "2026-11-04")).toBeNull();
  });

  it("suggests nothing for a ride from before the plan started", () => {
    const days: ComplianceDay[] = [
      { date: "2026-11-03", planned: null, rides: [ride("a", 60)], beforePlan: true },
      { date: "2026-11-04", planned: session(60), rides: [] },
    ];
    expect(suggestDay(days, "2026-11-03", "2026-11-04")).toBeNull();
  });
});
