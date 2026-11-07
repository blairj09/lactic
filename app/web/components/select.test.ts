import { describe, expect, it } from "vitest";
import { placement } from "./select";

const view = { width: 1000, height: 800 };
const rect = (top: number, left = 100, width = 200) => ({ top, bottom: top + 36, left, width });

describe("select menu placement", () => {
  it("opens below the trigger when it fits", () => {
    expect(placement(rect(100), 5, view)).toEqual({ left: 100, top: 140, width: 200, maxHeight: 170 });
  });

  it("opens above when there's more room there", () => {
    const p = placement(rect(700), 9, view);
    expect(p.bottom).toBe(104);
    expect(p.top).toBeUndefined();
    expect(p.maxHeight).toBe(298);
  });

  it("stays inside the window on the right", () => {
    expect(placement(rect(100, 900), 3, view).left).toBe(792);
  });

  it("caps the height and scrolls long lists", () => {
    expect(placement(rect(10), 40, view).maxHeight).toBe(320);
  });
});
