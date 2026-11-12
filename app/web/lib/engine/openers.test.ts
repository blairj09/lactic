import { describe, expect, it } from "vitest";
import { buildSession } from "./library";
import { libraryWorkout } from "./workout-library";
import { keepWeek } from "./stability";
import { ramp, steady, warmupWithOpeners, withOpeners, WARMUP_SECONDS, type Segment } from "./workout";

const openers = (segments: Segment[]) => segments.filter((s) => s.kind === "steady" && s.opener);
const length = (segments: Segment[]) => segments.reduce((t, s) => t + s.duration, 0);

describe("warm-up openers", () => {
  it("builds each opener a little harder than the last, inside the same 10 minutes", () => {
    for (const style of ["hard", "steady"] as const) {
      const warm = warmupWithOpeners(style);
      expect(length(warm)).toBe(WARMUP_SECONDS);
      const targets = openers(warm).map((s) => (s.kind === "steady" ? s.target : 0));
      expect(targets).toHaveLength(3);
      expect(targets[0]).toBeLessThan(targets[1]);
      expect(targets[1]).toBeLessThan(targets[2]);
    }
    expect(openers(warmupWithOpeners("hard")).map((s) => s.duration)).toEqual([20, 20, 20]);
    expect(openers(warmupWithOpeners("steady")).map((s) => s.duration)).toEqual([30, 30, 30]);
  });

  it("goes into plan workouts above endurance, without changing their length", () => {
    for (const zone of ["tempo", "sweetSpot", "threshold", "vo2max", "anaerobic"] as const) {
      const session = buildSession(zone, 5, 3600);
      expect(openers(session.workout.segments)).toHaveLength(3);
      expect(session.duration).toBe(3600);
    }
    expect(openers(buildSession("endurance", 5, 3600).workout.segments)).toHaveLength(0);
    expect(openers(buildSession("recovery", 1, 2700).workout.segments)).toHaveLength(0);
  });

  it("goes into library workouts above endurance, but not tests or easy rides", () => {
    expect(openers(libraryWorkout("sweetspot-2x20")!.workout.segments)).toHaveLength(3);
    expect(openers(libraryWorkout("vo2-5x3")!.workout.segments)).toHaveLength(3);
    expect(openers(libraryWorkout("endurance-60")!.workout.segments)).toHaveLength(0);
    expect(openers(libraryWorkout("test-20min")!.workout.segments)).toHaveLength(0);
  });

  it("leaves workouts without the plain 10-minute ramp alone, and doesn't add openers twice", () => {
    const imported = [ramp(300, 0.4, 0.6), steady(600, 1)];
    expect(withOpeners(imported, "hard")).toBe(imported);
    const once = withOpeners([ramp(600, 0.45, 0.7), steady(600, 1)], "hard");
    expect(withOpeners(once, "hard")).toBe(once);
    expect(withOpeners(once, null)).toBe(once);
  });

  it("adds openers to the week already kept, with its stress", () => {
    const plain = { ...buildSession("threshold", 5, 3600) };
    const segments = [ramp(600, 0.45, 0.7), ...plain.workout.segments.slice(openers(plain.workout.segments).length * 2 + 1)];
    const old = { ...plain, workout: { ...plain.workout, segments } };
    const days = Array.from({ length: 7 }, (_, i) => ({ date: `2026-11-${String(9 + i).padStart(2, "0")}`, role: i === 3 ? "key" : "rest", session: i === 3 ? old : null, stress: i === 3 ? old.stress : 0 }));
    const plan = { weeks: [{ start: "2026-11-09", phase: "build", recoveryWeek: false, target: 300, stress: old.stress, days }], forecast: [] };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const kept = keepWeek(plan as any, { week: "2026-11-09", days } as any, "2026-11-09", { fitness: 40, fatigue: 40 });
    const day = kept.weeks[0].days[3];
    expect(openers(day.session!.workout.segments)).toHaveLength(3);
    expect(day.stress).toBeCloseTo(day.session!.stress, 5);
  });
});
