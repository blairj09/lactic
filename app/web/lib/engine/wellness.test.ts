import { describe, expect, it } from "vitest";
import { mergeWellness, wellnessDays, type RecoveryRow } from "./wellness";

describe("wellnessDays", () => {
  it("reads a Garmin-style record", () => {
    const [d] = wellnessDays([{ id: "2026-11-06", restingHR: 46, hrv: 71, sleepSecs: 27000, respiration: 14.2, weight: 72.4 }]);
    expect(d).toEqual({ day: "2026-11-06", hrvMs: 71, hrvKind: "rmssd", restingHr: 46, sleepHours: 7.5, respiratoryRate: 14.2, weightKg: 72.4, bodyFatPct: null });
  });

  it("uses SDNN when only that is there, drops empty and junk records, sorts by day", () => {
    const days = wellnessDays([
      { id: "2026-11-05", hrvSDNN: 52 },
      { id: "2026-11-04" },
      { id: "nope", restingHR: 50 },
      { id: "2026-11-03", sleepSecs: 0, restingHR: 400 },
      { id: "2026-11-02", restingHR: 48 },
    ]);
    expect(days.map((d) => d.day)).toEqual(["2026-11-02", "2026-11-05"]);
    expect(days[1]).toMatchObject({ hrvMs: 52, hrvKind: "sdnn" });
  });
});

describe("mergeWellness", () => {
  const w = wellnessDays([{ id: "2026-11-06", restingHR: 46, hrv: 71, sleepSecs: 27000 }])[0];

  it("writes a new day as intervals.icu's", () => {
    expect(mergeWellness(undefined, w)).toEqual({ day: "2026-11-06", hrv_ms: 71, hrv_kind: "rmssd", resting_hr: 46, sleep_hours: 7.5, respiratory_rate: null, source: "intervals" });
  });

  it("only fills gaps on a day Apple Health owns", () => {
    const apple: RecoveryRow = { day: "2026-11-06", hrv_ms: 50, hrv_kind: "sdnn", resting_hr: null, sleep_hours: 6.8, respiratory_rate: 16, source: "shortcut" };
    expect(mergeWellness(apple, w)).toEqual({ ...apple, resting_hr: 46 });
  });

  it("returns null when nothing changes", () => {
    const row = mergeWellness(undefined, w)!;
    expect(mergeWellness(row, w)).toBeNull();
  });

  it("updates its own day with newer numbers", () => {
    const row = mergeWellness(undefined, w)!;
    const later = wellnessDays([{ id: "2026-11-06", restingHR: 44, hrv: 71, sleepSecs: 27000 }])[0];
    expect(mergeWellness(row, later)?.resting_hr).toBe(44);
  });
});
