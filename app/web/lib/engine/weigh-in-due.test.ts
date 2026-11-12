import { describe, expect, it } from "vitest";
import { weighInDue } from "./weigh-in-due";

const tz = "America/Denver";
const at = (iso: string) => new Date(iso);
// 2026-11-11 is a Wednesday; its week starts Monday 2026-11-09.
const today = "2026-11-11";

describe("weighInDue", () => {
  it("is due with no weigh-in yet and no ride this week", () => {
    expect(weighInDue({ today, timeZone: tz, weighIns: [], rides: [at("2026-11-07T15:00:00Z")] })).toEqual({ due: true, daysSince: null });
  });

  it("is due when the last weigh-in is a week old", () => {
    expect(weighInDue({ today, timeZone: tz, weighIns: [at("2026-11-04T14:00:00Z")], rides: [] })).toEqual({ due: true, daysSince: 7 });
  });

  it("isn't due after a weigh-in in the last week, from any source", () => {
    expect(weighInDue({ today, timeZone: tz, weighIns: [at("2026-11-01T14:00:00Z"), at("2026-11-05T14:00:00Z")], rides: [] })).toEqual({ due: false });
  });

  it("isn't due once this week's first ride is in", () => {
    expect(weighInDue({ today, timeZone: tz, weighIns: [], rides: [at("2026-11-09T23:00:00Z")] })).toEqual({ due: false });
  });

  it("counts a Sunday-night ride as last week, in the rider's time zone", () => {
    // 2026-11-09T05:00Z is Sunday 22:00 in Denver.
    expect(weighInDue({ today, timeZone: tz, weighIns: [], rides: [at("2026-11-09T05:00:00Z")] }).due).toBe(true);
  });
});
