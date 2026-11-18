import { describe, expect, it } from "vitest";
import { WORKOUT_LIBRARY } from "@shared/engine/workout-library";
import { TRY_CATEGORIES, TRY_TAGS, TRY_WORKOUTS, catalogWorkouts, readFtp, tryTag, tryWorkouts } from "./workouts";

describe("try-a-ride workouts", () => {
  it("are all in the library and about half an hour", () => {
    const list = tryWorkouts();
    expect(list.map((w) => w.id)).toEqual([...TRY_WORKOUTS]);
    for (const w of list) {
      expect(w.duration).toBeLessThanOrEqual(31 * 60);
      expect(w.duration).toBeGreaterThanOrEqual(15 * 60);
      expect(TRY_TAGS[w.id as keyof typeof TRY_TAGS]).toBeTruthy();
    }
  });

  it("offers the whole library, by category and shortest first", () => {
    expect(catalogWorkouts()).toHaveLength(WORKOUT_LIBRARY.length);
    const total = TRY_CATEGORIES.reduce((n, c) => n + catalogWorkouts(c.value).length, 0);
    expect(total).toBe(WORKOUT_LIBRARY.length);
    const tempo = catalogWorkouts("tempo");
    expect(tempo.every((w) => w.category === "tempo")).toBe(true);
    expect(tempo.map((w) => w.duration)).toEqual([...tempo.map((w) => w.duration)].sort((a, b) => a - b));
    expect(tryTag(catalogWorkouts("tests").find((w) => w.id === "test-ramp")!)).toBe("Find your FTP");
    expect(tryTag(catalogWorkouts("tempo")[0])).toBe("Tempo");
  });

  it("reads a typed FTP", () => {
    expect(readFtp("245")).toBe(245);
    expect(readFtp(" 199.6 ")).toBe(200);
    expect(readFtp("")).toBeNull();
    expect(readFtp("20")).toBeNull();
    expect(readFtp("abc")).toBeNull();
  });
});
