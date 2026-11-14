// Plugin previews: every catalog plugin draws something on the sample ride, a broken plugin fails in
// Lactic's words, and previews never get a GPS route.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parsePackage } from "./package";
import { PREVIEW_LIMITS, PREVIEW_WORDS, runPreview, type PreviewState } from "./preview";
import { sampleLiveNumbers, sampleRide } from "./preview-sample";
import { InProcessWorker, quickjs } from "./test-utils";
import { validateManifest } from "./manifest";

const CATALOG = join(__dirname, "../../../plugins/catalog");
const index = JSON.parse(readFileSync(join(CATALOG, "index.json"), "utf8")) as {
  plugins: { id: string; file: string }[];
};

// Tests tick every 10th ride second with a long allowance: the in-process worker is far slower than a real one.
async function preview(manifest: Parameters<typeof runPreview>[0], source: string, signal = new AbortController().signal, opts: Parameters<typeof runPreview>[5] = {}) {
  const mod = await quickjs();
  const updates: PreviewState[] = [];
  const out = await runPreview(
    manifest,
    source,
    () => new InProcessWorker(mod),
    (s) => updates.push(s),
    signal,
    { step: 10, budgetMs: 120_000, riding: () => false, ...opts },
  );
  return { out, updates };
}

describe("sample ride", () => {
  it("is the same every time and has sensible live numbers", () => {
    const r = sampleRide();
    expect(r.seconds).toBe(1980);
    const mid = sampleLiveNumbers(500);
    expect(mid["power.zone"]).toBeGreaterThanOrEqual(3);
    expect(mid["heart_rate"]).toBeGreaterThan(100);
    expect(mid["profile.ftp"]).toBe(250);
  });
});

describe("plugin previews", () => {
  for (const p of index.plugins) {
    it(`${p.id} draws every part on the sample ride`, async () => {
      const parsed = await parsePackage(readFileSync(join(CATALOG, p.file), "utf8"));
      if (!parsed.ok) throw new Error(parsed.reason);
      const { out, updates } = await preview(parsed.pkg.manifest, parsed.pkg.source);
      expect(out.failed).toBeUndefined();
      expect(out.done).toBe(true);
      for (const part of out.parts)
        expect({
          title: part.title,
          failed: part.failed,
          drawn: Boolean(part.field || part.tree),
        }).toEqual({ title: part.title, failed: undefined, drawn: true });
      expect(updates.at(-1)?.done).toBe(true);
    }, 30_000);
  }

  const manifest = (read: string[], fields = 0) => {
    const r = validateManifest({
      apiVersion: 1,
      id: "probe",
      name: "Probe",
      version: "1.0.0",
      description: "Test.",
      main: "main.js",
      permissions: { read },
      publishes: [],
      contributes: {
        widgets: [],
        fields: Array.from({ length: fields }, (_, i) => ({ id: `f${i}`, title: `F${i}`, entry: "field" })),
        analyses: [{ id: "look", title: "Look", entry: "look" }],
      },
    });
    if (!r.ok) throw new Error(r.errors.join("; "));
    return r.manifest;
  };

  it("never hands a preview a GPS route", async () => {
    const src = `lactic.register({ look(input) { return { tree: { type: "text", text: input.ride.route ? "route" : "no route" } }; } });`;
    const { out } = await preview(manifest(["rides", "location"]), src);
    expect(out.parts[0].tree).toEqual({ type: "text", text: "no route" });
  });

  it("says in Lactic's words when a plugin throws", async () => {
    const src = `lactic.register({ look() { throw new Error("Your Lactic licence expired"); } });`;
    const { out } = await preview(manifest(["rides"]), src);
    expect(out.parts[0].failed).toBe("hit an error");
  });

  it("says when a plugin won't start", async () => {
    const { out } = await preview(manifest(["rides"]), `throw new Error("nope")`);
    expect(out.failed).toMatch(/^It couldn't start/);
    expect(out.parts[0].tree).toBeUndefined();
  });

  it("stops when the screen closes", async () => {
    const parsed = await parsePackage(readFileSync(join(CATALOG, index.plugins.find((p) => p.id === "zones")!.file), "utf8"));
    if (!parsed.ok) throw new Error(parsed.reason);
    const ac = new AbortController();
    setTimeout(() => ac.abort(), 30);
    const { out } = await preview(parsed.pkg.manifest, parsed.pkg.source, ac.signal);
    expect(out.done).toBe(false);
  });

  it("stops a slow plugin at its time allowance and keeps what it has", async () => {
    // Each call spends ~15 ms (under the 20 ms tick budget, so never an overrun) on every field.
    const src = `lactic.register({ field(input) { const end = Date.now() + 15; while (Date.now() < end) {} return { tree: { type: "field", label: "", value: String(Math.round(input.metrics.power ?? 0)) } }; }, look() { return { tree: { type: "text", text: "late" } }; } });`;
    const started = Date.now();
    const { out } = await preview(manifest(["live", "rides"], 3), src, undefined, { budgetMs: 1500 });
    expect(Date.now() - started).toBeLessThan(3000);
    expect(out.cut).toBe(true);
    expect(out.done).toBe(true);
    expect(out.at).toBeLessThan(out.of);
    expect(out.parts.filter((p) => p.kind === "field").every((p) => p.field?.value)).toBe(true);
    expect(out.parts.find((p) => p.kind === "analysis")?.failed).toBe(PREVIEW_WORDS.skipped);
  }, 10_000);

  it("previews at most the first few fields", async () => {
    const src = `lactic.register({ field() { return { tree: { type: "field", label: "", value: "1" } }; }, look() { return { tree: { type: "text", text: "ok" } }; } });`;
    const { out } = await preview(manifest(["live", "rides"], 9), src, undefined, { step: 60 });
    expect(out.parts.filter((p) => p.kind === "field")).toHaveLength(PREVIEW_LIMITS.fields);
    expect(out.more).toBe(9 - PREVIEW_LIMITS.fields);
  });

  it("doesn't run while a ride is under way, and stops if one starts", async () => {
    const src = `lactic.register({ field() { return { tree: { type: "field", label: "", value: "1" } }; }, look() { return { tree: { type: "text", text: "ok" } }; } });`;
    const before = await preview(manifest(["live", "rides"], 1), src, undefined, { riding: () => true });
    expect(before.out.failed).toBe(PREVIEW_WORDS.riding);
    expect(before.out.parts.every((p) => !p.field && !p.tree)).toBe(true);
    let calls = 0;
    const during = await preview(manifest(["live", "rides"], 1), src, undefined, { riding: () => ++calls > 20 });
    expect(during.out.failed).toBe(PREVIEW_WORDS.riding);
    expect(during.out.at).toBeLessThan(during.out.of);
  });
});
