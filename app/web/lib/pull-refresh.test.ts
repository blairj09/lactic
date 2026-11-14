import { describe, expect, it } from "vitest";
import { barGrowth, PULL_MAX, PULL_THRESHOLD, pullArmed, pullDistance, runPullRefreshWork, setPullRefreshWork } from "./pull-refresh";

describe("pullDistance", () => {
  it("is zero for no pull or an upward swipe", () => {
    expect(pullDistance(0)).toBe(0);
    expect(pullDistance(-40)).toBe(0);
  });

  it("grows with the finger but never passes the max", () => {
    expect(pullDistance(40)).toBeGreaterThan(pullDistance(20));
    expect(pullDistance(2000)).toBeLessThanOrEqual(PULL_MAX);
  });

  it("arms after a deliberate pull, not a nudge", () => {
    expect(pullArmed(pullDistance(30))).toBe(false);
    expect(pullArmed(pullDistance(160))).toBe(true);
    expect(pullArmed(PULL_THRESHOLD)).toBe(true);
  });
});

describe("barGrowth", () => {
  it("grows the bars one after another, all full once armed", () => {
    expect([0, 1, 2, 3, 4].map((i) => barGrowth(0, i))).toEqual([0, 0, 0, 0, 0]);
    expect([0, 1, 2, 3, 4].map((i) => barGrowth(0.3, i))).toEqual([1, 0.5, 0, 0, 0]);
    expect([0, 1, 2, 3, 4].map((i) => barGrowth(1, i))).toEqual([1, 1, 1, 1, 1]);
  });
});

describe("runPullRefreshWork", () => {
  it("runs the work that was set, and nothing once it's taken off", async () => {
    let runs = 0;
    const off = setPullRefreshWork(async () => void runs++);
    await runPullRefreshWork();
    off();
    await runPullRefreshWork();
    expect(runs).toBe(1);
  });

  it("doesn't wait past its limit or throw when the work fails", async () => {
    const off = setPullRefreshWork(() => new Promise(() => {}));
    await runPullRefreshWork(10);
    off();
    const off2 = setPullRefreshWork(() => Promise.reject(new Error("no")));
    await expect(runPullRefreshWork()).resolves.toBeUndefined();
    off2();
  });
});
