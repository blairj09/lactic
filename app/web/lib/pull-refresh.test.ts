import { describe, expect, it } from "vitest";
import { PULL_MAX, PULL_THRESHOLD, pullArmed, pullDistance } from "./pull-refresh";

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
