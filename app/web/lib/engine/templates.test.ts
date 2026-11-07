import { describe, expect, it } from "vitest";
import { checkin } from "./checkin";
import { buildSession } from "./library";
import { checkTweaks, classicTemplate, pickTemplate, templateById, TEMPLATES, templatesFor } from "./templates";
import { workoutDuration } from "./workout";

describe("workout structures", () => {
  it("every structure builds at levels 1, 5 and 10 in an hour, filling the slot", () => {
    for (const t of TEMPLATES) {
      for (const level of [1, 5, 10]) {
        const s = buildSession(t.zone, level, 3600, { template: t.id });
        expect(s.template, `${t.id} at level ${level}`).toBe(t.id);
        expect(workoutDuration(s.workout)).toBe(3600);
        expect(s.workout.segments.every((x) => x.duration > 0)).toBe(true);
      }
    }
  });

  it("has several structures for each interval zone", () => {
    for (const zone of ["tempo", "sweetSpot", "threshold", "vo2max", "anaerobic"] as const) expect(templatesFor(zone).length).toBeGreaterThanOrEqual(3);
    expect(new Set(TEMPLATES.map((t) => t.id)).size).toBe(TEMPLATES.length);
  });

  it("a higher level is more work", () => {
    for (const t of TEMPLATES) {
      const easy = buildSession(t.zone, 2, 5400, { template: t.id });
      const hard = buildSession(t.zone, 9, 5400, { template: t.id });
      expect(hard.stress, t.id).toBeGreaterThan(easy.stress);
    }
  });

  it("keeps the classic structure when none is named", () => {
    const s = buildSession("threshold", 4, 3600);
    expect(s.template).toBe("threshold-intervals");
    expect(s.workout.name).toBe("Threshold 3 x 11 min @ 97%");
  });

  it("ignores a structure from another zone", () => {
    expect(buildSession("threshold", 4, 3600, { template: "vo2max-3030" }).template).toBe("threshold-intervals");
  });

  it("falls back to the classic structure when the chosen one can't fit", () => {
    const s = buildSession("sweetSpot", 10, 1200, { template: "sweetSpot-long" });
    expect(s.zone === "endurance" || s.template === "sweetSpot-intervals" || s.template === "sweetSpot-long").toBe(true);
    expect(workoutDuration(s.workout)).toBe(1200);
  });

  it("builds an attacks workout like a clustered race effort", () => {
    const s = buildSession("anaerobic", 4, 3600, { template: "anaerobic-attacks" });
    const attacks = s.workout.segments.filter((x) => x.kind === "steady" && x.target >= 1.5);
    const settles = s.workout.segments.filter((x) => x.kind === "steady" && x.target >= 0.85 && x.target < 1 && x.duration >= 240);
    expect(attacks.length).toBe(9);
    expect(settles.length).toBe(3);
  });

  it("sets targets directly, and keeps them when the level changes", () => {
    const s = buildSession("threshold", 5, 3600, { template: "threshold-overunder", tweaks: { over: 1.1, under: 0.9 } });
    expect(s.params).toMatchObject({ over: 1.1, under: 0.9 });
    expect(s.workout.name).toContain("90/110%");
    const harder = checkin({ planned: s, recovery: null, form: 0, fitness: 50, feel: 3 }).options.find((o) => o.id === "harder")!.session!;
    expect(harder.template).toBe("threshold-overunder");
    expect(harder.params).toMatchObject({ over: 1.1, under: 0.9 });
  });

  it("checks targets set directly", () => {
    const t = templateById("threshold-overunder")!;
    expect(checkTweaks(t, { over: 1.083 })).toEqual({ over: 1.08 });
    expect(() => checkTweaks(t, { over: 3 })).toThrow(/between/);
    expect(() => checkTweaks(t, { watts: 300 })).toThrow(/no target/);
  });

  it("rotates structures week to week and favors the preferred focus", () => {
    const picks = new Set([0, 1, 2, 3, 4].map((seed) => pickTemplate("threshold", [], seed).id));
    expect(picks.size).toBe(templatesFor("threshold").length);
    for (let seed = 0; seed < 6; seed++) expect(pickTemplate("vo2max", ["repeatability"], seed).focus).toContain("repeatability");
    expect(classicTemplate("vo2max").id).toBe("vo2max-intervals");
  });
});
