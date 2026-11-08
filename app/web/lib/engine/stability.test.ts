import { describe, expect, it } from "vitest";
import { STARTING_LEVELS } from "./library";
import { buildPlan, type Availability, type Goal } from "./plan";
import { driftOffer, inputsKey, keepWeek, weekDrift } from "./stability";

const availability: Availability = [0, 60, 90, 60, 0, 180, 120];
const plan = (fitness: number, today = "2026-11-09", goals: Goal[] = []) => buildPlan({ today, goals, availability, fitness, fatigue: fitness, levels: STARTING_LEVELS });
const start = { fitness: 50, fatigue: 50 };

describe("plan stability", () => {
  it("keeps the week's skeleton when fitness moves", () => {
    const monday = plan(50);
    const kept = { week: "2026-11-09", days: monday.weeks[0].days, inputs: "x" };
    const later = plan(60, "2026-11-11");
    const stable = keepWeek(later, kept, "2026-11-11", start);
    expect(stable.weeks[0].days).toEqual(monday.weeks[0].days);
    expect(stable.weeks[1]).toEqual(later.weeks[1]);
    expect(stable.weeks[0].stress).toBe(Math.round(monday.weeks[0].days.reduce((s, d) => s + d.stress, 0)));
  });

  it("offers a re-plan only past 15% drift over the days left", () => {
    const kept = plan(50).weeks[0].days;
    expect(driftOffer(weekDrift(kept, plan(50).weeks[0].days, "2026-11-11"))).toBe(false);
    const drift = weekDrift(kept, plan(15).weeks[0].days, "2026-11-11")!;
    expect(drift.share).toBeLessThan(-0.15);
    expect(driftOffer(drift)).toBe(true);
    expect(weekDrift(kept, kept, "2026-11-20")).toBeNull();
  });

  it("ignores a kept week from another week", () => {
    const p = plan(50);
    expect(keepWeek(p, { week: "2026-11-02", days: p.weeks[0].days, inputs: "" }, "2026-11-09", start)).toBe(p);
  });

  it("sees a change to what the plan is built from", () => {
    expect(inputsKey({ availability })).not.toBe(inputsKey({ availability: [0, 60, 90, 60, 0, 180, 90] }));
  });
});

describe("named safety rules", () => {
  it("names the rule on each eased day around a B event", () => {
    const race: Goal = { id: "b", name: "Local crit", date: "2026-11-14", priority: "B", kind: "criterium" };
    const days = plan(50, "2026-11-09", [race]).weeks[0].days;
    expect(days.find((d) => d.date === "2026-11-13")?.rule).toBe("beforeEvent");
    expect(days.find((d) => d.date === "2026-11-15")?.rule).toBe("afterEvent");
  });

  it("names the recovery week on its rides", () => {
    const p = buildPlan({ today: "2026-11-09", goals: [], availability, fitness: 50, fatigue: 50, levels: STARTING_LEVELS, horizonWeeks: 8 });
    const recovery = p.weeks.find((w) => w.recoveryWeek)!;
    expect(recovery.days.filter((d) => d.session).every((d) => d.rule === "recoveryWeek")).toBe(true);
    const normal = p.weeks.find((w) => !w.recoveryWeek)!;
    expect(normal.days.some((d) => d.rule)).toBe(false);
  });
});
