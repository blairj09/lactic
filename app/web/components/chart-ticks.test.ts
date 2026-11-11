import { describe, expect, it } from "vitest";
import { spaceTicks } from "./chart-ticks";

const weeks = ["Oct 5", "Oct 12", "Oct 19", "Oct 26", "Nov 2", "Nov 9", "Nov 16", "Nov 23"];

describe("spaceTicks", () => {
  it("keeps every tick when there is room", () => {
    expect(spaceTicks(weeks, (_) => weeks.indexOf(_) * 80, (t) => t)).toEqual(weeks);
  });

  it("thins weekly ticks evenly on a phone-width chart", () => {
    // About 30px between weeks, as on a 390px-wide phone.
    const kept = spaceTicks(weeks, (t) => weeks.indexOf(t) * 30, (t) => t);
    expect(kept).toEqual(["Oct 5", "Oct 19", "Nov 2", "Nov 16"]);
  });

  it("thins uneven ticks without labels touching", () => {
    const at: Record<string, number> = { "1s": 0, "5s": 30, "15s": 50, "30s": 62, "1m": 75, "5m": 105, "10m": 118, "20m": 130, "30m": 138, "1h": 150 };
    const kept = spaceTicks(Object.keys(at), (t) => at[t], (t) => t);
    for (let i = 1; i < kept.length; i++) expect(at[kept[i]] - at[kept[i - 1]]).toBeGreaterThanOrEqual(20);
    expect(kept[0]).toBe("1s");
  });
});
