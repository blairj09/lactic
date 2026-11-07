import { describe, expect, it } from "vitest";
import { STARTING_LEVELS } from "./library";
import { applyPicks, unpickedKeyDays } from "./picks";
import { buildPlan, DEFAULT_RAMP_RATE, type Availability } from "./plan";

const today = "2026-11-02";
const availability: Availability = [0, 60, 90, 60, 0, 180, 120];
const plan = buildPlan({ today, goals: [], availability, fitness: 50, fatigue: 50, levels: STARTING_LEVELS, rampRate: DEFAULT_RAMP_RATE });
const keys = plan.weeks.flatMap((w) => w.days).filter((d) => d.role === "key");

describe("coach picks over the plan", () => {
  it("rebuilds a key day in the picked structure at the engine's level and length, with the reason", () => {
    const day = keys[0];
    const template = `${day.session!.zone}-intervals` === day.session!.template ? other(day.session!.zone) : `${day.session!.zone}-intervals`;
    const out = applyPicks(plan, [{ date: day.date, template, reason: "Because." }], today, { fitness: 50, fatigue: 50 });
    const picked = out.weeks.flatMap((w) => w.days).find((d) => d.date === day.date)!;
    expect(picked.session!.template).toBe(template);
    expect(picked.session!.level).toBe(day.session!.level);
    expect(picked.session!.duration).toBe(day.session!.duration);
    expect(picked.why).toBe("Because.");
    expect(picked.stress).toBe(picked.session!.stress);
  });

  it("ignores picks that no longer fit the day", () => {
    const day = keys[0];
    const wrongZone = day.session!.zone === "vo2max" ? "threshold-overunder" : "vo2max-3030";
    const rest = plan.weeks.flatMap((w) => w.days).find((d) => d.role === "rest")!;
    expect(applyPicks(plan, [{ date: day.date, template: wrongZone, reason: "x" }, { date: rest.date, template: "vo2max-3030", reason: "x" }], today, { fitness: 50, fatigue: 50 })).toBe(plan);
  });

  it("lists key days still waiting for a pick", () => {
    const through = keys[keys.length - 1].date;
    expect(unpickedKeyDays(plan, [], today, through)).toHaveLength(keys.length);
    const pick = { date: keys[0].date, template: `${keys[0].session!.zone}-intervals`, reason: "x" };
    expect(unpickedKeyDays(plan, [pick], today, through)).toHaveLength(keys.length - 1);
  });
});

function other(zone: string) {
  return { tempo: "tempo-bursts", sweetSpot: "sweetSpot-surges", threshold: "threshold-overunder", vo2max: "vo2max-3030", anaerobic: "anaerobic-attacks" }[zone]!;
}
