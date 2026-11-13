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
