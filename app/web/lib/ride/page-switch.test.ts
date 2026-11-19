import { describe, expect, it } from "vitest";
import { pageKeyStep, stepsTo, swipeTracker, SWIPE_REST_MS } from "./page-switch";

const key = (k: string, more: Partial<Parameters<typeof pageKeyStep>[0]> = {}) => ({ key: k, metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, defaultPrevented: false, ...more });

describe("pageKeyStep", () => {
  it("turns arrows into steps", () => {
    expect(pageKeyStep(key("ArrowRight"))).toBe(1);
    expect(pageKeyStep(key("ArrowLeft"))).toBe(-1);
    expect(pageKeyStep(key("ArrowUp"))).toBeNull();
  });
  it("leaves shortcuts and handled keys alone", () => {
    expect(pageKeyStep(key("ArrowRight", { metaKey: true }))).toBeNull();
    expect(pageKeyStep(key("ArrowLeft", { shiftKey: true }))).toBeNull();
    expect(pageKeyStep(key("ArrowLeft", { defaultPrevented: true }))).toBeNull();
  });
});

describe("swipeTracker", () => {
  it("turns one page per swipe, ignoring its momentum", () => {
    const swipe = swipeTracker();
    let t = 0;
    const steps: (1 | -1 | null)[] = [];
    for (let i = 0; i < 30; i++) steps.push(swipe(15, 1, (t += 16)));
    expect(steps.filter((s) => s !== null)).toEqual([1]);
    // A fresh swipe the other way after a rest.
    t += SWIPE_REST_MS + 50;
    const back: (1 | -1 | null)[] = [];
    for (let i = 0; i < 10; i++) back.push(swipe(-20, 0, (t += 16)));
    expect(back.filter((s) => s !== null)).toEqual([-1]);
  });
  it("ignores up-and-down scrolling and small nudges", () => {
    const swipe = swipeTracker();
    let t = 0;
    for (let i = 0; i < 20; i++) expect(swipe(10, 40, (t += 16))).toBeNull();
    expect(swipe(20, 0, (t += 500))).toBeNull();
    expect(swipe(20, 0, (t += 500))).toBeNull();
  });
});

describe("stepsTo", () => {
  it("goes the short way round", () => {
    expect(stepsTo(0, 1, 2)).toEqual([1]);
    expect(stepsTo(1, 0, 2)).toEqual([1]);
    expect(stepsTo(0, 3, 4)).toEqual([-1]);
    expect(stepsTo(1, 1, 4)).toEqual([]);
    expect(stepsTo(0, 2, 5)).toEqual([1, 1]);
  });
});
