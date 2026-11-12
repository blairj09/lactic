import { describe, expect, it } from "vitest";
import { twentyMinuteTestFtp } from "./ftp";
import { isRampTest, STARTING_LEVELS } from "./library";
import { buildPlan, type Availability, type Goal } from "./plan";
import { ramp, steady, workoutDuration, type Workout } from "./workout";
import {
  customLibraryWorkout,
  favoriteLibraryIds,
  favoriteWorkouts,
  keyOf,
  workoutByKey,
  zoneFor,
  isTwentyMinuteTest,
  LIBRARY_CATEGORIES,
  libraryFits,
  librarySession,
  libraryWorkout,
  levelFor,
  WORKOUT_LIBRARY,
} from "./workout-library";

describe("starter workout library", () => {
  it("has unique ids and names", () => {
    expect(new Set(WORKOUT_LIBRARY.map((w) => w.id)).size).toBe(WORKOUT_LIBRARY.length);
    expect(new Set(WORKOUT_LIBRARY.map((w) => w.workout.name)).size).toBe(WORKOUT_LIBRARY.length);
  });

  it("covers every type, with several workouts in each training zone", () => {
    for (const category of LIBRARY_CATEGORIES) {
      const count = WORKOUT_LIBRARY.filter((w) => w.category === category).length;
      expect(count, category).toBeGreaterThanOrEqual(category === "tests" || category === "recovery" ? 2 : 4);
    }
  });

  it("every workout is whole: positive segments, a length in 5 minutes, a level from 1 to 10 and some stress", () => {
    for (const w of WORKOUT_LIBRARY) {
      expect(w.workout.segments.length, w.id).toBeGreaterThan(2);
      expect(w.workout.segments.every((s) => s.duration > 0), w.id).toBe(true);
      expect(w.duration, w.id).toBe(workoutDuration(w.workout));
      if (w.id !== "test-ramp") expect(w.duration % 300, w.id).toBe(0);
      expect(w.level, w.id).toBeGreaterThanOrEqual(1);
      expect(w.level, w.id).toBeLessThanOrEqual(10);
      expect(w.stress, w.id).toBeGreaterThan(10);
    }
  });

  it("levels follow time in zone", () => {
    expect(libraryWorkout("sweetspot-3x10")!.level).toBeLessThan(libraryWorkout("sweetspot-2x20")!.level);
    expect(libraryWorkout("sweetspot-2x20")!.level).toBeLessThan(libraryWorkout("sweetspot-2x30")!.level);
    expect(libraryWorkout("threshold-3x8")!.level).toBeLessThan(libraryWorkout("threshold-2x20")!.level);
    expect(levelFor("endurance", libraryWorkout("endurance-60")!.workout)).toBeNull();
  });

  it("is a session the plan and levels understand", () => {
    const s = librarySession(libraryWorkout("threshold-2x20")!);
    expect(s).toMatchObject({ zone: "threshold", library: "threshold-2x20" });
    expect(s.stress).toBeGreaterThan(60);
    expect(libraryWorkout("sprints-8x15s")!.zone).toBe("anaerobic");
  });

  it("keeps the ramp test the engine sets FTP from, and adds a 20-minute test", () => {
    expect(isRampTest(libraryWorkout("test-ramp")!.workout)).toBe(true);
    const twenty = libraryWorkout("test-20min")!;
    expect(isTwentyMinuteTest(twenty.workout)).toBe(true);
    const effort = twenty.workout.segments.find((s) => s.kind === "steady" && s.duration === 1200);
    expect(effort).toMatchObject({ allOut: true });
  });

  it("sets FTP to 95% of a 20-minute test's best 20 minutes", () => {
    const watts = [...Array(600).fill(150), ...Array(1200).fill(300), ...Array(300).fill(120)];
    expect(twentyMinuteTestFtp(watts)).toEqual({ watts: 285, best: 300 });
    expect(twentyMinuteTestFtp(Array(900).fill(300))).toBeNull();
  });

  it("finds workouts that fit a slot: same zone, not longer, at most 15 minutes shorter, within a level", () => {
    const fits = libraryFits("sweetSpot", 4, 3600);
    expect(fits.map((w) => w.id)).toContain("sweetspot-2x20");
    for (const w of fits) {
      expect(w.zone).toBe("sweetSpot");
      expect(w.duration).toBeLessThanOrEqual(3600);
      expect(w.duration).toBeGreaterThanOrEqual(2700);
      expect(Math.abs(w.level - 4)).toBeLessThanOrEqual(1);
    }
    expect(libraryFits("threshold", 1, 3600, ["test-20min"])).toEqual([]);
  });

  it("reads favorite keys, skipping My workouts and unknown ids", () => {
    expect(favoriteLibraryIds(["library:tempo-45", "custom:00000000-0000-4000-8000-000000000001", "library:gone"])).toEqual(["tempo-45"]);
  });
});

describe("plan with favorites", () => {
  const availability: Availability = [0, 60, 60, 60, 0, 180, 120];
  const race: Goal = { id: "a", name: "Spring classic", date: "2027-03-20", priority: "A", kind: "roadRace" };
  const plan = (favorites?: string[]) =>
    buildPlan({ today: "2026-10-29", goals: [race], availability, fitness: 55, fatigue: 60, levels: STARTING_LEVELS, favorites });
  const keys = (p: ReturnType<typeof plan>) => p.weeks.flatMap((w) => w.days).filter((d) => d.role === "key" && d.session);

  it("leaves the plan as it was without favorites", () => {
    expect(keys(plan()).every((d) => !d.session!.library)).toBe(true);
    expect(JSON.stringify(plan([]))).toBe(JSON.stringify(plan()));
  });

  it("uses a favorite on key days it fits, and the engine's structures elsewhere", () => {
    const without = keys(plan());
    // Every favorite that fits one of the plan's own key days.
    const favorites = WORKOUT_LIBRARY.filter((w) => without.some((d) => libraryFits(d.session!.zone, d.session!.level, 3600).includes(w))).map((w) => w.id);
    expect(favorites.length).toBeGreaterThan(0);
    const days = keys(plan(favorites));
    const used = days.filter((d) => d.session!.library);
    expect(used.length).toBeGreaterThan(0);
    for (const d of used) expect(favorites).toContain(d.session!.library);
    expect(days.some((d) => !d.session!.library)).toBe(true);
  });
});

const minutes = (m: number, target: number) => steady(m * 60, target);
const mine = (name: string, segments: Workout["segments"]): Workout => ({ name, segments });

describe("My workouts as the plan sees them", () => {
  it("reads most starter workouts' zones back from their intervals", () => {
    const read = WORKOUT_LIBRARY.filter((w) => w.category !== "tests" && zoneFor(w.workout) === w.zone);
    expect(read.length).toBeGreaterThanOrEqual(WORKOUT_LIBRARY.length - 8);
  });

  it("works out zone and level: threshold blocks, sweet spot with surges, 30/30s, steady endurance, easy spins", () => {
    const warm = ramp(600, 0.45, 0.7);
    const cool = ramp(300, 0.65, 0.4);
    const threshold = customLibraryWorkout("a", mine("My 2x20", [warm, minutes(20, 1), minutes(5, 0.5), minutes(20, 1), cool]))!;
    expect(threshold).toMatchObject({ id: "a", custom: true, zone: "threshold" });
    expect(threshold.level).toBe(levelFor("threshold", threshold.workout));
    const surges = mine("Surgy", [warm, ...Array.from({ length: 10 }, () => [steady(105, 0.89), steady(15, 1.3)]).flat(), cool]);
    expect(zoneFor(surges)).toBe("sweetSpot");
    const thirties = mine("30/30", [warm, ...Array.from({ length: 12 }, () => [steady(30, 1.2), steady(30, 0.5)]).flat(), cool]);
    expect(zoneFor(thirties)).toBe("vo2max");
    const endurance = customLibraryWorkout("b", mine("Long one", [warm, minutes(105, 0.66), cool]))!;
    expect(endurance.zone).toBe("endurance");
    expect(endurance.level).toBeGreaterThanOrEqual(5);
    expect(zoneFor(mine("Spin", [minutes(30, 0.5)]))).toBe("recovery");
    expect(customLibraryWorkout("c", mine("Free", [{ kind: "freeRide", duration: 3600 }]))).toBeNull();
  });

  it("resolves favorite keys to workouts, starter and mine, and skips ones that are gone", () => {
    const customs = [{ id: "c1", workout: mine("My 2x20", [minutes(10, 0.6), minutes(20, 1), minutes(5, 0.5), minutes(20, 1), minutes(5, 0.5)]) }];
    const out = favoriteWorkouts(["custom:c1", "library:tempo-45", "custom:gone", "library:gone"], customs);
    expect(out.map(keyOf)).toEqual(["custom:c1", "library:tempo-45"]);
    expect(librarySession(out[0])).toMatchObject({ custom: "c1", zone: "threshold" });
    expect(librarySession(out[0]).library).toBeUndefined();
    expect(workoutByKey("tempo-45", customs)).toBeNull();
  });
});

describe("plan with favorites of my own", () => {
  const availability: Availability = [0, 60, 60, 60, 0, 180, 120];
  const race: Goal = { id: "a", name: "Spring classic", date: "2027-03-20", priority: "A", kind: "roadRace" };
  const build = (favorites?: Parameters<typeof buildPlan>[0]["favorites"]) =>
    buildPlan({ today: "2026-10-29", goals: [race], availability, fitness: 55, fatigue: 60, levels: STARTING_LEVELS, favorites });

  it("uses a favorited workout of mine on a key day it fits", () => {
    const keys = build().weeks.flatMap((w) => w.days).filter((d) => d.role === "key" && d.session);
    // Copies of the starter workouts that fit the plan's key days, saved as mine.
    const copies = WORKOUT_LIBRARY.filter((w) => keys.some((d) => libraryFits(d.session!.zone, d.session!.level, 3600).includes(w)))
      .flatMap((w) => customLibraryWorkout(`mine-${w.id}`, { ...w.workout, name: `My ${w.workout.name}` }) ?? []);
    expect(copies.length).toBeGreaterThan(0);
    const used = build(copies).weeks.flatMap((w) => w.days).filter((d) => d.session?.custom);
    expect(used.length).toBeGreaterThan(0);
    for (const d of used) expect(d.session!.library).toBeUndefined();
  });
});
