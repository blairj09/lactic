// The published plugin SDK (plugins/sdk) matches the app, and the starter plugin (plugins/starter)
// builds, packs and runs in the real sandbox.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import type * as Sdk from "../../../plugins/sdk/src/index";
import { KIT_LIMITS, LACTIC_METRICS, type KitNode, type MetricGroup } from "@shared/sdk";
import { METRIC_GROUPS, type PluginManifest } from "./manifest";
import { packagePlugin, parsePackage } from "./package";
import { PluginHost } from "./host";
import { InProcessWorker, quickjs } from "./test-utils";

// Compile-time: the SDK's types fit the app's. A drift here fails typecheck.
type Extends<A, B> = [A] extends [B] ? true : false;
const kitFits: Extends<Sdk.KitNode, KitNode> = true;
const groupsSame: Extends<Sdk.MetricGroup, MetricGroup> & Extends<MetricGroup, Sdk.MetricGroup> = true;
const manifestFits: Extends<PluginManifest, Sdk.PluginManifest> = true;

const root = (p: string) => fileURLToPath(new URL(`../../../plugins/${p}`, import.meta.url));

describe("@lactic/sdk", () => {
  it("lists the same metrics and limits as the app", async () => {
    const sdk = await import("../../../plugins/sdk/src/index");
    expect(kitFits && groupsSame && manifestFits).toBe(true);
    expect(sdk.KIT_LIMITS).toEqual(KIT_LIMITS);
    expect(Object.keys(sdk.METRICS).sort()).toEqual([...METRIC_GROUPS].sort());
    for (const g of METRIC_GROUPS) expect([...sdk.METRICS[g]].sort()).toEqual(LACTIC_METRICS.filter((m) => m.group === g).map((m) => m.id).sort());
  });
});

describe("starter plugin", () => {
  it("builds, packs and runs in the sandbox", async () => {
    const out = await build({
      entryPoints: [root("starter/src/plugin.ts")],
      bundle: true,
      format: "iife",
      target: "es2020",
      write: false,
      alias: { "@lactic/sdk": root("sdk/src/index.ts") },
      logLevel: "silent",
    });
    const code = out.outputFiles[0].text;
    const manifest = JSON.parse(readFileSync(root("starter/manifest.json"), "utf8"));
    const parsed = await parsePackage(packagePlugin(manifest, code));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    const mod = await quickjs();
    const host = new PluginHost(parsed.pkg.manifest, parsed.pkg.source, () => new InProcessWorker(mod));
    expect(await host.start()).toBe(true);
    await host.call("field", { "power.3s": 230, "profile.ftp": 250 }, 1000);
    const r = await host.call("field", { "power.3s": 230, "profile.ftp": 250 }, 1003);
    expect(r.ok && r.output.metrics).toEqual({ "plugin.sweet-spot.seconds": 3, "plugin.sweet-spot.zone": "sweet-spot" });
    expect(r.ok && (r.output.tree as KitNode & { type: "field" }).value).toBe("0:03");
    const ride = { startedAt: 0, durationSeconds: 120, distanceMeters: null, stepSeconds: 1, watts: new Array(120).fill(230), heartRate: null, cadence: null, target: null, intervals: [{ index: 0, kind: "steady" as const, planned: 120, ridden: 120, target: 230, power: 230, heartRate: null, cadence: null }], route: null };
    const analysis = await host.analyze("analyze", ride, { "profile.ftp": 250 });
    expect(analysis.ok && analysis.output.metrics).toEqual({ "plugin.sweet-spot.ride_minutes": 120 });
    expect(analysis.ok && JSON.stringify(analysis.output.tree)).toContain('"type":"profile"');
    const card = await host.call("card", { "profile.ftp": 250 });
    expect(card.ok && JSON.stringify(card.output.tree)).toContain("220–235 W");
    host.stop();
  });
});
