import { describe, expect, it } from "vitest";
import { manifestEntries, validateManifest, type PluginManifest } from "./manifest";
import { DEFAULT_LIMITS } from "./protocol";
import { SandboxRuntime } from "./runtime";
import { quickjs } from "./test-utils";
import { newQuickJSWASMModuleFromVariant } from "quickjs-emscripten-core";
import releaseSync from "@jitl/quickjs-wasmfile-release-sync";
import escapeSource from "./fixtures/escape-plugin.js?raw";
import escapeManifestJson from "./fixtures/escape-manifest.json";

const parsed = validateManifest(escapeManifestJson);
if (!parsed.ok) throw new Error(parsed.errors.join("\n"));
const manifest: PluginManifest = parsed.manifest;
const input = { metrics: { power: 250 }, now: 0 };

async function loaded() {
  const rt = new SandboxRuntime(await quickjs(), DEFAULT_LIMITS);
  const r = rt.load(escapeSource, manifestEntries(manifest));
  expect(r).toMatchObject({ ok: true });
  return rt;
}

function published(out: { ok: boolean; output?: string }) {
  expect(out.ok).toBe(true);
  return (JSON.parse(out.output!) as { metrics: Record<string, unknown> }).metrics.reached;
}

describe("plugin runtime: escapes", () => {
  it("sees no browser, Node, Tauri, network, storage or timer globals", async () => {
    const rt = await loaded();
    expect(published(rt.call("globals", input))).toBe(0);
    expect(published(rt.call("globalNames", input))).toBe(0);
    rt.dispose();
  });

  it("can't import anything", async () => {
    const rt = await loaded();
    const r = rt.call("dynamicImport", input);
    expect(published(r)).toBe(0);
    rt.dispose();
  });

  it("eval and Function only reach the sandbox's own global", async () => {
    const rt = await loaded();
    expect(published(rt.call("evalScope", input))).toBe(0);
    rt.dispose();
  });

  it("can't replace the bridge or re-register; overwriting JSON only breaks itself", async () => {
    const rt = await loaded();
    rt.call("tamper", input);
    // The original handlers still answer, with the bridge's own JSON.
    const after = rt.call("globals", input);
    expect(after.ok).toBe(true);
    expect(after.ok && after.output).not.toContain("99");
    expect(after.ok && after.output).not.toContain("42");
    rt.dispose();
  });

  it("queued promise work never runs", async () => {
    const rt = await loaded();
    const r = rt.call("laterWork", input);
    expect(r.ok).toBe(true);
    expect(r.ms).toBeLessThan(DEFAULT_LIMITS.tickMs + 50);
    rt.dispose();
  });
});

describe("plugin runtime: limits", () => {
  it("with the default stack limit, native recursion (toJSON chains) fails cleanly", async () => {
    const rt = await loaded();
    expect(rt.call("nativeRecursion", input)).toMatchObject({ ok: false });
    expect(published(rt.call("echoPower", input))).toBe(250);
    rt.dispose();
  });

  it("if the host stack overflows first, call throws (worker-core turns that into a fatal restart)", async () => {
    // A stack limit bigger than the host's own stack lets the recursion reach the host.
    const rt = new SandboxRuntime(await newQuickJSWASMModuleFromVariant(releaseSync), { ...DEFAULT_LIMITS, stackBytes: 256 * 1024, memoryBytes: 32 * 1024 * 1024 });
    rt.load(escapeSource, manifestEntries(manifest));
    expect(() => rt.call("nativeRecursion", input)).toThrow();
  });

  it("interrupts an infinite loop at the tick budget and stays usable", async () => {
    const rt = await loaded();
    const r = rt.call("loop", input);
    expect(r).toMatchObject({ ok: false, failure: { kind: "timeout" } });
    expect(r.ms).toBeLessThan(DEFAULT_LIMITS.tickMs + 100);
    expect(published(rt.call("echoPower", input))).toBe(250);
    rt.dispose();
  });

  it("interrupts a loop that swallows errors (the interrupt can't be caught)", async () => {
    const rt = await loaded();
    expect(rt.call("stubbornLoop", input)).toMatchObject({ ok: false, failure: { kind: "timeout" } });
    rt.dispose();
  });

  it("interrupts a getter that loops while the output is serialised", async () => {
    const rt = await loaded();
    expect(rt.call("getterLoop", input)).toMatchObject({ ok: false, failure: { kind: "timeout" } });
    rt.dispose();
  });

  it("stops a memory grab and restarts the engine clean", async () => {
    const rt = new SandboxRuntime(await quickjs(), { ...DEFAULT_LIMITS, tickMs: 10_000 });
    rt.load(escapeSource, manifestEntries(manifest));
    const r = rt.call("memory", input);
    expect(r).toMatchObject({ ok: false, failure: { kind: "memory" }, restarted: true });
    expect(published(rt.call("echoPower", input))).toBe(250);
    rt.dispose();
  });

  it("stops runaway recursion and restarts the engine clean", async () => {
    const rt = await loaded();
    const r = rt.call("recurse", input);
    expect(r).toMatchObject({ ok: false, failure: { kind: "stack" }, restarted: true });
    expect(published(rt.call("echoPower", input))).toBe(250);
    rt.dispose();
  });

  it("refuses output over the size limit inside the sandbox", async () => {
    const rt = await loaded();
    expect(rt.call("bigOutput", input)).toMatchObject({ ok: false, failure: { kind: "error", message: expect.stringContaining("output too large") } });
    rt.dispose();
  });

  it("a plugin can't fake a timeout by throwing 'interrupted'", async () => {
    const rt = await loaded();
    expect(rt.call("fakeTimeout", input)).toMatchObject({ ok: false, failure: { kind: "error" } });
    rt.dispose();
  });

  it("times out a plugin whose top-level code never finishes", async () => {
    const rt = new SandboxRuntime(await quickjs(), DEFAULT_LIMITS);
    const r = rt.load("for(;;){}", ["x"]);
    expect(r).toMatchObject({ ok: false, failure: { kind: "timeout" } });
    expect(rt.loaded).toBe(false);
  });

  it("fails a load that doesn't register every handler the manifest names", async () => {
    const rt = new SandboxRuntime(await quickjs(), DEFAULT_LIMITS);
    expect(rt.load("lactic.register({ a: function () {} })", ["a", "b"])).toMatchObject({ ok: false, failure: { kind: "no-entry" } });
  });

  it("only calls handlers the manifest names", async () => {
    const rt = new SandboxRuntime(await quickjs(), DEFAULT_LIMITS);
    rt.load("lactic.register({ a: function () { return null }, secret: function () { return 1 } })", ["a"]);
    expect(rt.call("a", input)).toMatchObject({ ok: true, output: "null" });
    expect(rt.call("secret", input)).toMatchObject({ ok: false, failure: { kind: "no-entry" } });
    rt.dispose();
  });
});
