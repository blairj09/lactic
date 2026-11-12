import { describe, expect, it } from "vitest";
import { PluginHost, type WorkerLike } from "./host";
import { validateManifest, type PluginManifest } from "./manifest";
import { InProcessWorker, quickjs, StuckWorker } from "./test-utils";
import escapeSource from "./fixtures/escape-plugin.js?raw";
import escapeManifestJson from "./fixtures/escape-manifest.json";

const parsed = validateManifest(escapeManifestJson);
if (!parsed.ok) throw new Error(parsed.errors.join("\n"));
const manifest: PluginManifest = parsed.manifest;
const metrics = { power: 250, cadence: { value: 90 }, "recovery.hrv": 60, "profile.ftp": 280, "plugin.other.secret": 5 };

async function host(policy = {}) {
  const mod = await quickjs();
  const workers: InProcessWorker[] = [];
  const h = new PluginHost(manifest, escapeSource, () => {
    const w = new InProcessWorker(mod);
    workers.push(w);
    return w;
  }, { policy });
  expect(await h.start()).toBe(true);
  return { h, workers };
}

describe("plugin host", () => {
  it("round-trips approved metrics and a validated tree", async () => {
    const { h } = await host();
    const r = await h.call("echoPower", metrics);
    expect(r).toMatchObject({ ok: true, output: { metrics: { "plugin.escape-artist.reached": 250 }, tree: { type: "field", value: "250" } } });
    h.stop();
  });

  it("only hands over Lactic metrics from approved groups (no recovery, profile or other plugins here)", async () => {
    const { h } = await host();
    expect(await h.call("seen", metrics)).toMatchObject({ ok: true, output: { metrics: { "plugin.escape-artist.reached": 2 } } });
    h.stop();
  });

  it("refuses prompt text, undeclared metrics, fake UI and oversize trees, and counts them as crashes", async () => {
    const { h } = await host({ maxCrashes: 99 });
    for (const entry of ["promptText", "undeclared", "fakeUi", "hugeTree", "deepTree", "protoPollution"]) {
      expect(await h.call(entry, metrics)).toMatchObject({ ok: false, reason: "invalid-output" });
    }
    expect(h.crashes).toBe(6);
    h.stop();
  });

  it("returns busy rather than queueing a second tick", async () => {
    const { h } = await host();
    const first = h.call("echoPower", metrics);
    expect(await h.call("echoPower", metrics)).toMatchObject({ ok: false, reason: "busy" });
    expect(await first).toMatchObject({ ok: true });
    h.stop();
  });

  it("switches a plugin off after three crashes", async () => {
    const statuses: string[] = [];
    const mod = await quickjs();
    const h = new PluginHost(manifest, escapeSource, () => new InProcessWorker(mod), { onStatus: (s) => statuses.push(s) });
    await h.start();
    await h.call("fakeTimeout", metrics);
    await h.call("promptText", metrics);
    expect(h.status).toBe("ready");
    await h.call("recurse", metrics);
    expect(h.status).toBe("disabled");
    expect(h.disabledReason).toMatch(/3 crashes/);
    expect(await h.call("echoPower", metrics)).toMatchObject({ ok: false, reason: "disabled" });
    expect(statuses.at(-1)).toBe("disabled");
  });

  it("switches a plugin off after repeated overruns, but a good tick resets the count", async () => {
    const { h } = await host({ maxConsecutiveOverruns: 3 });
    await h.call("loop", metrics);
    await h.call("loop", metrics);
    await h.call("echoPower", metrics);
    expect(h.overruns).toBe(0);
    await h.call("loop", metrics);
    await h.call("loop", metrics);
    expect(h.status).toBe("ready");
    await h.call("loop", metrics);
    expect(h.status).toBe("disabled");
  });

  it("kills a worker that stops answering and starts a fresh one", async () => {
    const workers: WorkerLike[] = [];
    const mod = await quickjs();
    let n = 0;
    const h = new PluginHost(manifest, escapeSource, () => {
      const w = n++ === 0 ? new StuckWorker() : new InProcessWorker(mod);
      workers.push(w);
      return w;
    }, { limits: { tickMs: 10 }, policy: { watchdogGraceMs: 30 } });
    await h.start();
    const t0 = Date.now();
    expect(await h.call("echoPower", metrics)).toMatchObject({ ok: false, reason: "killed" });
    expect(Date.now() - t0).toBeLessThan(500);
    expect((workers[0] as StuckWorker).terminated).toBe(true);
    expect(h.crashes).toBe(1);
    await new Promise((r) => setTimeout(r, 50));
    expect(h.spawns).toBe(2);
    expect(h.status).toBe("ready");
    expect(await h.call("echoPower", metrics)).toMatchObject({ ok: true });
    h.stop();
  });

  it("restarts the worker when a plugin breaks the engine itself", async () => {
    const workers: InProcessWorker[] = [];
    const h = new PluginHost(manifest, escapeSource, () => {
      // A fresh engine per worker, like real workers, since the broken one can't be reused.
      const w = new InProcessWorker(null);
      workers.push(w);
      return w;
    }, { limits: { stackBytes: 256 * 1024, memoryBytes: 32 * 1024 * 1024 } });
    expect(await h.start()).toBe(true);
    expect(await h.call("nativeRecursion", metrics)).toMatchObject({ ok: false, reason: "killed" });
    expect(workers[0].terminated).toBe(true);
    await new Promise((r) => setTimeout(r, 300));
    expect(h.status).toBe("ready");
    expect(h.spawns).toBe(2);
    expect(await h.call("echoPower", metrics)).toMatchObject({ ok: true });
    h.stop();
  });

  it("restarts the worker when the engine reports a fatal error", async () => {
    const { h, workers } = await host();
    workers[0].onmessage?.({ data: { type: "fatal" } });
    expect(workers[0].terminated).toBe(true);
    await new Promise((r) => setTimeout(r, 50));
    expect(h.status).toBe("ready");
    expect(h.spawns).toBe(2);
    expect(h.crashes).toBe(1);
    h.stop();
  });

  it("disables a plugin whose code won't load", async () => {
    const mod = await quickjs();
    const h = new PluginHost(manifest, "throw new Error('nope')", () => new InProcessWorker(mod));
    expect(await h.start()).toBe(false);
    expect(h.status).toBe("disabled");
    expect(h.disabledReason).toMatch(/couldn't start/);
  });

  it("refuses handlers outside the manifest without bothering the worker", async () => {
    const { h } = await host();
    expect(await h.call("notInManifest", metrics)).toMatchObject({ ok: false, reason: "no-entry" });
    h.stop();
  });
});
