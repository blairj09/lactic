// The plugin sandbox self-check: runs the hostile test plugin (fixtures/escape-plugin.js) through the
// real worker, plus a probe worker that tries the worker's own ways out, and says what passed. It's
// the same set of attacks as the tests, but inside whatever webview this is, so it can be run in the
// Mac app (Settings in Lactic Modular) and in Chromium (scripts/plugin-smoke). Loaded on demand.
import { PluginHost, type TickResult } from "./host";
import { createPluginWorker, createProbeWorker } from "./spawn";
import { validateManifest } from "./manifest";
import source from "./fixtures/escape-plugin.js?raw";
import manifestJson from "./fixtures/escape-manifest.json";

export interface Check {
  name: string;
  pass: boolean;
  detail: string;
}

const reached = (r: TickResult) => (r.ok ? (r.output.metrics?.["plugin.escape-artist.reached"] ?? null) : null);
const show = (r: TickResult) => (r.ok ? `ok, published ${JSON.stringify(reached(r))}` : `${r.reason}: ${r.message}`);

export async function runSandboxCheck(onProgress?: (done: number) => void): Promise<Check[]> {
  const checks: Check[] = [];
  const add = (name: string, pass: boolean, detail: string) => {
    checks.push({ name, pass, detail });
    onProgress?.(checks.length);
  };
  const m = validateManifest(manifestJson);
  if (!m.ok) return [{ name: "Test plugin manifest", pass: false, detail: m.errors.join("; ") }];
  const host = new PluginHost(m.manifest, source, createPluginWorker, { policy: { maxCrashes: 999, maxConsecutiveOverruns: 999 } });
  const metrics = { power: 250, "recovery.hrv": 60, "profile.weight": 70 };
  const ready = async () => {
    for (let i = 0; i < 200 && host.status !== "ready"; i++) await new Promise((r) => setTimeout(r, 50));
  };
  const call = async (entry: string) => {
    await ready();
    return host.call(entry, metrics);
  };

  const t0 = performance.now();
  const started = await host.start();
  add("Engine starts in a worker", started, `${started ? "ready" : host.disabledReason} in ${Math.round(performance.now() - t0)} ms`);
  if (!started) return checks;

  const echo = await call("echoPower");
  add("Plugin gets approved numbers and answers", reached(echo) === 250, show(echo));
  const seen = await call("seen");
  add("Only approved metric groups go in (no HRV, no weight)", reached(seen) === 1, show(seen));
  for (const [entry, label] of [
    ["globals", "No browser, Tauri, network, storage or timer globals"],
    ["globalNames", "Nothing but plain JavaScript on the global"],
    ["dynamicImport", "Can't import anything"],
    ["evalScope", "eval and Function stay inside the sandbox"],
    ["tamper", "Can't replace the bridge or re-register"],
    ["laterWork", "Promise work queued for later never runs"],
  ] as const) {
    const r = await call(entry);
    add(label, r.ok && reached(r) === 0, show(r));
  }
  const afterTamper = await call("globals");
  add("Bridge still works after tampering", afterTamper.ok && reached(afterTamper) === 0, show(afterTamper));

  for (const [entry, label] of [
    ["promptText", "Text where a number belongs is refused"],
    ["undeclared", "Undeclared metrics are refused"],
    ["protoPollution", "Extra keys and __proto__ are refused"],
    ["fakeUi", "Lactic buttons and raw HTML are refused"],
    ["hugeTree", "Oversize trees are refused"],
    ["deepTree", "Over-deep trees are refused"],
  ] as const) {
    const r = await call(entry);
    add(label, !r.ok && r.reason === "invalid-output", show(r));
  }
  const big = await call("bigOutput");
  add("Oversize output is refused", !big.ok, show(big));
  const fake = await call("fakeTimeout");
  add("Can't pass an error off as a timeout", !fake.ok && fake.reason === "error", show(fake));

  // The main thread keeps ticking while plugins misbehave.
  let maxGap = 0;
  let last = performance.now();
  const iv = setInterval(() => {
    const n = performance.now();
    maxGap = Math.max(maxGap, n - last);
    last = n;
  }, 5);
  for (const [entry, label, ok] of [
    ["loop", "Endless loop stopped at the time limit", ["timeout"]],
    ["stubbornLoop", "Loop that swallows errors stopped", ["timeout"]],
    ["getterLoop", "Loop while output is read stopped", ["timeout"]],
    ["redos", "Runaway regular expression stopped", ["timeout", "killed"]],
    ["slowNative", "Late answer from a long native step counts as a timeout", ["timeout", "killed"]],
    ["memory", "Memory grab stopped and restarted", ["memory", "timeout", "killed"]],
    ["nativeLong", "Long native memory grab stopped", ["memory", "killed"]],
    ["recurse", "Runaway recursion stopped", ["stack", "killed"]],
    ["nativeRecursion", "Native recursion stopped", ["stack", "killed", "error"]],
  ] as const) {
    const t = performance.now();
    const r = await call(entry);
    const ms = Math.round(performance.now() - t);
    add(label, !r.ok && (ok as readonly string[]).includes(r.reason) && ms < host.limits.tickMs + host.policy.watchdogGraceMs + 3000, `${show(r)} after ${ms} ms`);
  }
  clearInterval(iv);
  add("Ride screen never froze (longest main-thread gap)", maxGap < 100, `${Math.round(maxGap)} ms`);
  const after = await call("echoPower");
  add("Plugin works again after all that", reached(after) === 250, `${show(after)}, ${host.spawns} worker start(s)`);
  host.stop();

  // Second layer: what a worker on this origin could reach if code ever got out of QuickJS.
  const probe = await new Promise<Record<string, string>>((resolve) => {
    const w = createProbeWorker();
    const timer = setTimeout(() => {
      w.terminate();
      resolve({ probe: "reached (no answer from the probe worker)" });
    }, 30_000);
    w.onmessage = (ev) => {
      clearTimeout(timer);
      w.terminate();
      resolve(ev.data as Record<string, string>);
    };
    w.onerror = (ev) => {
      clearTimeout(timer);
      resolve({ probe: `reached (probe worker failed: ${String((ev as ErrorEvent).message ?? "")})` });
    };
  });
  for (const [k, v] of Object.entries(probe)) add(`Worker layer: ${k}`, v.startsWith("blocked"), v);
  return checks;
}
