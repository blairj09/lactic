import { describe, expect, it } from "vitest";
import { buildSession } from "./library";
import { segmentRoles } from "./segment-roles";
import { ramp, steady, type Workout } from "./workout";

describe("segmentRoles", () => {
  it("names warm-up and cool-down on a steady ride", () => {
    const roles = segmentRoles(buildSession("endurance", 3, 3600).workout);
    expect(roles).toEqual(["Warm-up", "Endurance", "Cool-down"]);
  });

  it("numbers efforts of a classic N x M", () => {
    const w: Workout = { name: "t", segments: [ramp(600, 0.45, 0.7), steady(600, 1), steady(300, 0.5), steady(600, 1), steady(300, 0.5), steady(600, 1), steady(600, 0.6), ramp(300, 0.65, 0.4)] };
    expect(segmentRoles(w)).toEqual(["Warm-up", "Effort 1 of 3", "Recovery", "Effort 2 of 3", "Recovery", "Effort 3 of 3", "Endurance", "Cool-down"]);
  });

  it("splits 30/30s into sets", () => {
    const session = buildSession("vo2max", 5, 3600, { template: "vo2max-3030" });
    const roles = segmentRoles(session.workout);
    const count = session.params!.count;
    const sets = Number(/(\d+) sets/.exec(session.workout.name)![1]);
    expect(roles[0]).toBe("Warm-up");
    expect(roles[1]).toBe(`Effort 1 of ${count} · set 1 of ${sets}`);
    expect(roles).toContain(`Effort ${count} of ${count} · set ${sets} of ${sets}`);
    expect(roles).toContain("Rest between sets");
    expect(roles.at(-1)).toBe("Cool-down");
    expect(roles.filter((r) => r === "Rest between sets")).toHaveLength(sets - 1);
  });

  it("calls one long effort the main set, with its parts", () => {
    const w: Workout = { name: "ou", segments: [ramp(600, 0.45, 0.7), steady(120, 0.95), steady(60, 1.05), steady(120, 0.95), ramp(300, 0.65, 0.4)] };
    expect(segmentRoles(w)).toEqual(["Warm-up", "Main set · part 1 of 3", "Main set · part 2 of 3", "Main set · part 3 of 3", "Cool-down"]);
  });

  it("doesn't make sets of single efforts", () => {
    const w: Workout = { name: "t", segments: [steady(60, 1.2), steady(60, 0.5), steady(60, 1.2), steady(600, 0.5), steady(60, 1.2)] };
    expect(segmentRoles(w)).toEqual(["Effort 1 of 3", "Recovery", "Effort 2 of 3", "Recovery", "Effort 3 of 3"]);
  });
});
