// Preferences kept in localStorage that follow the rider to a paired iPhone through app_settings.
import { beforeAll, describe, expect, it } from "vitest";

class MemoryStorage {
  m = new Map<string, string>();
  getItem(k: string) {
    return this.m.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.m.set(k, String(v));
  }
  removeItem(k: string) {
    this.m.delete(k);
  }
}

Object.assign(globalThis, { window: Object.assign(new EventTarget(), { dispatchEvent: () => true }) });

const { openSqlJs } = await import("~/db/sqljs");
const { setSql, sql } = await import("~/db/sql");
const { migrate } = await import("~/db/migrate");
const { getSetting, setSetting } = await import("./store");
const { applySharedPrefs, installSharedPrefs } = await import("./shared-prefs");

const store = new MemoryStorage() as unknown as Storage;
const flush = () => new Promise((r) => setTimeout(r, 20));

beforeAll(async () => {
  setSql(await openSqlJs({ persist: false }));
  await migrate(sql());
  installSharedPrefs(store);
});

describe("shared preferences", () => {
  it("copies a shared key into app_settings and leaves per-device keys alone", async () => {
    store.setItem("lactic:units", "imperial");
    store.setItem("mycoach:theme", "dark");
    store.setItem("ride.overlaySize", "{}");
    await flush();
    expect(await getSetting("pref.lactic:units", null)).toEqual({ v: "imperial" });
    expect(await getSetting("pref.mycoach:theme", null)).toBeNull();
    expect(await getSetting("pref.ride.overlaySize", null)).toBeNull();
  });

  it("takes values that arrived by sync, including removals, without copying them back", async () => {
    store.setItem("ride.autoStart", "true");
    await flush();
    await setSetting("pref.lactic:units", { v: "metric" });
    await setSetting("pref.ride.autoStart", { v: null });
    const before = await sql().select(`SELECT updated_at FROM app_settings WHERE key = 'pref.lactic:units'`);
    const changed = await applySharedPrefs(store, false);
    await flush();
    expect(changed.sort()).toEqual(["lactic:units", "ride.autoStart"]);
    expect(store.getItem("lactic:units")).toBe("metric");
    expect(store.getItem("ride.autoStart")).toBeNull();
    const after = await sql().select(`SELECT updated_at FROM app_settings WHERE key = 'pref.lactic:units'`);
    expect(after).toEqual(before);
  });

  it("on the computer, seeds app_settings from a preference saved before syncing existed", async () => {
    // Written straight to storage, as an older Lactic did.
    (store as unknown as MemoryStorage).m.set("ride.sprintGrade", "8");
    await applySharedPrefs(store, true);
    expect(await getSetting("pref.ride.sprintGrade", null)).toEqual({ v: "8" });
  });
});
