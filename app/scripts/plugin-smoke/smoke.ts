// Browser smoke test for the plugin sandbox: runs the hostile test plugin through a real module
// worker under the app's production CSP (copied into index.html) and puts the results on
// window.__smoke. Run with `node scripts/plugin-smoke/run.cjs` from app/.
import { PluginHost } from "~/plugins/host";
import { createPluginWorker } from "~/plugins/spawn";
import { validateManifest } from "~/plugins/manifest";
import source from "~/plugins/fixtures/escape-plugin.js?raw";
import mj from "~/plugins/fixtures/escape-manifest.json";
const out: Record<string, unknown> = {};
(async () => {
  try {
    const m = validateManifest(mj);
    if (!m.ok) throw new Error("manifest");
    const h = new PluginHost(m.manifest, source, createPluginWorker, { policy: { maxCrashes: 99, maxConsecutiveOverruns: 99 } });
    const t0 = performance.now();
    out.started = await h.start();
    out.startMs = Math.round(performance.now() - t0);
    const metrics = { power: 250, "recovery.hrv": 60 };
    for (const e of ["echoPower", "globals", "globalNames", "dynamicImport", "evalScope", "seen", "promptText", "fakeUi", "bigOutput"]) out[e] = await h.call(e, metrics);
    // Main thread keeps ticking while the plugin loops.
    let ticks = 0, maxGap = 0, last = performance.now();
    const iv = setInterval(() => { const n = performance.now(); maxGap = Math.max(maxGap, n - last); last = n; ticks++; }, 5);
    const t1 = performance.now();
    out.stubbornLoop = await h.call("stubbornLoop", metrics);
    out.stubbornLoopWallMs = Math.round(performance.now() - t1);
    const wait = async () => { for (let i = 0; i < 100 && h.status !== "ready"; i++) await new Promise((r) => setTimeout(r, 50)); };
    const timed = async (e: string) => { await wait(); const t = performance.now(); const r = await h.call(e, metrics); return { ...r, wallMs: Math.round(performance.now() - t) }; };
    out.memory = await timed("memory");
    out.nativeLong = await timed("nativeLong");
    out.recurse = await timed("recurse");
    out.nativeRecursion = await timed("nativeRecursion");
    clearInterval(iv);
    out.mainThreadMaxGapMs = Math.round(maxGap);
    await new Promise((r) => setTimeout(r, 1500));
    out.afterRestart = await h.call("echoPower", metrics);
    out.spawns = h.spawns;
    out.status = h.status;
    h.stop();
  } catch (e) {
    out.error = String(e);
  }
  (window as unknown as { __smoke: unknown }).__smoke = out;
})();
