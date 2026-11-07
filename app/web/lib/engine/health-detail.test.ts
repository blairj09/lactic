import { describe, expect, it } from "vitest";
import { againstNormal, dataStart, recoveryBands, rollingBest, seriesStats, windowDays } from "./health-detail";
import { vo2maxBands, vo2maxRating } from "./fitness-age";

describe("seriesStats", () => {
  it("summarises the days with values", () => {
    const s = seriesStats([null, 50, 40, null, 60, null]);
    expect(s).toEqual({ latest: 60, latestIndex: 4, mean: 50, min: 40, max: 60, count: 3, change: 10 });
  });
  it("is empty without values", () => {
    expect(seriesStats([null, null]).latest).toBeNull();
    expect(seriesStats([]).count).toBe(0);
  });
  it("has no change from one value", () => {
    expect(seriesStats([null, 5]).change).toBeNull();
  });
});

describe("windowDays", () => {
  it("ends today, oldest first", () => {
    expect(windowDays("2026-11-03", 3)).toEqual(["2026-11-01", "2026-11-02", "2026-11-03"]);
  });
});

describe("dataStart", () => {
  const empty = (n: number) => new Array<number | null>(n).fill(null);
  it("starts at the first value across series", () => {
    const a = empty(365);
    const b = empty(365);
    a[300] = 1;
    b[250] = 2;
    expect(dataStart([a, b])).toBe(250);
  });
  it("keeps at least the minimum days", () => {
    const a = empty(365);
    a[360] = 1;
    expect(dataStart([a], 30)).toBe(335);
  });
  it("shows the last minimum days when there is nothing", () => {
    expect(dataStart([empty(90)], 30)).toBe(60);
    expect(dataStart([empty(20)], 30)).toBe(0);
  });
});

describe("rollingBest", () => {
  it("carries the best value through the window", () => {
    const days = windowDays("2026-01-05", 5);
    const best = rollingBest([{ day: "2026-01-02", value: 50 }, { day: "2026-01-04", value: 45 }], days, 3);
    expect(best).toEqual([null, 50, 50, 50, 45]);
  });
});

describe("againstNormal", () => {
  it("gives percent or difference", () => {
    expect(againstNormal(55, 50, "percent")).toBe(10);
    expect(againstNormal(52, 50, "difference")).toBe(2);
    expect(againstNormal(null, 50, "percent")).toBeNull();
    expect(againstNormal(50, null, "difference")).toBeNull();
  });
});

describe("recoveryBands", () => {
  it("counts thirds", () => {
    expect(recoveryBands([80, 67, 50, 34, 33, null, 0])).toEqual({ recovered: 2, normal: 2, under: 2 });
  });
});

describe("vo2maxBands", () => {
  it("agrees with the rating", () => {
    const bands = vo2maxBands(40, "male");
    expect(bands.map((b) => b.label)).toEqual(["Below average", "Average", "Above average", "Excellent", "Elite"]);
    for (const b of bands.slice(1)) expect(vo2maxRating(b.from + 0.05, 40, "male")).toBe(`${b.label} for your age`);
  });
});
