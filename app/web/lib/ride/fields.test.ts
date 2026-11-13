import { describe, expect, it } from "vitest";
import { defaultLayout, parseField } from "../sdk/layout";
import { MetricRegistry } from "../sdk/metrics";
import { customLabel, fieldKey, fieldNeeds, showField, showFields, unavailableReason, type FieldInputs } from "./fields";

const metrics = new MetricRegistry();

/** 20 seconds: 10 at 200 W in interval 0, then 10 at 300 W in interval 1. */
function ride(extra: Partial<FieldInputs> = {}): FieldInputs {
  const power = [...Array(10).fill(200), ...Array(10).fill(300)];
  return {
    streams: { power, heartRate: [...Array(10).fill(0), ...Array(10).fill(150)], cadence: [...Array(10).fill(90), ...Array(10).fill(0)], interval: [...Array(10).fill(0), ...Array(10).fill(1)] },
    ftp: 250,
    weightKg: 75,
    thresholdHr: 170,
    power: 310,
    heartRate: 152,
    cadence: 88,
    interval: 1,
    toGo: 600,
    elapsed: 20,
    ...extra,
  };
}

const custom = (c: Record<string, unknown>) => parseField({ custom: { label: "x", window: 0, agg: "avg", ...c } })!;

describe("ride fields", () => {
  it("shows live readings and the ride so far", () => {
    expect(showField({ metric: "power" }, ride(), metrics)).toEqual({ label: "Power", value: "310", unit: "W" });
    expect(showField({ metric: "so_far.power" }, ride(), metrics).value).toBe("250");
    // Heart rate leaves out seconds with no reading; cadence leaves out coasting.
    expect(showField({ metric: "so_far.heart_rate" }, ride(), metrics).value).toBe("150");
    expect(showField({ metric: "so_far.cadence" }, ride(), metrics).value).toBe("90");
    expect(showField({ metric: "workout.to_go" }, ride(), metrics)).toEqual({ label: "To go", value: "10:00", unit: "" });
    expect(showField({ metric: "workout.to_go" }, ride({ toGo: null }), metrics)).toEqual({ label: "Ride time", value: "0:20", unit: "" });
    expect(showField({ metric: "so_far.kj" }, ride(), metrics).value).toBe("5");
  });

  it("works out zones, % of FTP and W/kg from the last 3 seconds", () => {
    expect(showField({ metric: "power.pct_ftp" }, ride(), metrics).value).toBe("120");
    expect(showField({ metric: "power.wkg" }, ride(), metrics)).toMatchObject({ value: "4.0", unit: "W/kg" });
    expect(showField({ metric: "power.zone" }, ride(), metrics).value).toBe("Z6"); // 120% of FTP is the start of zone 6
    expect(showField({ metric: "heart_rate.zone" }, ride(), metrics).value).toBe("Z3");
    expect(showField({ metric: "power.wkg" }, ride({ weightKg: null }), metrics)).toMatchObject({ value: null, reason: "Add your weight in Settings" });
  });

  it("averages this interval, the last one, a rolling window and the whole ride", () => {
    expect(showField(custom({ metric: "power", agg: "lap-avg" }), ride(), metrics).value).toBe("300");
    expect(showField(custom({ metric: "power", agg: "last-lap-avg" }), ride(), metrics).value).toBe("200");
    expect(showField(custom({ metric: "power", window: 15 }), ride(), metrics).value).toBe("267");
    expect(showField(custom({ metric: "power", agg: "ride-avg" }), ride(), metrics).value).toBe("250");
    expect(showField(custom({ metric: "power", agg: "max", window: 5 }), ride(), metrics).value).toBe("300");
    // Best 15 s so far: the last 15 seconds (5 at 200 W, 10 at 300 W), kept even once you ease off.
    expect(showField(custom({ metric: "power", agg: "max", window: 15 }), ride(), metrics).value).toBe("267");
    const eased = ride();
    eased.streams = { ...eased.streams, power: [...eased.streams.power, ...Array(30).fill(100)], interval: [...eased.streams.interval, ...Array(30).fill(1)] };
    expect(showField(custom({ metric: "power", agg: "max", window: 15 }), eased, metrics).value).toBe("267");
    expect(showField(custom({ metric: "power", window: 0 }), ride(), metrics).value).toBe("310");
  });

  it("shows custom power as % of FTP, W/kg or zone", () => {
    expect(showField(custom({ metric: "power", window: 10, asPercentOf: "ftp" }), ride(), metrics)).toMatchObject({ value: "120", unit: "%" });
    expect(showField(custom({ metric: "power", window: 10, as: "wkg" }), ride(), metrics)).toMatchObject({ value: "4.0", unit: "W/kg" });
    expect(showField(custom({ metric: "power", agg: "last-lap-avg", as: "zone" }), ride(), metrics).value).toBe("Z3");
  });

  it("treats a free ride as one long interval, and explains empty fields", () => {
    expect(showField(custom({ metric: "power", agg: "lap-avg" }), ride({ interval: null }), metrics).value).toBe("250");
    expect(showField(custom({ metric: "power", agg: "last-lap-avg" }), ride({ interval: 0 }), metrics)).toMatchObject({ value: null, reason: "No interval before this one yet" });
    expect(showField({ metric: "heart_rate" }, ride({ heartRate: undefined }), metrics)).toMatchObject({ value: null, reason: "No heart rate strap connected" });
    expect(showField(custom({ metric: "power", agg: "max", window: 60 }), ride(), metrics)).toMatchObject({ value: null, reason: "Needs 60 seconds of riding" });
    expect(showField({ metric: "fitness.ctl" }, ride(), metrics)).toMatchObject({ value: null, reason: "Not a live number" });
  });

  it("names custom fields", () => {
    expect(customLabel({ metric: "power", window: 10, agg: "avg" })).toBe("10s power");
    expect(customLabel({ metric: "power", window: 300, agg: "avg", asPercentOf: "ftp" })).toBe("5 min power, % FTP");
    expect(customLabel({ metric: "heart_rate", window: 0, agg: "lap-avg" })).toBe("Interval avg HR");
    expect(customLabel({ metric: "power", window: 15, agg: "max" })).toBe("Best 15s power");
    expect(customLabel({ metric: "power", window: 1200, agg: "max", as: "wkg" })).toBe("Best 20 min power, W/kg");
    expect(customLabel({ metric: "power", window: 0, agg: "last-lap-avg", as: "zone" })).toBe("Last interval power zone");
  });

  it("greys out fields a rider can't use, with the reason", () => {
    const has = { power: true, heartRate: false, weight: false, thresholdHr: true };
    expect(unavailableReason(fieldNeeds({ metric: "heart_rate" }, metrics), has)).toBe("No heart rate strap paired");
    expect(unavailableReason(fieldNeeds({ metric: "power.wkg" }, metrics), has)).toBe("Add your weight in Settings");
    expect(unavailableReason(fieldNeeds({ metric: "power.target" }, metrics), has)).toBeNull();
    expect(unavailableReason(fieldNeeds(custom({ metric: "cadence", window: 10 }), metrics), { ...has, power: false })).toBe("No trainer or power meter paired");
  });

  it("computes every default field once, keyed for the overlay and phone", () => {
    const refs = defaultLayout().ride.workout.pages[0].fields;
    const shown = showFields([...refs, ...refs], ride(), metrics);
    expect(Object.keys(shown)).toEqual(refs.map(fieldKey));
    expect(fieldKey(custom({ metric: "power", window: 10 }))).toBe("custom:power:avg:10::");
  });
});
