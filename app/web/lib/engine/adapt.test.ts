import { describe, expect, it } from "vitest";
import { applyMoves, refitMissed, type RefitInput } from "./adapt";
import { markDays } from "./compliance";
import { STARTING_LEVELS } from "./library";
import { buildPlan, dayMinutes, type Availability, type Goal } from "./plan";

const start = { fitness: 50, fatigue: 50 };
// Week of Mon 2026-11-09: rest, easy 60, key 90 (Wed), easy 60, rest, long 180, key 120.
const availability: Availability = [0, 60, 90, 60, 0, 180, 120];
const base = (goals: Goal[] = [], av = availability) => buildPlan({ today: "2026-11-09", goals, availability: av, ...start, levels: STARTING_LEVELS });
const input = (today: string, over: Partial<RefitInput> = {}, av = availability): RefitInput => ({
  today,
  ridden: new Set(),
  decided: new Set(),
  minutes: (date) => dayMinutes(date, av),
  ...over,
});
const day = (plan: ReturnType<typeof base>, date: string) => plan.weeks.flatMap((w) => w.days).find((d) => d.date === date)!;

describe("moving a missed key session", () => {
  it("moves it to the next open day, shortened when that day has less time", () => {
    const plan = base();
    expect(day(plan, "2026-11-11").role).toBe("key");
    const { plan: after, moves } = refitMissed(plan, input("2026-11-12"), start);
    expect(moves.map((m) => [m.from, m.to])).toEqual([["2026-11-11", "2026-11-12"]]);
    const wed = day(after, "2026-11-11");
    const thu = day(after, "2026-11-12");
    expect(wed).toMatchObject({ role: "rest", session: null, stress: 0, movedTo: { date: "2026-11-12" } });
    expect(thu.role).toBe("key");
    expect(thu.session!.zone).toBe(day(plan, "2026-11-11").session!.zone);
    expect(thu.session!.duration).toBe(60 * 60);
    expect(thu.movedFrom).toEqual({ date: "2026-11-11", shortened: true });
    expect(after.weeks[0].stress).toBe(Math.round(after.weeks[0].days.reduce((s, d) => s + d.stress, 0)));
  });

  it("keeps the whole session when a later day has the time", () => {
    const roomy: Availability = [0, 60, 90, 90, 0, 180, 120];
    const plan = base([], roomy);
    const missed = day(plan, "2026-11-11");
    expect(missed.role).toBe("key");
    const { plan: after } = refitMissed(plan, input("2026-11-12", {}, roomy), start);
    const thu = day(after, "2026-11-12");
    expect(thu.movedFrom).toEqual({ date: "2026-11-11", shortened: false });
    expect(thu.session!.duration).toBe(missed.session!.duration);
  });

  it("leaves sessions that were ridden, chosen at check-in, or not key days", () => {
    const plan = base();
    expect(refitMissed(plan, input("2026-11-12", { ridden: new Set(["2026-11-11"]) }), start).moves).toEqual([]);
    expect(refitMissed(plan, input("2026-11-12", { decided: new Set(["2026-11-11"]) }), start).moves).toEqual([]);
    // Tuesday's easy ride was missed: nothing moves.
    expect(refitMissed(plan, input("2026-11-11"), start).moves).toEqual([]);
  });

  it("doesn't move onto a day already ridden or set by the rider", () => {
    const plan = base();
    expect(refitMissed(plan, input("2026-11-12", { ridden: new Set(["2026-11-12"]) }), start).moves).toEqual([]);
    expect(refitMissed(plan, input("2026-11-12", { decided: new Set(["2026-11-12"]) }), start).moves).toEqual([]);
  });

  it("never puts two hard days back to back, so a full week keeps it missed", () => {
    const tight: Availability = [0, 90, 60, 90, 60, 180, 120];
    const plan = base([], tight);
    expect(day(plan, "2026-11-10").role).toBe("key");
    // Wednesday sits before Thursday's key day, Friday after it; Saturday is the long ride.
    expect(refitMissed(plan, input("2026-11-11", {}, tight), start).moves).toEqual([]);
  });

  it("stays clear of the three days before a B event", () => {
    const roomy: Availability = [0, 60, 90, 90, 0, 180, 120];
    const race: Goal = { id: "b", name: "Local crit", date: "2026-11-15", priority: "B", kind: "criterium" };
    const plan = base([race], roomy);
    const missed = plan.weeks[0].days.find((d) => d.date < "2026-11-12" && d.role === "key");
    expect(missed).toBeDefined();
    expect(refitMissed(plan, input("2026-11-12", {}, roomy), start).moves).toEqual([]);
  });

  it("lays stored moves back over the rebuilt plan, and marks the missed day as moved", () => {
    const plan = base();
    const { moves } = refitMissed(plan, input("2026-11-12"), start);
    const again = applyMoves(plan, moves, "2026-11-12", start);
    expect(day(again, "2026-11-11").movedTo?.date).toBe("2026-11-12");
    expect(day(again, "2026-11-12").movedFrom).toEqual({ date: "2026-11-11", shortened: true });
    // Once stored, the missed day isn't moved a second time.
    expect(refitMissed(again, input("2026-11-13"), start).moves).toEqual([]);

    const marks = markDays([{ date: "2026-11-11", planned: null, rides: [], movedTo: "2026-11-12" }], "2026-11-13");
    expect(marks.get("2026-11-11")).toEqual({ mark: "moved", share: null, movedTo: "2026-11-12" });
  });
});
