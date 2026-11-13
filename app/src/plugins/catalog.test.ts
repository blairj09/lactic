// The official plugin catalog (plugins/catalog): the committed files match their sources, every
// plugin passes Lactic's package checks, and each one runs in the real sandbox through a whole
// simulated ride, with missing data, within its budget, publishing only what its manifest declares.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { KitNode } from "@shared/sdk";
// @ts-expect-error: plain ESM script, no types
import { buildCatalog, compare, CATALOG } from "../../scripts/build-plugin-catalog.mjs";
import { parsePackage, type PluginPackage } from "./package";
import { PluginHost, type TickResult } from "./host";
import { InProcessWorker, quickjs } from "./test-utils";
import type { RideInput } from "./protocol";

interface Built {
  files: Record<string, string>;
  index: { catalog: 1; plugins: { id: string; version: string; file: string; sha256: string }[] };
}
const built: Built = await buildCatalog();

async function load(id: string): Promise<{ pkg: PluginPackage; host: PluginHost }> {
  const entry = built.index.plugins.find((p) => p.id === id)!;
  const parsed = await parsePackage(readFileSync(join(CATALOG, entry.file), "utf8"));
  if (!parsed.ok) throw new Error(`${id}: ${parsed.details.join("; ")}`);
  const mod = await quickjs();
  const host = new PluginHost(parsed.pkg.manifest, parsed.pkg.source, () => new InProcessWorker(mod));
  expect(await host.start()).toBe(true);
  return { pkg: parsed.pkg, host };
}

// ---- A simulated 40-minute workout at FTP 250 W ----
const FTP = 250;
const SECONDS = 40 * 60;
interface Second {
  power: number;
  target: number | null;
  hr: number;
  cadence: number;
  interval: number;
}
const ride: Second[] = [];
for (let t = 0; t < SECONDS; t++) {
  let power = 150;
  let target: number | null = 150;
  let interval = 0;
  if (t >= 600 && t < 2100) {
    const k = Math.floor((t - 600) / 300);
    const on = (t - 600) % 300 < 180;
    interval = 1 + k * 2 + (on ? 0 : 1);
    target = on ? 300 : 150;
    power = on ? 300 + ((t % 7) - 3) : 150;
  } else if (t >= 2100) {
    interval = 11;
    target = 140;
    power = 140;
  }
  // Three 20-second surges in the warm-up: matches.
  if ([120, 300, 480].some((s) => t >= s && t < s + 20)) power = 420;
  const coasting = t % 300 > 295;
  ride.push({ power: coasting ? 0 : power, target, hr: Math.round(115 + (power - 150) / 6 + t / 120), cadence: coasting ? 0 : 88 + (t % 5), interval });
}

function liveMetrics(t: number) {
  const s = ride[t];
  const sofar = ride.slice(0, t + 1);
  const avg = sofar.reduce((a, b) => a + b.power, 0) / sofar.length;
  const inInterval = sofar.filter((x) => x.interval === s.interval);
  const intervalAvg = inInterval.reduce((a, b) => a + b.power, 0) / inInterval.length;
  const np = t >= 180 ? avg * 1.06 : null; // stands in for the engine's NP
  return {
    power: s.power,
    "power.3s": s.power,
    "power.target": s.target,
    heart_rate: s.hr,
    cadence: s.cadence,
    "ride.elapsed": t,
    "interval.avg_power": intervalAvg,
    "so_far.power": avg,
    "so_far.np": np,
    "so_far.kj": sofar.reduce((a, b) => a + b.power, 0) / 1000,
    "ride.intensity": np ? (np / FTP) * 100 : null,
    "profile.ftp": FTP,
    "profile.weight": 70,
  };
}

const savedRide: RideInput = {
  startedAt: 1_700_000_000,
  durationSeconds: SECONDS,
  distanceMeters: null,
  stepSeconds: 1,
  watts: ride.map((s) => s.power),
  heartRate: ride.map((s) => s.hr),
  cadence: ride.map((s) => s.cadence),
  target: ride.map((s) => s.target),
  intervals: Array.from({ length: 12 }, (_, i) => {
    const secs = ride.filter((s) => s.interval === i);
    const mean = (f: (s: Second) => number) => secs.reduce((a, b) => a + f(b), 0) / secs.length;
    return { index: i, kind: "steady" as const, planned: secs.length, ridden: secs.length, target: secs[0].target, power: mean((s) => s.power), heartRate: mean((s) => s.hr), cadence: mean((s) => s.cadence) };
  }),
  route: null,
};
const emptyRide: RideInput = { ...savedRide, watts: null, heartRate: null, cadence: null, target: null, intervals: [] };
const rideMetrics = { "profile.ftp": FTP, "profile.weight": 70, "profile.wkg": FTP / 70, "ride.np": 215, "ride.tss": 45, "ride.duration": SECONDS, "ride.avg_hr": 130 };

/** Checks a call worked and published only declared metrics; returns its output. */
function ok(pkg: PluginPackage, r: TickResult) {
  if (!r.ok) throw new Error(`${pkg.manifest.id}: ${r.reason} ${r.message}`);
  const declared = new Set((pkg.manifest.publishes ?? []).map((m) => `plugin.${pkg.manifest.id}.${m.id}`));
  for (const k of Object.keys(r.output.metrics ?? {})) expect(declared.has(k), `${k} is declared`).toBe(true);
  return r.output;
}

const text = (tree: KitNode | undefined) => JSON.stringify(tree ?? null);

describe("plugin catalog", () => {
  it("has its built files and index.json up to date", () => {
    expect(compare(built)).toEqual([]);
  });

  it("has between 8 and 12 plugins, each with a README", () => {
    expect(built.index.plugins.length).toBeGreaterThanOrEqual(8);
    expect(built.index.plugins.length).toBeLessThanOrEqual(12);
    // The README links the current file, so it can't point at an old version.
    for (const p of built.index.plugins) expect(readFileSync(join(CATALOG, p.id, "README.md"), "utf8")).toContain(p.file.slice("dist/".length));
  });

  for (const entry of built.index.plugins) {
    it(`${entry.id} runs through a ride, with and without data`, async () => {
      const { pkg, host } = await load(entry.id);
      const c = pkg.manifest.contributes;
      // Nothing yet: no ride, no profile.
      for (const f of [...c.fields, ...c.widgets]) ok(pkg, await host.call(f.entry, {}, 1000));
      for (const a of c.analyses ?? []) {
        ok(pkg, await host.analyze(a.entry, emptyRide, {}));
        ok(pkg, await host.analyze(a.entry, savedRide, rideMetrics));
      }
      // A whole ride, one tick a second, every tick inside the 20 ms budget.
      for (const f of c.fields) for (let t = 0; t < SECONDS; t++) ok(pkg, await host.call(f.entry, liveMetrics(t), 1000 + t));
      for (const w of c.widgets) ok(pkg, await host.call(w.entry, { "fitness.ctl": 60, "fitness.atl": 75, "fitness.tsb": -15, "plan.week_done": 40 }));
      host.stop();
    }, 60_000);
  }

  it("works out the numbers it says it does", async () => {
    const field = async (id: string, entry: string, until: number) => {
      const { pkg, host } = await load(id);
      let last;
      for (let t = 0; t <= until; t++) last = ok(pkg, await host.call(entry, liveMetrics(t), 1000 + t));
      host.stop();
      return last!;
    };
    const analysis = async (id: string) => {
      const { pkg, host } = await load(id);
      const out = ok(pkg, await host.analyze("analyze", savedRide, rideMetrics));
      host.stop();
      return out;
    };

    // W′ drains on the surges (170 W over CP for 20 s = 3.4 kJ) and refills between them.
    const wp = await field("w-prime", "field", 125);
    expect(wp.metrics!["plugin.w-prime.balance"]).toBeLessThan(20000);
    expect((await analysis("w-prime")).metrics!["plugin.w-prime.lowest"]).toBeLessThan(80);

    // Best 5 minutes: the first on-interval is 180 s at ~300 W plus easier riding.
    const be = await analysis("best-efforts");
    expect(be.metrics!["plugin.best-efforts.best_1min"]).toBeGreaterThan(299);
    expect(text(be.tree)).toContain("20 min");

    // Three surges at 420 W (168% FTP) in the warm-up; the 300 W intervals are 120%, so they count too.
    const m = await field("matches", "field", 600);
    expect(m.metrics!["plugin.matches.count"]).toBe(3);
    expect((await analysis("matches")).metrics!["plugin.matches.ride_count"]).toBe(8);

    // Heart rate creeps up a beat every 2 minutes, so the second half drifts.
    expect((await analysis("decoupling")).metrics!["plugin.decoupling.drift"]).toBeGreaterThan(0);

    // Fuel is due at 20 minutes.
    expect((await field("fuel", "field", 1210)).metrics!["plugin.fuel.due"]).toBe("now");
    expect((await field("fuel", "field", 1300)).metrics!["plugin.fuel.due"]).toBe("no");

    // Every interval in the simulation is ridden at its target.
    expect((await analysis("on-target")).metrics!["plugin.on-target.hit_share"]).toBeGreaterThan(80);

    expect((await field("cadence-bands", "field", 60)).metrics!["plugin.cadence-bands.smooth"]).toBeGreaterThan(85);
    expect((await analysis("ride-quality")).metrics!["plugin.ride-quality.if"]).toBe(0.86);
  }, 120_000);
});
