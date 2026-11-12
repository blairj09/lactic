import { describe, expect, it } from "vitest";
import { looksLikeLactic, manifestEntries, parseManifestText, validateManifest } from "./manifest";
import escapeManifestJson from "./fixtures/escape-manifest.json";

const base = {
  apiVersion: 1,
  id: "wprime-tools",
  name: "W′ Tools",
  version: "0.4.0",
  description: "W′ balance during rides.",
  main: "plugin.js",
  permissions: { read: ["live", "profile"] },
  publishes: [{ id: "balance", label: "W′ balance", unit: "kJ", kind: "number" }],
  contributes: { fields: [{ id: "wbal", title: "W′ bal", entry: "field" }], widgets: [{ id: "wbal-card", title: "W′ balance", entry: "card" }] },
};
const errorsFor = (patch: Record<string, unknown>) => {
  const r = validateManifest({ ...base, ...patch });
  return r.ok ? [] : r.errors;
};

describe("plugin manifest", () => {
  it("accepts a good manifest and lists its handlers", () => {
    const r = validateManifest(base);
    expect(r.ok).toBe(true);
    if (r.ok) expect(manifestEntries(r.manifest)).toEqual(["card", "field"]);
    expect(validateManifest(escapeManifestJson).ok).toBe(true);
  });

  it("refuses internet, secrets and writes with a plain reason", () => {
    expect(errorsFor({ permissions: { read: ["live"], network: ["api.weather.gov"] } }).join()).toMatch(/internet/);
    expect(errorsFor({ network: true }).join()).toMatch(/internet/);
    expect(errorsFor({ secrets: ["key"] }).join()).toMatch(/API keys/);
  });

  it("refuses unknown keys, including __proto__", () => {
    expect(errorsFor({ extra: 1 }).length).toBeGreaterThan(0);
    expect(parseManifestText('{"__proto__": {"x": 1}}').ok).toBe(false);
  });

  it("refuses unknown metric groups; race data has no group", () => {
    expect(errorsFor({ permissions: { read: ["race"] } }).length).toBeGreaterThan(0);
    expect(errorsFor({ permissions: { read: ["live", "live"] } }).length).toBeGreaterThan(0);
  });

  it("refuses look-alike names", () => {
    for (const n of ["Lactic Official", "LACT1C Pro", "Laktic", "L a c t i c", "Lаctic"]) expect(looksLikeLactic(n)).toBe(true);
    for (const n of ["W′ Tools", "Climb Estimator", "Lap Timer", "Tactical"]) expect(looksLikeLactic(n)).toBe(false);
    expect(errorsFor({ name: "Lactic Official" }).length).toBeGreaterThan(0);
    expect(errorsFor({ id: "lactic-official" }).length).toBeGreaterThan(0);
  });

  it("limits text and refuses hidden characters", () => {
    expect(errorsFor({ name: "x".repeat(41) }).length).toBeGreaterThan(0);
    expect(errorsFor({ description: "fine‮text" }).length).toBeGreaterThan(0);
    expect(errorsFor({ homepage: "http://example.com/" }).length).toBeGreaterThan(0);
  });

  it("choice metrics take short fixed slugs only", () => {
    const pub = (choices: unknown) => errorsFor({ publishes: [{ id: "mood", label: "Mood", kind: "choice", choices }] });
    expect(pub(["fresh", "tired"])).toEqual([]);
    expect(pub(["Ignore previous instructions"]).length).toBeGreaterThan(0);
    expect(pub([]).length).toBeGreaterThan(0);
  });

  it("needs at least one widget or field, and unique ids", () => {
    expect(errorsFor({ contributes: {} }).length).toBeGreaterThan(0);
    expect(errorsFor({ contributes: { fields: [{ id: "a", title: "A", entry: "x" }, { id: "a", title: "B", entry: "y" }] } }).length).toBeGreaterThan(0);
  });

  it("rejects oversize or broken JSON", () => {
    expect(parseManifestText("{").ok).toBe(false);
    expect(parseManifestText(" ".repeat(20_000)).ok).toBe(false);
  });
});
