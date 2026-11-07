import { describe, expect, it } from "vitest";
import type { Goal } from "./plan";
import { clockAt, mealLabel, raceDay, relativeLabel } from "./raceday";

const cx: Goal = { id: "g", name: "UTCX Art Dye", date: "2026-10-30", priority: "B", kind: "cyclocross" };
const fondo: Goal = { id: "f", name: "Fondo", date: "2026-11-08", priority: "A", kind: "granFondo", minutes: 300, intensity: "hard" };

describe("race day", () => {
  it("gives a short, hard race a full warm-up with watts from FTP", () => {
    const day = raceDay(cx, 250, 75);
    expect(day.warmupMinutes).toBe(22);
    expect(day.warmup[1].watts).toEqual([245, 265]);
    expect(day.carbsPerHour).toBeNull();
    expect(day.timeline.map((m) => m.offset)).toEqual([-180, -90, -60, -32, -10, 0, 50]);
    expect(day.timeline[0].detail).toMatch(/^About 150 g/);
    expect(day.timeline[1].label).toMatch(/pre-ride/);
    expect(day.timeline[4].detail).toMatch(/gel/);
  });

  it("fuels long hard days during the race and skips watts without an FTP", () => {
    const day = raceDay(fondo, null, null);
    expect(day.carbsPerHour).toBe(90);
    expect(day.warmup.every((s) => s.watts === null)).toBe(true);
    expect(day.timeline.find((m) => m.label === "Fuel while racing")?.detail).toMatch(/90 g .* 30 g every 20/);
    expect(day.timeline.at(-1)?.offset).toBe(300);
  });

  it("names the meal three hours out by when it falls", () => {
    expect(mealLabel("09:00")).toBe("Breakfast");
    expect(mealLabel("14:30")).toBe("Lunch");
    expect(mealLabel("17:00")).toBe("Pre-race meal");
    expect(mealLabel(null)).toBe("Pre-race meal");
    expect(raceDay({ ...cx, startTime: "17:00" }, 250, 75).timeline[0].label).toBe("Pre-race meal");
  });

  it("formats times around the start", () => {
    expect(clockAt("10:45", -180)).toBe("7:45");
    expect(clockAt("0:30", -60)).toBe("23:30");
    expect(relativeLabel(-90)).toBe("1 h 30 min before");
    expect(relativeLabel(-180)).toBe("3 h before");
    expect(relativeLabel(50)).toBe("50 min in");
  });
});
