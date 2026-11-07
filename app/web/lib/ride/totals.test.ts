import { describe, expect, it } from "vitest";
import { rideTotals } from "./totals";

describe("ride totals", () => {
  it("is empty before the ride starts", () => {
    expect(rideTotals([], [], [], 250)).toEqual({ power: null, heartRate: null, cadence: null, tss: null });
  });

  it("averages power over every second, HR and cadence over the seconds with a reading", () => {
    const totals = rideTotals([200, 0, 100], [140, 0, 150], [90, 0, 80], 250);
    expect(totals.power).toBe(100);
    expect(totals.heartRate).toBe(145);
    expect(totals.cadence).toBe(85);
  });

  it("gives about 100 TSS for an hour at FTP", () => {
    const hour = Array(3600).fill(250);
    expect(rideTotals(hour, [], [], 250).tss).toBe(100);
  });
});
