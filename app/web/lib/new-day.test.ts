import { describe, expect, it, vi } from "vitest";
import { dayKey, holdNewDayRefresh, msUntilNextDay, newDayRefreshHeld, onNewDayHoldsReleased } from "./new-day";

describe("dayKey", () => {
  it("uses the local calendar day", () => {
    expect(dayKey(new Date(2026, 10, 4, 23, 59))).toBe("2026-11-04");
    expect(dayKey(new Date(2026, 10, 5, 0, 0))).toBe("2026-11-05");
  });
});

describe("msUntilNextDay", () => {
  it("lands just after midnight", () => {
    const now = new Date(2026, 10, 4, 23, 59, 0);
    expect(msUntilNextDay(now, 5_000)).toBe(65_000);
    expect(dayKey(new Date(now.getTime() + msUntilNextDay(now)))).toBe("2026-11-05");
  });
});

describe("holds", () => {
  it("counts holds and tells listeners when the last one is released", () => {
    const listener = vi.fn();
    const stop = onNewDayHoldsReleased(listener);
    const a = holdNewDayRefresh();
    const b = holdNewDayRefresh();
    expect(newDayRefreshHeld()).toBe(true);
    a();
    a();
    expect(newDayRefreshHeld()).toBe(true);
    expect(listener).not.toHaveBeenCalled();
    b();
    expect(newDayRefreshHeld()).toBe(false);
    expect(listener).toHaveBeenCalledTimes(1);
    stop();
  });
});
