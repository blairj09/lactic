import { describe, expect, it } from "vitest";
import { TRY_TAGS, TRY_WORKOUTS, readFtp, tryWorkouts } from "./workouts";

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

  it("reads a typed FTP", () => {
    expect(readFtp("245")).toBe(245);
    expect(readFtp(" 199.6 ")).toBe(200);
    expect(readFtp("")).toBeNull();
    expect(readFtp("20")).toBeNull();
    expect(readFtp("abc")).toBeNull();
  });
});
