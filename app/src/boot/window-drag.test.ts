import { describe, expect, it } from "vitest";
import { startsWindowDrag, type PressTarget } from "./window-drag";

// A press target that sits inside the given selectors.
const inside = (...matches: string[]): PressTarget => ({
  closest: (selector: string) => (selector.split(",").some((s) => matches.includes(s.trim())) ? {} : null),
});

describe("startsWindowDrag", () => {
  it("drags from empty space in the title bar", () => {
    expect(startsWindowDrag(inside(".lactic-drag"), 0)).toBe(true);
  });
  it("leaves links, buttons and fields alone", () => {
    expect(startsWindowDrag(inside(".lactic-drag", "a"), 0)).toBe(false);
    expect(startsWindowDrag(inside(".lactic-drag", "button"), 0)).toBe(false);
    expect(startsWindowDrag(inside(".lactic-drag", "input"), 0)).toBe(false);
    expect(startsWindowDrag(inside(".lactic-drag", '[role="dialog"]'), 0)).toBe(false);
  });
  it("only drags with the left button, inside a drag area", () => {
    expect(startsWindowDrag(inside(".lactic-drag"), 2)).toBe(false);
    expect(startsWindowDrag(inside(), 0)).toBe(false);
    expect(startsWindowDrag(null, 0)).toBe(false);
  });
});
