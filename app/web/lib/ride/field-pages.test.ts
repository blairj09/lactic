import { describe, expect, it } from "vitest";
import { addPage, allFields, canWiden, deletePage, follow, follows, movePage, pagesOf, renamePage, setOption, setSlot, setTemplate, setWide, splitOff, standardSets, swapSlots } from "./field-pages";

describe("ride field pages", () => {
  it("starts with one standard page that the overlay follows, and free ride's own page", () => {
    const r = standardSets();
    expect(r.workout.pages).toHaveLength(1);
    expect(follows(r, "overlay")).toBe(true);
    expect(follows(r, "free")).toBe(false);
    expect(pagesOf(r, "overlay")).toBe(r.workout.pages);
  });

  it("sets, clears and swaps slots without holes, and leaves the input alone", () => {
    const r = setTemplate(standardSets(), "workout", 0, "four");
    expect(r.workout.pages[0].fields.map((f) => ("metric" in f ? f.metric : ""))).toEqual(["interval.left", "power", "power.target", "heart_rate"]);
    const cleared = setSlot(r, "workout", 0, 1, null);
    expect(cleared.workout.pages[0].fields).toHaveLength(3);
    expect(r.workout.pages[0].fields).toHaveLength(4);
    const filled = setSlot(cleared, "workout", 0, 3, { metric: "cadence" });
    expect(filled.workout.pages[0].fields[3]).toEqual({ metric: "cadence" });
    expect(setSlot(filled, "workout", 0, 3, { metric: "power.zone" }).workout.pages[0].fields[3]).toEqual({ metric: "power.zone" });
    const swapped = swapSlots(filled, "workout", 0, 0, 3);
    expect(swapped.workout.pages[0].fields[0]).toEqual({ metric: "cadence" });
  });

  it("splits a set off on its first change, and puts it back", () => {
    const r = setSlot(standardSets(), "overlay", 0, 0, { metric: "power.zone" });
    expect(follows(r, "overlay")).toBe(false);
    expect(r.workout.pages[0].fields[0]).toEqual({ metric: "interval.left" });
    expect(pagesOf(r, "overlay")[0].fields[0]).toEqual({ metric: "power.zone" });
    expect(follows(follow(r, "overlay"), "overlay")).toBe(true);
    const following = follow(standardSets(), "free");
    expect(splitOff(following, "free").free).toEqual({ pages: standardSets().workout.pages });
  });

  it("adds, renames, moves and deletes pages, keeping at least one", () => {
    let r = addPage(standardSets(), "workout");
    r = renamePage(r, "workout", 1, "Climbing");
    expect(r.workout.pages.map((p) => p.name)).toEqual(["Workout", "Climbing"]);
    r = movePage(r, "workout", 1, -1);
    expect(r.workout.pages.map((p) => p.name)).toEqual(["Climbing", "Workout"]);
    expect(movePage(r, "workout", 0, -1)).toBe(r);
    r = deletePage(r, "workout", 0);
    expect(r.workout.pages.map((p) => p.name)).toEqual(["Workout"]);
    expect(deletePage(r, "workout", 0)).toBe(r);
  });

  it("lists every field across the sets", () => {
    // Workout and overlay share the standard 10; free ride has its own 8.
    expect(allFields(standardSets())).toHaveLength(28);
  });

  it("makes a field wide only where there's a slot to spare, and keeps it wide when its field changes", () => {
    const four = setTemplate(standardSets(), "workout", 0, "four");
    expect(canWiden(four.workout.pages[0], 0)).toBe(false);
    expect(setWide(four, "workout", 0, 0, true)).toBe(four);
    const three = setSlot(four, "workout", 0, 3, null);
    const wide = setWide(three, "workout", 0, 1, true);
    expect(wide.workout.pages[0].fields[1]).toEqual({ metric: "power", wide: true });
    expect(setSlot(wide, "workout", 0, 3, { metric: "cadence" })).toEqual(wide);
    expect(setSlot(wide, "workout", 0, 1, { metric: "cadence" }).workout.pages[0].fields[1]).toEqual({ metric: "cadence", wide: true });
    expect(setWide(wide, "workout", 0, 1, false).workout.pages[0].fields[1]).toEqual({ metric: "power" });
    expect(setTemplate(wide, "workout", 0, "two").workout.pages[0].fields).toEqual([{ metric: "interval.left" }, { metric: "power" }]);
  });

  it("keeps a plugin field's option picks with the pages", () => {
    const r = setOption(standardSets(), "plugin_field.best-efforts.efforts", "durations", ["5 s", "1 min"]);
    expect(r.options).toEqual({ "plugin_field.best-efforts.efforts": { durations: ["5 s", "1 min"] } });
    expect(standardSets().options).toBeUndefined();
  });
});
