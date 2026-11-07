import { describe, expect, it } from "vitest";
import { autoExportSamples, columnSamples, healthNights, parseHealthDate, sleepStage } from "./health-import";

const line = (start: string, end: string, value: string) => `2026-11-0${start}-05:00|2026-11-0${end}-05:00|${value}`;

// Night of Nov 1 → 2, Central time: 23:00 to 06:45.
const SLEEP = [
  line("1T22:40:00", "2T06:50:00", "In Bed"), // the phone's bedtime, ignored
  line("1T23:00:00", "1T23:10:00", "Awake"),
  line("1T23:10:00", "2T00:40:00", "Core"),
  line("2T00:40:00", "2T01:40:00", "Deep"),
  line("2T01:40:00", "2T02:00:00", "Awake"),
  line("2T02:00:00", "2T04:00:00", "Core"),
  line("2T04:00:00", "2T05:30:00", "REM"),
  line("2T05:30:00", "2T06:45:00", "Core"),
  // An afternoon nap on Nov 1, its own session.
  line("1T14:00:00", "1T14:40:00", "Asleep"),
].join("\n");

describe("health import", () => {
  it("parses ISO dates with their offset", () => {
    expect(parseHealthDate("2026-11-02T06:45:00-05:00")).toEqual({ unix: Date.UTC(2026, 10, 2, 11, 45) / 1000, offsetMinutes: -300 });
    expect(parseHealthDate("2026-11-02T06:45:00Z")?.offsetMinutes).toBe(0);
    expect(parseHealthDate("2026-11-02 06:45:00 +0100")?.offsetMinutes).toBe(60);
    expect(parseHealthDate("Nov 2, 2026 at 6:45 AM")).toBeNull();
  });

  it("reads sleep stage wording", () => {
    expect(sleepStage("Asleep (Core)")).toBe("core");
    expect(sleepStage("REM")).toBe("rem");
    expect(sleepStage("In Bed")).toBe("inBed");
    expect(sleepStage("Asleep")).toBe("asleep");
    expect(sleepStage("Awake")).toBe("awake");
  });

  it("builds a night with stages, overnight HRV and the day's resting HR", () => {
    const nights = healthNights({
      sleep: SLEEP,
      hrv: ["2026-11-02T01:00:00-05:00|40 ms", "2026-11-02T05:00:00-05:00|50", "2026-11-01T15:00:00-05:00|90"].join("\n"),
      restingHr: ["2026-11-01T00:00:00-05:00|2026-11-01T23:59:00-05:00|52", "2026-11-02T00:00:00-05:00|2026-11-02T06:50:00-05:00|49"].join("\n"),
    });
    const night = nights.find((n) => n.day === "2026-11-02")!;
    expect(night.asleepHours).toBe(7.25);
    expect(night.deepHours).toBe(1);
    expect(night.remHours).toBe(1.5);
    expect(night.coreHours).toBe(4.75);
    expect(night.awakeHours).toBe(0.5);
    expect(night.hrv).toBe(45);
    expect(night.restingHr).toBe(49);
    expect(night.start).toBe(Date.UTC(2026, 10, 2, 4, 10) / 1000);
    expect(night.end).toBe(Date.UTC(2026, 10, 2, 11, 45) / 1000);
    // The nap makes Nov 1's row; it keeps Nov 1's resting HR.
    expect(nights.find((n) => n.day === "2026-11-01")).toMatchObject({ asleepHours: 0.67, restingHr: 52, hrv: 90, deepHours: null });
  });

  it("keeps the night's timeline, joining neighbours in the same stage", () => {
    const night = healthNights({ sleep: SLEEP }).find((n) => n.day === "2026-11-02")!;
    const t = (h: number, m: number) => Date.UTC(2026, 10, 2, h, m) / 1000;
    expect(night.segments[0]).toEqual({ start: t(4, 0), end: t(4, 10), stage: "awake" });
    expect(night.segments.map((g) => g.stage)).toEqual(["awake", "core", "deep", "awake", "core", "rem", "core"]);
    expect(night.segments.at(-1)!.end).toBe(t(11, 45));
    const doubled = healthNights({ sleep: [SLEEP, line("2T02:00:00", "2T03:00:00", "Core")].join("\n") }).find((n) => n.day === "2026-11-02")!;
    expect(doubled.segments).toHaveLength(7);
  });

  it("averages breathing over the night and picks the night's wrist temperature", () => {
    const night = healthNights({
      sleep: SLEEP,
      respiratoryRate: ["2026-11-02T01:00:00-05:00|14", "2026-11-02T04:00:00-05:00|15", "2026-11-02T15:00:00-05:00|22"].join("\n"),
      wristTemp: ["2026-11-01T23:00:00-05:00|2026-11-02T06:45:00-05:00|96.8", "2026-10-31T23:00:00-05:00|2026-11-01T06:45:00-05:00|35.1"].join("\n"),
    }).find((n) => n.day === "2026-11-02")!;
    expect(night.respiratoryRate).toBe(14.5);
    expect(night.wristTempC).toBe(36);
  });

  it("counts overlapping sources once", () => {
    const both = [SLEEP, line("1T23:10:00", "2T06:45:00", "Asleep")].join("\n");
    expect(healthNights({ sleep: both }).find((n) => n.day === "2026-11-02")!.asleepHours).toBe(7.25);
  });

  it("keeps a resting HR on a date with no night", () => {
    expect(healthNights({ restingHr: "2026-10-20T00:00:00-05:00|50" })).toEqual([
      expect.objectContaining({ day: "2026-10-20", restingHr: 50, asleepHours: null }),
    ]);
  });

  it("skips lines it can't read", () => {
    expect(healthNights({ sleep: "garbage\n|\nNov 2|Nov 3|Core", hrv: 42 })).toEqual([]);
  });
});

describe("Health Auto Export", () => {
  it("reads unsummarized sleep, HRV and resting HR", () => {
    const body = {
      data: {
        metrics: [
          {
            name: "sleep_analysis",
            units: "hr",
            data: [
              { startDate: "2026-11-01 23:00:00 -0600", endDate: "2026-11-02 03:00:00 -0600", qty: 4, value: "Core", source: "Apple Watch" },
              { startDate: "2026-11-02 03:00:00 -0600", endDate: "2026-11-02 04:00:00 -0600", qty: 1, value: "Deep", source: "Apple Watch" },
              { startDate: "2026-11-02 04:00:00 -0600", endDate: "2026-11-02 06:00:00 -0600", qty: 2, value: "REM", source: "Apple Watch" },
            ],
          },
          { name: "heart_rate_variability", units: "ms", data: [{ date: "2026-11-02 02:00:00 -0600", qty: 48 }] },
          { name: "resting_heart_rate", units: "count/min", data: [{ date: "2026-11-02 00:00:00 -0600", qty: 50 }] },
        ],
      },
    };
    const nights = healthNights(autoExportSamples(body)!);
    expect(nights).toEqual([expect.objectContaining({ day: "2026-11-02", asleepHours: 7, deepHours: 1, remHours: 2, coreHours: 4, hrv: 48, restingHr: 50 })]);
  });

  it("reads a summarized night", () => {
    const body = {
      data: {
        metrics: [
          {
            name: "sleep_analysis",
            data: [{ date: "2026-11-02 00:00:00 -0600", totalSleep: 7, core: 4, deep: 1, rem: 2, awake: 0.5, asleep: 0, sleepStart: "2026-11-01 23:00:00 -0600", sleepEnd: "2026-11-02 06:30:00 -0600" }],
          },
        ],
      },
    };
    const [night] = healthNights(autoExportSamples(body)!);
    expect(night).toMatchObject({ day: "2026-11-02", asleepHours: 7, deepHours: 1, remHours: 2, coreHours: 4, awakeHours: 0.5 });
  });

  it("ignores other bodies", () => {
    expect(autoExportSamples({ sleep: "x" })).toBeNull();
  });
});

describe("column samples", () => {
  it("pairs side-by-side lists back into samples", () => {
    const body = {
      sleepStart: "2026-11-01T23:00:00-06:00\n2026-11-02T03:00:00-06:00\n2026-11-02T04:00:00-06:00",
      sleepEnd: "2026-11-02T03:00:00-06:00\n2026-11-02T04:00:00-06:00\n2026-11-02T06:00:00-06:00",
      sleepValue: "Core\nDeep\nREM",
      hrvDate: "2026-11-02T02:00:00-06:00\n2026-11-02T05:00:00-06:00",
      hrvValue: "40\n50",
      restingHrDate: "2026-11-02T00:00:00-06:00",
      restingHrValue: "51",
    };
    const nights = healthNights(columnSamples(body)!);
    expect(nights).toEqual([expect.objectContaining({ day: "2026-11-02", asleepHours: 7, deepHours: 1, remHours: 2, coreHours: 4, hrv: 45, restingHr: 51 })]);
  });

  it("pairs breathing and wrist temperature lists", () => {
    const samples = columnSamples({
      respRateDate: "2026-11-02T02:00:00-06:00\n2026-11-02T03:00:00-06:00",
      respRateValue: "14\n16",
      wristTempStart: "2026-11-01T23:00:00-06:00",
      wristTempEnd: "2026-11-02T06:00:00-06:00",
      wristTempValue: "35.9",
    })!;
    expect(samples.respiratoryRate).toEqual(["2026-11-02T02:00:00-06:00|14", "2026-11-02T03:00:00-06:00|16"]);
    expect(samples.wristTemp).toEqual(["2026-11-01T23:00:00-06:00|2026-11-02T06:00:00-06:00|35.9"]);
  });

  it("refuses lists that don't line up", () => {
    expect(() => columnSamples({ sleepStart: "a\nb", sleepEnd: "a", sleepValue: "Core" })).toThrow();
  });

  it("ignores bodies without the lists", () => {
    expect(columnSamples({ sleep: "x" })).toBeNull();
  });
});
