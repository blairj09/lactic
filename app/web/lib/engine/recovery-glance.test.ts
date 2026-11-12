import { describe, expect, it } from "vitest";
import { exertionFromTrimp, type DayExertion } from "./exertion";
import { addDays } from "./pmc";
import type { RecoveryTrendDay } from "./recovery";
import { exertionToday, recoveryGlance, recoverySignals, trimpPerStress, usualRange } from "./recovery-glance";

const TODAY = "2026-11-10";

function trend(days: number, at: (i: number) => Partial<RecoveryTrendDay>): RecoveryTrendDay[] {
  return Array.from({ length: days }, (_, i) => ({
    day: addDays(TODAY, i - days + 1),
    score: 50,
    hrv: 60,
    restingHeartRate: 50,
    sleepHours: 8,
    wristTempDeltaC: 0,
    respiratoryRate: 14,
    ...at(i),
  }));
}

// Days alternate a little either side of the normal so there is a range.
const wobble = (i: number, mid: number, step: number) => mid + ((i % 5) - 2) * step;

describe("usualRange", () => {
  it("is the middle 80%", () => {
    const r = usualRange(Array.from({ length: 11 }, (_, i) => i * 10));
    expect(r).toEqual({ low: 10, high: 90 });
  });
  it("needs enough days", () => {
    expect(usualRange([1, 2, 3])).toBeNull();
  });
});

describe("recoveryGlance", () => {
  it("shows 14 nights and flags last night outside the range", () => {
    const rows = trend(45, (i) => ({ hrv: i === 44 ? 40 : wobble(i, 60, 2) }));
    const hrv = recoveryGlance({ today: TODAY, trend: rows, exertion: new Map() }).find((m) => m.key === "hrv")!;
    expect(hrv.nights).toHaveLength(14);
    expect(hrv.nights.at(-1)).toEqual({ day: TODAY, value: 40 });
    expect(hrv.range!.low).toBeGreaterThan(55);
    expect(hrv.outside).toBe("low");
  });

  it("ends exertion yesterday", () => {
    const exertion = new Map(Array.from({ length: 40 }, (_, i) => [addDays(TODAY, -i), 4] as const));
    const m = recoveryGlance({ today: TODAY, trend: [], exertion }).find((x) => x.key === "exertion")!;
    expect(m.nights.at(-1)!.day).toBe(addDays(TODAY, -1));
    expect(m.value).toBe(4);
  });

  it("has no range without history", () => {
    const m = recoveryGlance({ today: TODAY, trend: trend(5, () => ({})), exertion: new Map() });
    expect(m.every((x) => x.range === null && x.outside === null)).toBe(true);
  });
});

describe("recoverySignals", () => {
  it("needs HRV low three nights running, not one", () => {
    const one = recoveryGlance({ today: TODAY, trend: trend(45, (i) => ({ hrv: i === 44 ? 40 : wobble(i, 60, 2) })), exertion: new Map() });
    expect(recoverySignals(one, 0)).toEqual([]);
    const three = recoveryGlance({ today: TODAY, trend: trend(45, (i) => ({ hrv: i >= 42 ? 40 : wobble(i, 60, 2) })), exertion: new Map() });
    expect(recoverySignals(three, 0).map((s) => s.id)).toEqual(["hrvLow"]);
  });

  it("reads breathing up with a warm wrist as a possible illness", () => {
    const rows = trend(45, (i) => ({ respiratoryRate: i === 44 ? 17 : wobble(i, 14, 0.2), wristTempDeltaC: i === 44 ? 0.7 : 0 }));
    const signals = recoverySignals(recoveryGlance({ today: TODAY, trend: rows, exertion: new Map() }), 0);
    expect(signals).toEqual([expect.objectContaining({ id: "illness", strain: 2 })]);
  });

  it("counts resting heart rate up two nights", () => {
    const rows = trend(45, (i) => ({ restingHeartRate: i >= 43 ? 58 : wobble(i, 50, 1) }));
    expect(recoverySignals(recoveryGlance({ today: TODAY, trend: rows, exertion: new Map() }), 0).map((s) => s.id)).toEqual(["restingHrHigh"]);
  });

  it("counts sleep debt from 4 hours", () => {
    const m = recoveryGlance({ today: TODAY, trend: [], exertion: new Map() });
    expect(recoverySignals(m, 3.5)).toEqual([]);
    expect(recoverySignals(m, 4.5)).toEqual([{ id: "sleepDebt", strain: 1, reason: "Short on sleep this week" }]);
    // The reason gives tonight's aim, never the weekly total.
    expect(recoverySignals(m, 20.3, 9.5)[0].reason).toBe("Short on sleep this week: aim for 9h 30m tonight");
  });
});

describe("exertionToday", () => {
  const day = (trimp: number): DayExertion => ({
    day: TODAY,
    exertion: exertionFromTrimp(trimp),
    trimp,
    rideTrimp: 0,
    offBikeTrimp: trimp,
    bandMinutes: [0, 0, 0, 0],
    coveredMinutes: 300,
  });

  it("estimates where the planned ride lands the day", () => {
    const ratio = trimpPerStress([
      { rideTrimp: 100, stress: 50 },
      { rideTrimp: 120, stress: 60 },
      { rideTrimp: 160, stress: 80 },
    ]);
    expect(ratio).toBe(2);
    const t = exertionToday({ today: day(10), target: { low: 3.4, high: 4.4 }, plannedStress: 60, ratio });
    expect(t.soFar).toBe(exertionFromTrimp(10));
    expect(t.planned!.landsAt).toBe(exertionFromTrimp(130));
    expect(t.planned!.add).toBeCloseTo(exertionFromTrimp(130) - exertionFromTrimp(10), 5);
  });

  it("has no estimate without enough rides or a planned ride", () => {
    expect(trimpPerStress([{ rideTrimp: 100, stress: 50 }])).toBeNull();
    expect(exertionToday({ today: null, target: null, plannedStress: 60, ratio: null }).planned).toBeNull();
    expect(exertionToday({ today: null, target: null, plannedStress: null, ratio: 2 }).planned).toBeNull();
  });
});

describe("checkin with signals", async () => {
  const { checkin } = await import("./checkin");
  const { buildSession } = await import("./library");
  const planned = buildSession("threshold", 4, 3600);
  const base = { planned, recovery: 55, form: 0, fitness: 50, feel: 3 as const };

  it("eases off on signs of illness and says why", () => {
    const r = checkin({ ...base, signals: [{ strain: 2, reason: "Breathing rate and wrist temperature both up" }] });
    expect(r.recommended).toBe("easier");
    expect(r.reasons).toContain("Breathing rate and wrist temperature both up");
  });

  it("caps what the signs add together", () => {
    const many = Array.from({ length: 4 }, () => ({ strain: 2, reason: "x" }));
    expect(checkin({ ...base, signals: many }).strain).toBe(3);
  });
});
