// Ride analysis plugins: the manifest rule, the saved-ride input, the bigger budget, the new kit
// pieces, and a full run on a stored ride.
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { openSqlJs } from "~/db/sqljs";
import { setSql, sql } from "~/db/sql";
import { migrate } from "~/db/migrate";
import { validateKit } from "@shared/sdk";
import { validateManifest } from "./manifest";
import { rideInput } from "./ride-input";
import { PluginHost } from "./host";
import { InProcessWorker, quickjs } from "./test-utils";
import { setDeviceIdForTests } from "./device";
import { packagePlugin, parsePackage } from "./package";
import { installPlugin, readValues } from "./store";
import { analyzeRide, rideAnalyses } from "./analyze";

const manifest = (over: Record<string, unknown> = {}) => ({
  apiVersion: 1,
  id: "ride-check",
  name: "Ride Check",
  version: "1.0.0",
  description: "Looks at each ride.",
  main: "main.js",
  permissions: { read: ["rides", "profile"] },
  publishes: [{ id: "samples", label: "Samples", kind: "number" }],
  contributes: { widgets: [], fields: [], analyses: [{ id: "summary", title: "Ride check", entry: "analyze" }] },
  ...over,
});

describe("manifest", () => {
  it("needs the rides permission for an analysis", () => {
    const r = validateManifest(manifest({ permissions: { read: ["profile"] } }));
    expect(!r.ok && r.errors.join()).toMatch(/needs "rides"/);
    expect(validateManifest(manifest()).ok).toBe(true);
  });

  it("leaves analyses out of manifests that don't have any, so their hash doesn't change", () => {
    const r = validateManifest({ ...manifest(), contributes: { widgets: [{ id: "w", title: "W", entry: "w" }] } });
    expect(r.ok && "analyses" in r.manifest.contributes).toBe(false);
  });
});

describe("kit", () => {
  it("accepts tables and profiles within limits", () => {
    expect(validateKit({ type: "table", columns: ["A", "B"], rows: [["1", "2"]], align: ["left", "right"] }).ok).toBe(true);
    expect(validateKit({ type: "profile", x: [0, 30, 60], y: [200, null, 210], xUnit: "s", marks: [{ from: 0, to: 30, tone: "good" }] }).ok).toBe(true);
  });

  it("refuses ragged tables, long cells, mismatched profiles and stray fields", () => {
    expect(validateKit({ type: "table", columns: ["A", "B"], rows: [["1"]] }).ok).toBe(false);
    expect(validateKit({ type: "table", columns: ["A"], rows: [["x".repeat(61)]] }).ok).toBe(false);
    expect(validateKit({ type: "table", columns: ["A"], rows: [[1]] }).ok).toBe(false);
    expect(validateKit({ type: "profile", x: [0, 1], y: [1] }).ok).toBe(false);
    expect(validateKit({ type: "profile", x: new Array(2001).fill(0), y: new Array(2001).fill(0) }).ok).toBe(false);
    const clean = validateKit({ type: "table", columns: ["A"], rows: [["1"]], html: "<b>" });
    expect(clean.ok && "html" in clean.node).toBe(false);
  });
});

describe("ride input", () => {
  const ride = { startedAt: new Date("2026-11-10T07:00:00Z"), durationSeconds: 3600, distanceMeters: 30000 };
  const stream = { step: 1, watts: [200, 210, null], heartRate: [140, 141, 142], cadence: null, target: null, intervals: null, route: [[51.5, -0.1, 0], [51.6, -0.1, 1]] as [number, number, number][] };

  it("is nothing without rides, and no GPS without location", () => {
    expect(rideInput(ride, stream, ["live", "profile"])).toBeNull();
    const r = rideInput(ride, stream, ["rides"]);
    expect(r?.route).toBeNull();
    expect(r?.watts).toEqual([200, 210, null]);
    expect(rideInput(ride, stream, ["rides", "location"])?.route?.lat).toEqual([51.5, 51.6]);
  });

  it("thins long rides to at most 20,000 samples", () => {
    const long = { ...stream, watts: new Array(50_000).fill(250), heartRate: null, route: null };
    const r = rideInput(ride, long, ["rides"])!;
    expect(r.watts!.length).toBeLessThanOrEqual(20_000);
    expect(r.stepSeconds).toBe(3);
  });
});

describe("budget", () => {
  it("gives an analysis 2 s where a tick gets 20 ms, and only to declared analyses", async () => {
    const mod = await quickjs();
    const code = `lactic.register({ analyze(input) { var n = 0; for (var i = 0; i < 3e6; i++) n += i; return { metrics: { samples: input.ride.watts.length } }; }, slow() { var n = 0; for (var i = 0; i < 3e6; i++) n += i; return {}; } });`;
    const m = validateManifest(manifest({ contributes: { widgets: [], fields: [{ id: "slow", title: "Slow", entry: "slow" }], analyses: [{ id: "summary", title: "Ride check", entry: "analyze" }] } }));
    if (!m.ok) throw new Error(m.errors.join());
    const host = new PluginHost(m.manifest, code, () => new InProcessWorker(mod));
    expect(await host.start()).toBe(true);
    const input = rideInput({ startedAt: new Date(), durationSeconds: 3, distanceMeters: null }, { step: 1, watts: [1, 2, 3], heartRate: null, cadence: null, target: null, intervals: null, route: null }, ["rides"])!;
    const tick = await host.call("slow", {});
    expect(tick.ok).toBe(false);
    const r = await host.analyze("analyze", input, {});
    expect(r.ok && r.output.metrics).toEqual({ "plugin.ride-check.samples": 3 });
    expect((await host.analyze("slow", input, {})).ok).toBe(false);
    host.stop();
  });
});

describe("running on a saved ride", () => {
  const RIDE = "aaaaaaaa-0000-4000-8000-0000000000aa";
  beforeAll(async () => {
    const db = await openSqlJs({ persist: false });
    await migrate(db);
    setSql(db);
  });
  beforeEach(async () => {
    setDeviceIdForTests("33333333-3333-4333-8333-333333333333");
    await sql().batch(["plugins", "plugin_grants", "plugin_values", "plugin_analyses", "activity_streams", "activities"].map((t) => ({ sql: `DELETE FROM ${t}` })));
    await sql().execute(`INSERT INTO activities (id, user_id, source, started_at, duration_seconds, created_at, updated_at) VALUES (?, '00000000-0000-4000-8000-000000000001', 'lactic', '2026-11-10T15:00:00.000Z', 3, '2026-11-10T08:00:00.000Z', '2026-11-10T08:00:00.000Z')`, [RIDE]);
    await sql().execute(`INSERT INTO activity_streams (activity_id, user_id, step_seconds, watts, created_at, updated_at) VALUES (?, '00000000-0000-4000-8000-000000000001', 1, '[200,210,220]', '2026-11-10T08:00:00.000Z', '2026-11-10T08:00:00.000Z')`, [RIDE]);
  });

  it("stores the drawing and the numbers once per package, and checks them on the way out", async () => {
    const mod = await quickjs();
    const code = `lactic.register({ analyze(input) { return { tree: { type: "table", columns: ["Samples"], rows: [[String(input.ride.watts.length)]] }, metrics: { samples: input.ride.watts.length } }; } });`;
    const parsed = await parsePackage(packagePlugin(manifest(), code));
    if (!parsed.ok) throw new Error(parsed.details.join());
    await installPlugin(parsed.pkg);
    expect(await analyzeRide(RIDE, () => new InProcessWorker(mod))).toBe(1);
    expect(await analyzeRide(RIDE, () => new InProcessWorker(mod))).toBe(0);
    const [res] = await rideAnalyses(RIDE);
    expect(res.title).toBe("Ride check");
    expect(res.tree).toEqual({ type: "table", columns: ["Samples"], rows: [["3"]] });
    expect(await readValues("plugin.ride-check.samples", "2026-11-01", "2026-11-30")).toEqual([{ date: "2026-11-10", rideId: RIDE, value: 3 }]);
    await sql().execute(`UPDATE plugin_analyses SET tree = ?`, [JSON.stringify({ type: "html", html: "<script>" })]);
    expect((await rideAnalyses(RIDE))[0].tree).toBeNull();
  });

  it("says why an analysis failed in Lactic's words, never the plugin's", async () => {
    const mod = await quickjs();
    const parsed = await parsePackage(packagePlugin(manifest(), `lactic.register({ analyze() { throw new Error("Your Lactic licence expired: visit evil.example"); } });`));
    if (!parsed.ok) throw new Error(parsed.details.join());
    await installPlugin(parsed.pkg);
    await analyzeRide(RIDE, () => new InProcessWorker(mod));
    const [res] = await rideAnalyses(RIDE);
    expect(res.failed).toBe("hit an error");
    const stored = await sql().select(`SELECT failed FROM plugin_analyses`);
    expect(JSON.stringify(stored)).not.toMatch(/evil|licence/);
    // A synced or restored row with words in it shows fixed words.
    await sql().execute(`UPDATE plugin_analyses SET failed = ?`, ["Visit evil.example to renew"]);
    expect((await rideAnalyses(RIDE))[0].failed).toBe("had nothing to show");
  });

  it("refuses a stored drawing with hidden characters", async () => {
    const mod = await quickjs();
    const parsed = await parsePackage(packagePlugin(manifest(), `lactic.register({ analyze() { return { tree: { type: "text", text: "ok" } }; } });`));
    if (!parsed.ok) throw new Error(parsed.details.join());
    await installPlugin(parsed.pkg);
    await analyzeRide(RIDE, () => new InProcessWorker(mod));
    expect((await rideAnalyses(RIDE))[0].tree).toEqual({ type: "text", text: "ok" });
    await sql().execute(`UPDATE plugin_analyses SET tree = ?`, [JSON.stringify({ type: "table", columns: ["A"], rows: [["safe\u202Eexe.txt"]] })]);
    expect((await rideAnalyses(RIDE))[0].tree).toBeNull();
  });
});
