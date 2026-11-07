import { describe, expect, it } from "vitest";
import { buildSession, STARTING_LEVELS } from "./library";
import { applyOverrides, dayOptions, editedSession, sameSession, workoutZone } from "./overrides";
import { ramp, steady } from "./workout";
import { buildPlan, type Availability } from "./plan";

const availability: Availability = [0, 60, 90, 60, 0, 180, 120];
const plan = buildPlan({ today: "2026-10-29", goals: [], availability, fitness: 55, fatigue: 60, levels: STARTING_LEVELS });
const day = (p: typeof plan, date: string) => p.weeks.flatMap((w) => w.days).find((d) => d.date === date)!;

describe("day options", () => {
  it("offers the check-in's versions of a planned session", () => {
    const ids = dayOptions(buildSession("threshold", 4, 3600), STARTING_LEVELS).map((o) => o.id);
    expect(ids).toEqual(expect.arrayContaining(["asPlanned", "harder", "easier", "endurance", "recovery", "rest"]));
  });

  it("offers a ride of the given length on a rest day", () => {
    const options = dayOptions(null, STARTING_LEVELS, 75);
    expect(options.map((o) => o.id)).toEqual(["addEndurance", "addRecovery", "rest"]);
    expect(options[0].session!.duration).toBe(75 * 60);
  });
});

describe("overrides", () => {
  it("replaces a day, recomputes the week's stress and the forecast", () => {
    const sat = day(plan, "2026-10-31");
    expect(sat.session).not.toBeNull();
    const changed = applyOverrides(plan, [{ date: "2026-10-31", session: null }], "2026-10-29", { fitness: 55, fatigue: 60 });
    expect(day(changed, "2026-10-31")).toMatchObject({ role: "rest", session: null, stress: 0 });
    expect(Math.abs(changed.weeks[0].stress - (plan.weeks[0].stress - sat.stress))).toBeLessThanOrEqual(1);
    expect(changed.forecast.at(-1)!.fitness).toBeLessThan(plan.forecast.at(-1)!.fitness);
    expect(day(plan, "2026-10-31").session).not.toBeNull();
  });

  it("ignores past days and leaves unchanged days alone", () => {
    const thu = day(plan, "2026-10-29");
    const changed = applyOverrides(
      plan,
      [
        { date: "2026-10-27", session: null },
        { date: "2026-10-29", session: thu.session },
      ],
      "2026-10-29",
      { fitness: 55, fatigue: 60 },
    );
    expect(day(changed, "2026-10-27")).toEqual(day(plan, "2026-10-27"));
    expect(day(changed, "2026-10-29")).toBe(thu);
  });

  it("an interval session on a rest day becomes a key day", () => {
    const changed = applyOverrides(plan, [{ date: "2026-10-30", session: buildSession("sweetSpot", 3, 3600) }], "2026-10-29", { fitness: 55, fatigue: 60 });
    expect(day(changed, "2026-10-30").role).toBe("key");
  });

  it("compares sessions by workout", () => {
    expect(sameSession(buildSession("tempo", 3, 3600), buildSession("tempo", 3, 3600))).toBe(true);
    expect(sameSession(buildSession("tempo", 3, 3600), buildSession("tempo", 3, 4500))).toBe(false);
    expect(sameSession(null, null)).toBe(true);
  });

  it("tells an edited workout from the one it came from", () => {
    const base = buildSession("threshold", 4, 3600);
    const segments = base.workout.segments.map((seg) => (seg.kind === "steady" && seg.target > 0.9 ? { ...seg, target: seg.target + 0.03 } : seg));
    expect(sameSession(base, { ...base, workout: { ...base.workout, segments } })).toBe(false);
  });

  it("keeps an edited workout over the plan, without the coach's reason", () => {
    const sat = day(plan, "2026-10-31");
    const workout = { name: "My threshold", segments: [ramp(600, 0.5, 0.75), steady(1200, 1), ramp(300, 0.65, 0.45)] };
    const session = editedSession(workout, sat.session, STARTING_LEVELS);
    expect(session).toMatchObject({ zone: "threshold", duration: 2100, edited: true });
    expect(session.stress).toBeGreaterThan(30);
    const withWhy = { ...plan, weeks: plan.weeks.map((w) => ({ ...w, days: w.days.map((d) => (d.date === sat.date ? { ...d, why: "Coach pick" } : d)) })) };
    const changed = applyOverrides(withWhy, [{ date: sat.date, session }], "2026-10-29", { fitness: 55, fatigue: 60 });
    expect(day(changed, sat.date)).toMatchObject({ role: "key", session, why: undefined });
  });
});

describe("workout zone", () => {
  it("reads the zone of the hardest effort of 30 seconds or more", () => {
    expect(workoutZone({ name: "e", segments: [ramp(600, 0.5, 0.75), steady(3600, 0.68), steady(10, 1.5)] })).toBe("endurance");
    expect(workoutZone({ name: "s", segments: [steady(600, 0.6), steady(1200, 0.9), steady(300, 0.5)] })).toBe("sweetSpot");
    expect(workoutZone({ name: "v", segments: [steady(180, 1.15), steady(180, 0.5)] })).toBe("vo2max");
    expect(workoutZone({ name: "a", segments: [steady(30, 1.5)] })).toBe("anaerobic");
  });
});
