import { describe, expect, it } from "vitest";
import { addPage, allFields, deletePage, follow, follows, movePage, pagesOf, renamePage, setSlot, setTemplate, splitOff, standardSets, swapSlots } from "./field-pages";

describe("ride field pages", () => {
  it("starts with one standard page that free ride and the overlay follow", () => {
    const r = standardSets();
    expect(r.workout.pages).toHaveLength(1);
    expect(follows(r, "free") && follows(r, "overlay")).toBe(true);
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
    expect(splitOff(standardSets(), "free").free).toEqual({ pages: standardSets().workout.pages });
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
    expect(allFields(standardSets())).toHaveLength(30);
  });
});
