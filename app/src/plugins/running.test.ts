// A plugin Lactic switched off stays off: the next ride second doesn't start a fresh worker for it.
import { describe, expect, it, vi } from "vitest";
import { validateManifest } from "./manifest";
import { InProcessWorker, quickjs } from "./test-utils";
import type { PluginRecord } from "./store";

vi.mock("./store", () => ({ listPlugins: vi.fn(async () => []), markSwitchedOff: vi.fn(async () => undefined) }));
const { pluginHost, stopPlugin } = await import("./running");

const m = validateManifest({ apiVersion: 1, id: "crashy", name: "Crashy", version: "1.0.0", description: "x", main: "m.js", permissions: { read: ["live"] }, contributes: { fields: [{ id: "ff", title: "F", entry: "f" }] } });
if (!m.ok) throw new Error(m.errors.join());

const record = (source: string): PluginRecord => ({
  pluginId: "crashy",
  manifest: m.manifest,
  source,
  sha256: "a".repeat(64),
  installedAt: "",
  origin: null,
  grant: { sha256: "a".repeat(64), read: ["live"], enabled: true, coachVisible: false, switchedOff: null },
  state: "on",
});

describe("switched-off plugins", () => {
  it("starts a plugin that throws on every call once, and keeps it off across later ticks", async () => {
    const mod = await quickjs();
    let spawns = 0;
    const worker = () => {
      spawns++;
      return new InProcessWorker(mod);
    };
    const p = record(`lactic.register({ f() { throw new Error("no"); } });`);
    for (let tick = 0; tick < 10; tick++) {
      const host = await pluginHost(p, worker);
      if (host) await host.call("f", { power: 200 });
    }
    expect(spawns).toBe(1);
    expect(await pluginHost(p, worker)).toBeNull();
    stopPlugin("crashy");
  });

  it("doesn't retry a plugin that can't start", async () => {
    const mod = await quickjs();
    let spawns = 0;
    const p = { ...record("throw new Error('nope')"), pluginId: "crashy" };
    for (let tick = 0; tick < 5; tick++) await pluginHost(p, () => (spawns++, new InProcessWorker(mod)));
    expect(spawns).toBe(1);
    stopPlugin("crashy");
  });
});
