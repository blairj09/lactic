import { describe, expect, it } from "vitest";
import { liveNumbers } from "../ride/fields";
import { validateKit } from "./kit";
import { fitFields, pageSlots, parseLayout } from "./layout";
import { fieldFromKit, isPluginFieldId, parsePluginFieldId, pluginFieldId, resolveOptions, toggleChoice, type FieldOption } from "./plugin-fields";

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

describe("several numbers in one ride field", () => {
  it("takes a values node over a field, up to four, with Lactic's tones", () => {
    const f = fieldFromKit({
      type: "stack",
      children: [
        { type: "field", label: "x", value: "1" },
        { type: "values", unit: "W", items: [{ label: "5 s", value: "612" }, { label: "1 min", value: "402", tone: "good" }, { label: "5 min", value: "271" }, { label: "20 min", value: "–", tone: "muted" }, { label: "60 min", value: "–" }] },
      ],
    });
    expect(f).toEqual({ value: null, unit: "W", values: [{ label: "5 s", value: "612" }, { label: "1 min", value: "402", tone: "positive" }, { label: "5 min", value: "271" }, { label: "20 min", value: "–" }] });
  });

  it("refuses numbers or labels too long to read from the saddle", () => {
    expect(fieldFromKit({ type: "values", items: [{ label: "5 s", value: "12345678" }] })).toBeNull();
    expect(fieldFromKit({ type: "values", items: [{ label: "a long label", value: "1" }] })).toBeNull();
  });

  it("is checked like any other kit node", () => {
    expect(validateKit({ type: "values", items: [] }).ok).toBe(false);
    expect(validateKit({ type: "values", items: [{ label: "a", value: 1 }] }).ok).toBe(false);
    expect(validateKit({ type: "values", items: [{ label: "a", value: "1", onclick: "x" }] })).toEqual({ ok: true, node: { type: "values", items: [{ label: "a", value: "1" }] } });
  });
});

describe("field options", () => {
  const durations: FieldOption = { id: "durations", label: "Durations", choices: ["5 s", "1 min", "5 min", "20 min", "60 min"], default: ["5 s", "1 min"], max: 3 };
  const zone: FieldOption = { id: "zone", label: "Zone", choices: ["Z2", "Z3"], default: ["Z2"] };

  it("hands the plugin the rider's picks still on offer, in order, or the default", () => {
    expect(resolveOptions([durations, zone], undefined)).toEqual({ durations: ["5 s", "1 min"], zone: ["Z2"] });
    expect(resolveOptions([durations], { durations: ["60 min", "gone", "5 s", "1 min", "5 min"] })).toEqual({ durations: ["5 s", "1 min", "5 min"] });
    expect(resolveOptions([zone], { zone: ["nope"] })).toEqual({ zone: ["Z2"] });
  });

  it("toggles choices within the limit", () => {
    expect(toggleChoice(zone, ["Z2"], "Z3")).toEqual(["Z3"]);
    expect(toggleChoice(durations, ["5 s", "1 min"], "60 min")).toEqual(["5 s", "1 min", "60 min"]);
    expect(toggleChoice(durations, ["5 s", "1 min", "60 min"], "5 min")).toEqual(["5 s", "1 min", "60 min"]);
    expect(toggleChoice(durations, ["5 s", "1 min"], "5 s")).toEqual(["1 min"]);
    expect(toggleChoice(durations, ["1 min"], "1 min")).toEqual(["1 min"]);
  });

  it("keeps only well-formed picks from a saved layout", () => {
    const id = pluginFieldId("best-efforts", "efforts");
    const l = parseLayout({ v: 1, ride: { options: { [id]: { durations: ["5 s", 3, "x".repeat(40)], BAD: ["a"] }, power: { a: ["b"] } } } });
    expect(l.ride.options).toEqual({ [id]: { durations: ["5 s"] } });
    expect(parseLayout({ v: 1, ride: {} }).ride.options).toBeUndefined();
  });
});

describe("wide ride fields", () => {
  it("keep wide where the page has room and allows it", () => {
    const l = parseLayout({
      v: 1,
      ride: {
        workout: {
          pages: [
            { name: "A", template: "four", fields: [{ metric: "power", wide: true }, { metric: "cadence" }, { metric: "heart_rate" }, { metric: "so_far.np" }] },
            { name: "B", template: "one", fields: [{ metric: "power", wide: true }] },
            { name: "C", template: "four", fields: [{ metric: "power" }, { metric: "cadence" }, { metric: "heart_rate" }, { metric: "so_far.np", wide: true }] },
          ],
        },
      },
    });
    const [a, b, c] = l.ride.workout.pages;
    expect(a.fields).toEqual([{ metric: "power", wide: true }, { metric: "cadence" }, { metric: "heart_rate" }]);
    expect(pageSlots(a)).toBe(3);
    expect(b.fields).toEqual([{ metric: "power" }]);
    expect(c.fields.at(-1)).toEqual({ metric: "so_far.np" });
  });

  it("fit a smaller page shape", () => {
    expect(fitFields("two", [{ metric: "power", wide: true }, { metric: "cadence" }])).toEqual([{ metric: "power", wide: true }]);
    expect(fitFields("standard", [{ metric: "power", wide: true }])).toEqual([{ metric: "power" }]);
  });
});
