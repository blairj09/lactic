import { describe, expect, it } from "vitest";
import { liveNumbers } from "../ride/fields";
import { parseLayout } from "./layout";
import { fieldFromKit, isPluginFieldId, parsePluginFieldId, pluginFieldId } from "./plugin-fields";

describe("plugin ride field ids", () => {
  it("round-trips and refuses anything else", () => {
    const id = pluginFieldId("sweet-spot", "sweet-spot");
    expect(id).toBe("plugin_field.sweet-spot.sweet-spot");
    expect(parsePluginFieldId(id)).toEqual({ pluginId: "sweet-spot", fieldId: "sweet-spot" });
    for (const bad of ["plugin.sweet-spot.seconds", "plugin_field.x", "plugin_field.ab.cd.ef", "plugin_field.AB.cd", "power"]) expect(isPluginFieldId(bad)).toBe(false);
  });

  it("survives a saved ride layout", () => {
    const id = pluginFieldId("sweet-spot", "sweet-spot");
    const l = parseLayout({ v: 1, ride: { workout: { pages: [{ name: "Main", template: "four", fields: [{ metric: "power" }, { metric: id }] }] } } });
    expect(l.ride.workout.pages[0].fields).toContainEqual({ metric: id });
  });
});

describe("a plugin's tree as a ride field", () => {
  it("takes the first field or stat, with Lactic's tones", () => {
    expect(fieldFromKit({ type: "field", label: "ignored", value: "4:12", sub: "in it", tone: "good" })).toEqual({ value: "4:12", unit: "", sub: "in it", tone: "positive" });
    expect(fieldFromKit({ type: "stack", children: [{ type: "text", text: "hi" }, { type: "stat", label: "x", value: "12", tone: "muted" }] })).toEqual({ value: "12", unit: "" });
    expect(fieldFromKit({ type: "text", text: "nothing" })).toBeNull();
  });

  it("adds one small chart, cut down to fit a ride field", () => {
    const f = fieldFromKit({ type: "stack", children: [{ type: "field", label: "x", value: "Z3", unit: "13 min" }, { type: "bars", values: [4, 11, 13, null, -1], labels: ["Z1", "Z2", "Z3", "Z4", "Z5"], palette: "zones" }, { type: "sparkline", values: [1, 2] }] });
    expect(f).toEqual({ value: "Z3", unit: "13 min", chart: { kind: "bars", values: [4, 11, 13, 0, 0], labels: ["Z1", "Z2", "Z3", "Z4", "Z5"], zones: true } });
    expect(fieldFromKit({ type: "sparkline", values: Array.from({ length: 400 }, (_, i) => i) })).toMatchObject({ value: null, chart: { kind: "line" } });
    expect((fieldFromKit({ type: "sparkline", values: Array.from({ length: 400 }, (_, i) => i) })?.chart as { values: number[] }).values).toHaveLength(120);
    expect(fieldFromKit({ type: "bars", values: new Array(11).fill(1) })).toBeNull();
    expect(fieldFromKit({ type: "bars", values: [1, 2], labels: ["long label", "b"] })?.chart).toEqual({ kind: "bars", values: [1, 2] });
    expect(fieldFromKit({ type: "meter", value: 0.68, tone: "good" })?.chart).toEqual({ kind: "meter", value: 0.68, tone: "positive" });
  });

  it("keeps a ride field short", () => {
    expect(fieldFromKit({ type: "field", label: "x", value: "STOP PEDALLING NOW" })).toBeNull();
    expect(fieldFromKit({ type: "field", label: "x", value: "1", unit: "watts per kg" })).toBeNull();
    expect(fieldFromKit({ type: "field", label: "x", value: "1", sub: "y".repeat(100) })?.sub).toHaveLength(40);
  });
});

describe("live numbers for plugin fields", () => {
  it("gives raw numbers, null when there's no reading", () => {
    const n = liveNumbers({ streams: { power: [200, 210, 220], heartRate: [], cadence: [], interval: [-1, -1, -1] }, ftp: 250, weightKg: 70, thresholdHr: null, power: 220, interval: null, toGo: null, elapsed: 3 });
    expect(n["power.3s"]).toBe(210);
    expect(n["power.pct_ftp"]).toBe(84);
    expect(n["heart_rate"]).toBeNull();
    expect(n["heart_rate.zone"]).toBeNull();
    expect(n["profile.ftp"]).toBe(250);
  });
});
