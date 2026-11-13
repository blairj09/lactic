// Installing, updating and approving plugins on SQLite, per device, and what the coach then sees.
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { openSqlJs } from "~/db/sqljs";
import { setSql, sql } from "~/db/sql";
import { migrate } from "~/db/migrate";
import { setDeviceIdForTests } from "./device";
import { packagePlugin, parsePackage, type PluginPackage } from "./package";
import { approvePlugin, installPlugin, listPlugins, markSwitchedOff, preparePackage, readValues, recordValues, removePlugin, setCoachVisible, setPluginEnabled, updatePlugin } from "./store";
import { storedPluginSource } from "./source";
import { CATALOG_ORIGIN, catalogEntries, catalogState, catalogText, isCatalogPackage } from "./catalog";
import { sourceLabel } from "./github";
import { pluginList } from "@/lib/coach/plugins";

const MAC = "11111111-1111-4111-8111-111111111111";
const PHONE = "22222222-2222-4222-8222-222222222222";

const manifest = (over: Record<string, unknown> = {}) => ({
  apiVersion: 1,
  id: "wprime-tools",
  name: "W′ Tools",
  version: "0.4.0",
  description: "W′ balance as a ride field and a card.",
  author: "riderlabs",
  main: "main.js",
  permissions: { read: ["live", "profile", "location"] },
  publishes: [
    { id: "balance", label: "W′ balance", unit: "kJ", kind: "number" },
    { id: "state", label: "State", kind: "choice", choices: ["fresh", "empty"] },
  ],
  contributes: { widgets: [{ id: "week", title: "W′ this week", entry: "week" }], fields: [{ id: "balance", title: "W′ balance", entry: "field" }] },
  ...over,
});
const CODE = "lactic.register({ week() { return {} }, field() { return {} } });";

async function pkg(over: Record<string, unknown> = {}, code = CODE): Promise<PluginPackage> {
  const r = await parsePackage(packagePlugin(manifest(over), code));
  if (!r.ok) throw new Error(r.details.join("; "));
  return r.pkg;
}

beforeAll(async () => {
  const db = await openSqlJs({ persist: false });
  await migrate(db);
  setSql(db);
});

beforeEach(async () => {
  setDeviceIdForTests(MAC);
  await sql().batch(["plugins", "plugin_grants", "plugin_values"].map((t) => ({ sql: `DELETE FROM ${t}` })));
});

describe("plugin files", () => {
  it("refuses internet with the manifest's plain reason", async () => {
    const r = await parsePackage(packagePlugin(manifest({ network: ["api.weather.gov"] }), CODE));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("Plugins can't use the internet in this version of Lactic.");
  });

  it("refuses look-alike names, unknown keys and junk", async () => {
    const named = await parsePackage(packagePlugin(manifest({ name: "Lactic Official" }), CODE));
    expect(!named.ok && named.reason).toMatch(/looks like Lactic/);
    expect((await parsePackage(JSON.stringify({ lacticplugin: 1, manifest: manifest(), main: CODE, extra: 1 }))).ok).toBe(false);
    expect((await parsePackage("not json")).ok).toBe(false);
    expect((await parsePackage(packagePlugin(manifest(), ""))).ok).toBe(false);
  });

  it("pins the code: a one-character change is a different package", async () => {
    expect((await pkg()).sha256).not.toBe((await pkg({}, CODE + " ")).sha256);
  });
});

describe("installing", () => {
  it("leaves location and coach sharing off unless ticked", async () => {
    await installPlugin(await pkg());
    const [p] = await listPlugins();
    expect(p.state).toBe("on");
    expect(p.grant?.read).toEqual(["live", "profile"]);
    expect(p.grant?.coachVisible).toBe(false);
  });

  it("grants location only when ticked", async () => {
    await installPlugin(await pkg(), { location: true, coachVisible: true });
    expect((await listPlugins())[0].grant?.read).toEqual(["live", "profile", "location"]);
  });

  it("knows the same file, an update and a refusal", async () => {
    await installPlugin(await pkg());
    expect((await preparePackage(packagePlugin(manifest(), CODE))).kind).toBe("same");
    const up = await preparePackage(packagePlugin(manifest({ version: "0.5.0", author: "someone-else", permissions: { read: ["live", "profile", "recovery"] } }), CODE));
    expect(up.kind).toBe("update");
    if (up.kind === "update") {
      expect(up.changes.newReads).toEqual(["recovery"]);
      expect(up.changes.author).toEqual({ from: "riderlabs", to: "someone-else" });
      expect(up.changes.quiet).toBe(false);
    }
    expect((await preparePackage(packagePlugin(manifest({ network: true }), CODE))).kind).toBe("refused");
  });
});

describe("approval per device", () => {
  it("doesn't run on a device that never approved it, until approved there", async () => {
    await installPlugin(await pkg());
    setDeviceIdForTests(PHONE);
    const [p] = await listPlugins();
    expect(p.state).toBe("needs-approval");
    await expect(setPluginEnabled("wprime-tools", true)).rejects.toThrow(/Approve/);
    await approvePlugin("wprime-tools");
    expect((await listPlugins())[0].state).toBe("on");
  });

  it("stops running when the code changes underneath it (a synced update)", async () => {
    await installPlugin(await pkg());
    const changed = await pkg({ version: "0.5.0" }, CODE + "//x");
    await sql().execute(`UPDATE plugins SET source = ?, sha256 = ?, manifest = ?`, [changed.source, changed.sha256, JSON.stringify(changed.manifest)]);
    expect((await listPlugins())[0].state).toBe("changed");
  });

  it("doesn't trust the stored hash: new code under the old hash is a change", async () => {
    await installPlugin(await pkg());
    await sql().execute(`UPDATE plugins SET source = ?`, [CODE + "/* swapped */"]);
    expect((await listPlugins())[0].state).toBe("changed");
    await sql().execute(`UPDATE plugins SET source = ?`, [CODE]);
    expect((await listPlugins())[0].state).toBe("on");
    const m = { ...(await pkg()).manifest, description: "Edited in the database" };
    await sql().execute(`UPDATE plugins SET manifest = ?`, [JSON.stringify(m)]);
    expect((await listPlugins())[0].state).toBe("changed");
  });

  it("drops a row whose manifest was edited to something invalid", async () => {
    await installPlugin(await pkg());
    await sql().execute(`UPDATE plugins SET manifest = ?`, [JSON.stringify({ ...manifest(), network: ["evil.example"] })]);
    expect(await listPlugins()).toEqual([]);
  });
});

describe("updating", () => {
  it("approves new groups by the tap but keeps location declined and coach sharing as set", async () => {
    await installPlugin(await pkg());
    await updatePlugin(await pkg({ version: "0.5.0", permissions: { read: ["live", "profile", "location", "recovery"] } }));
    const [p] = await listPlugins();
    expect(p.manifest.version).toBe("0.5.0");
    expect(p.grant?.read).toEqual(["live", "profile", "recovery"]);
    expect(p.grant?.coachVisible).toBe(false);
    expect(p.state).toBe("on");
  });

  it("keeps a plugin the rider switched off, off", async () => {
    await installPlugin(await pkg());
    await setPluginEnabled("wprime-tools", false);
    await updatePlugin(await pkg({ version: "0.5.0" }));
    expect((await listPlugins())[0].state).toBe("off");
  });
});

describe("switching off and values", () => {
  it("keeps Lactic's reason when it switches a plugin off", async () => {
    await installPlugin(await pkg());
    await markSwitchedOff("wprime-tools", "ran over its time limit 5 times in a row");
    const [p] = await listPlugins();
    expect(p.state).toBe("switched-off");
    expect(p.grant?.switchedOff).toMatch(/time limit/);
    await setPluginEnabled("wprime-tools", true);
    expect((await listPlugins())[0].state).toBe("on");
  });

  it("stores only declared numbers and choices, one per ride", async () => {
    await installPlugin(await pkg());
    const ride = "aaaaaaaa-0000-4000-8000-000000000001";
    await recordValues("wprime-tools", { "plugin.wprime-tools.balance": 12.5, "plugin.wprime-tools.state": "fresh", "plugin.wprime-tools.other": 3 }, { day: "2026-11-10", activityId: ride });
    await recordValues("wprime-tools", { "plugin.wprime-tools.balance": 14, "plugin.wprime-tools.state": "nonsense" }, { day: "2026-11-10", activityId: ride });
    expect(await readValues("plugin.wprime-tools.balance", "2026-11-01", "2026-11-30")).toEqual([{ date: "2026-11-10", rideId: ride, value: 14 }]);
    expect(await readValues("plugin.wprime-tools.state", "2026-11-01", "2026-11-30")).toEqual([{ date: "2026-11-10", rideId: ride, value: "fresh" }]);
  });

  it("doesn't store values for a plugin that isn't on", async () => {
    await installPlugin(await pkg());
    await setPluginEnabled("wprime-tools", false);
    expect(await recordValues("wprime-tools", { "plugin.wprime-tools.balance": 1 }, { day: "2026-11-10" })).toBe(0);
  });

  it("removes everything a plugin stored", async () => {
    await installPlugin(await pkg());
    await recordValues("wprime-tools", { "plugin.wprime-tools.balance": 1 }, { day: "2026-11-10" });
    await removePlugin("wprime-tools");
    expect(await listPlugins()).toEqual([]);
    expect((await sql().select(`SELECT COUNT(*) AS n FROM plugin_values`))[0].n).toBe(0);
  });
});

describe("what the coach sees", () => {
  it("hides plugins until shared, and never lists a declined group", async () => {
    await installPlugin(await pkg());
    expect(pluginList(await storedPluginSource.list(), "chat").plugins).toEqual([]);
    await setCoachVisible("wprime-tools", true);
    const [shown] = pluginList(await storedPluginSource.list(), "chat").plugins;
    expect(shown.source).toBe("plugin:wprime-tools@0.4.0");
    expect(shown.reads).toEqual(["live", "profile"]);
  });

  it("hides a plugin that isn't approved on this device", async () => {
    await installPlugin(await pkg(), { coachVisible: true });
    setDeviceIdForTests(PHONE);
    expect(pluginList(await storedPluginSource.list(), "chat").plugins).toEqual([]);
  });
});

describe("running", () => {
  it("runs with only the granted groups and saves why Lactic switched it off", async () => {
    const { pluginHost } = await import("./running");
    const { InProcessWorker, quickjs } = await import("./test-utils");
    const mod = await quickjs();
    const code = `lactic.register({ week(input) { return { metrics: { balance: Object.keys(input.metrics).length } } }, field() { throw new Error("boom") } });`;
    await installPlugin(await pkg({}, code));
    const [p] = await listPlugins();
    const host = await pluginHost(p, () => new InProcessWorker(mod));
    expect(host).not.toBeNull();
    const r = await host!.call("week", { "power.3s": 200, "location.lat": 51.5 } as never);
    expect(r.ok && r.output.metrics).toEqual({ "plugin.wprime-tools.balance": 1 });
    for (let i = 0; i < 3; i++) await host!.call("field", {});
    await new Promise((res) => setTimeout(res, 20));
    expect((await listPlugins())[0].state).toBe("switched-off");
  });
});

describe("Lactic's own plugins (catalog)", () => {
  it("adds a bundled plugin as from Lactic, with its checksum checked", async () => {
    const entry = catalogEntries().find((e) => e.id === "fuel")!;
    const prepared = await preparePackage(await catalogText(entry));
    expect(prepared.kind).toBe("new");
    if (prepared.kind !== "new") return;
    expect(await isCatalogPackage(prepared.pkg.sha256)).toBe(true);
    await installPlugin(prepared.pkg, {}, CATALOG_ORIGIN);
    const [p] = await listPlugins();
    expect(p.origin).toBe(CATALOG_ORIGIN);
    expect(sourceLabel(p.origin)).toBe("Lactic");
    expect(catalogState(entry, p.manifest.version)).toBe("added");
    expect(catalogState(entry, "0.0.1")).toBe("update");
    expect(catalogState(entry, null)).toBe("add");
  });

  it("never lets other code claim to be from Lactic", async () => {
    // Saving with the catalog origin is refused for anything Lactic didn't ship.
    await expect(installPlugin(await pkg(), {}, CATALOG_ORIGIN)).rejects.toThrow(/isn't one of Lactic's plugins/);
    // A stored row (from sync, a backup or an edit) claiming it is shown as from a file.
    await installPlugin(await pkg(), {}, null);
    await sql().execute(`UPDATE plugins SET origin = ?`, [CATALOG_ORIGIN]);
    const [p] = await listPlugins();
    expect(p.origin).toBeNull();
    expect(sourceLabel(p.origin)).toBe("a file");
  });

  it("refuses a bundled file that doesn't match its checksum", async () => {
    const entry = { ...catalogEntries()[0], sha256: "0".repeat(64) };
    await expect(catalogText(entry)).rejects.toThrow(/checksum/);
  });
});
