import { describe, expect, it } from "vitest";
import { validateKit } from "./kit";
import { bandOf, blockText, clock, formatNumber, rampZone, rideBlock, shownNumber, targetVerdict, zonebarPosition, type BlockNode } from "./blocks";
import { fieldFromKit } from "./plugin-fields";

const ok = (n: unknown) => {
  const r = validateKit(n);
  if (!r.ok) throw new Error(r.error);
  return r.node;
};
const err = (n: unknown) => {
  const r = validateKit(n);
  return r.ok ? null : r.error;
};

describe("blocks from a plugin", () => {
  it("checks a gauge and keeps only known fields", () => {
    const g = ok({ type: "gauge", value: 34.2, min: 0, max: 60, decimals: 1, zones: [{ to: 25 }, { to: 40, tone: "good" }, { to: 60, zone: 6 }], ticks: 10, needle: true, html: "<b>" });
    expect(g).toEqual({ type: "gauge", value: 34.2, min: 0, max: 60, decimals: 1, zones: [{ to: 25 }, { to: 40, tone: "good" }, { to: 60, zone: 6 }], ticks: 10, needle: true });
  });

  it("refuses broken gauges", () => {
    expect(err({ type: "gauge", value: 1, min: 5, max: 5 })).toMatch(/above min/);
    expect(err({ type: "gauge", value: "fast", min: 0, max: 5 })).toMatch(/number/);
    expect(err({ type: "gauge", value: 1, min: 0, max: 100, ticks: 1 })).toMatch(/ticks/);
    expect(err({ type: "gauge", value: 1, min: 0, max: 5, zones: new Array(8).fill({ to: 1 }) })).toMatch(/at most 7/);
    expect(err({ type: "gauge", value: 1, min: 0, max: 5, zone: 9 })).toMatch(/zone/);
    expect(err({ type: "gauge", value: 1, min: 0, max: 5, tone: "#ff0000" })).toMatch(/tone/);
  });

  it("checks the other blocks", () => {
    expect(ok({ type: "ring", value: 1.4, text: "72%" })).toEqual({ type: "ring", value: 1, text: "72%" });
    expect(err({ type: "zonebar", value: 1, bands: [0, 5, 3] })).toMatch(/go up/);
    expect(err({ type: "zonebar", value: 1, bands: [0] })).toMatch(/at least 2/);
    expect(ok({ type: "target", value: 86, target: 95, unit: "rpm", within: 5 })).toMatchObject({ type: "target", within: 5 });
    expect(err({ type: "list", rows: [{ label: "a" }] })).toMatch(/row value/);
    expect(err({ type: "status", text: "Hot", icon: "skull" })).toMatch(/icon/);
    expect(err({ type: "countdown" })).toMatch(/until or since/);
    expect(err({ type: "countdown", until: 1, since: 2 })).toMatch(/until or since/);
    expect(err({ type: "balance", left: 0, right: 0 })).toMatch(/not both 0/);
  });

  it("checks the new options on old nodes", () => {
    expect(ok({ type: "field", label: "W'", value: 3.1, unit: "kJ", decimals: 1, tone: "bad", subTone: "good", zone: 6, emphasis: "flash", change: { by: -1.2, since: "5 min", good: "up" } })).toMatchObject({ value: 3.1, emphasis: "flash", change: { by: -1.2 } });
    expect(err({ type: "field", label: "x", value: Infinity })).toMatch(/finite/);
    expect(err({ type: "field", label: "x", value: 1, decimals: 9 })).toMatch(/decimals/);
    expect(err({ type: "field", label: "x", value: 1, emphasis: "blink" })).toMatch(/emphasis/);
    expect(ok({ type: "sparkline", values: [1, 2], fill: true, band: [1, 2], ref: 1.5, marker: "last" })).toMatchObject({ fill: true, band: [1, 2] });
    expect(err({ type: "sparkline", values: [1, 2], band: [3, 1] })).toMatch(/band/);
    expect(err({ type: "bars", values: [1, 2], highlight: -1 })).toMatch(/highlight/);
    expect(ok({ type: "text", text: "hi", tone: "accent" })).toEqual({ type: "text", text: "hi", tone: "accent" });
  });
});

describe("numbers", () => {
  it("formats by kind", () => {
    expect(formatNumber(724, { format: "duration" })).toBe("12:04");
    expect(formatNumber(3725, { format: "duration" })).toBe("1:02:05");
    expect(formatNumber(0.724, { format: "percent" })).toBe("72%");
    expect(formatNumber(34.25, { decimals: 1 })).toBe("34.3");
    expect(formatNumber(12345)).toBe("12,345");
    expect(formatNumber(-0.04, { decimals: 1 })).toBe("0.0");
    expect(clock(-5)).toBe("0:00");
  });

  it("converts metric units for imperial riders", () => {
    expect(shownNumber(34.2, "km/h", { decimals: 1 }, "imperial")).toEqual({ text: "21.3", unit: "mph" });
    expect(shownNumber(34.2, "km/h", { decimals: 1 }, "metric")).toEqual({ text: "34.2", unit: "km/h" });
    expect(shownNumber(72, "kg", { decimals: 1 }, "imperial")).toEqual({ text: "158.7", unit: "lb" });
    expect(shownNumber(20, "°C", {}, "imperial")).toEqual({ text: "68", unit: "°F" });
    expect(shownNumber(248, "W", {}, "imperial")).toEqual({ text: "248", unit: "W" });
    // A duration is a duration in any units.
    expect(shownNumber(90, "km", { format: "duration" }, "imperial")).toEqual({ text: "1:30", unit: "km" });
  });
});

describe("what blocks work out", () => {
  const edges = [0, 138, 188, 225, 263, 300, 375, 500];
  it("finds a value's band and place", () => {
    expect(bandOf(248, edges)).toBe(3);
    expect(bandOf(-5, edges)).toBe(0);
    expect(bandOf(900, edges)).toBe(6);
    expect(zonebarPosition(244, edges)).toBeCloseTo((3 + 0.5) / 7, 2);
    expect(zonebarPosition(900, edges)).toBe(1);
  });

  it("spreads unnamed bands over the zone ramp", () => {
    expect([0, 1, 2].map((i) => rampZone(i, 3))).toEqual([2, 5, 7]);
    expect(rampZone(0, 1)).toBe(4);
  });

  it("words a target", () => {
    const fmt = (n: number) => String(Math.round(n));
    expect(targetVerdict(86, 95, 5, fmt)).toEqual({ words: "9 under", good: false });
    expect(targetVerdict(97, 95, 5, fmt)).toEqual({ words: "On target", good: true });
    expect(targetVerdict(250, 245, undefined, fmt)).toEqual({ words: "5 over", good: false });
  });

  it("has a one-line form for every block", () => {
    const now = 1000;
    const blocks: [BlockNode, string][] = [
      [{ type: "gauge", value: 34.2, min: 0, max: 60, unit: "km/h", decimals: 1 }, "34.2"],
      [{ type: "ring", value: 0.72 }, "72%"],
      [{ type: "zonebar", value: 248, bands: edges }, "Z4"],
      [{ type: "list", rows: [{ label: "a", value: "4:12" }, { label: "b", value: "3:58" }] }, "4:12 · 3:58"],
      [{ type: "status", text: "Too hot" }, "Too hot"],
      [{ type: "countdown", until: 1258 }, "4:18"],
      [{ type: "balance", left: 48, right: 52 }, "48/52"],
    ];
    for (const [b, text] of blocks) expect(blockText(b, "metric", now)).toBe(text);
  });

  it("trims blocks for a ride field", () => {
    const list = rideBlock({ type: "list", rows: Array.from({ length: 8 }, (_, i) => ({ label: `A very long climb name ${i}`, value: "4:12" })) });
    expect(list?.type === "list" && list.rows.length).toBe(5);
    expect(list?.type === "list" && list.rows[0].label).toHaveLength(16);
    expect(rideBlock({ type: "list", rows: [] })).toBeNull();
  });
});

describe("blocks and looks in a ride field", () => {
  it("lets a gauge take the number's place", () => {
    const v = fieldFromKit(ok({ type: "gauge", value: 34.2, min: 0, max: 60 }));
    expect(v).toEqual({ value: null, unit: "", chart: { kind: "block", block: { type: "gauge", value: 34.2, min: 0, max: 60 } } });
    const both = fieldFromKit(ok({ type: "stack", children: [{ type: "field", label: "Speed", value: "34", sub: "steady" }, { type: "gauge", value: 34.2, min: 0, max: 60 }] }));
    expect(both).toMatchObject({ value: null, sub: "steady", chart: { kind: "block" } });
  });

  it("keeps the field's number beside a ring without words", () => {
    const v = fieldFromKit(ok({ type: "stack", children: [{ type: "field", label: "Fuel", value: 0.72, format: "percent" }, { type: "ring", value: 0.72 }] }));
    expect(v).toMatchObject({ value: "72%", chart: { kind: "block", block: { type: "ring" } } });
  });

  it("writes numbers in the rider's units", () => {
    expect(fieldFromKit(ok({ type: "field", label: "Speed", value: 34.2, unit: "km/h", decimals: 1 }), "imperial")).toEqual({ value: "21.3", unit: "mph" });
    expect(fieldFromKit(ok({ type: "field", label: "Time", value: 724, format: "duration" }))).toEqual({ value: "12:04", unit: "" });
  });

  it("carries zone colour, emphasis and change", () => {
    const v = fieldFromKit(ok({ type: "field", label: "Drift", value: 4.2, unit: "%", decimals: 1, zone: 6, subTone: "good", emphasis: "flash", change: { by: 1.1, since: "20 min", good: "down" } }));
    expect(v).toEqual({ value: "4.2", unit: "%", sub: "+1.1 since 20 min", look: { zone: 6, subTone: "positive", emphasis: "flash", change: { dir: "up", tone: "warning" } } });
  });

  it("passes chart options through", () => {
    const v = fieldFromKit(ok({ type: "bars", values: [246, 251, null], target: 250, highlight: 1 }));
    expect(v?.chart).toEqual({ kind: "bars", values: [246, 251, 0], target: 250, highlight: 1 });
    const line = fieldFromKit(ok({ type: "sparkline", values: [1, 2, 3], fill: true, band: [1, 2], marker: "last", tone: "accent" }));
    expect(line?.chart).toEqual({ kind: "line", values: [1, 2, 3], tone: "accent", fill: true, band: [1, 2], marker: "last" });
  });
});
