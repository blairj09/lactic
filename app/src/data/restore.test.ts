// After a restore on a new computer: what pointed at the old one is tidied up, and the notice
// lists the keys this keychain doesn't have.
import { beforeEach, describe, expect, it } from "vitest";

const store = new Map<string, string>();
Object.assign(globalThis, {
  localStorage: {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
  },
  window: Object.assign(new EventTarget(), { dispatchEvent: () => true }),
});

const { openSqlJs } = await import("~/db/sqljs");
const { setSql, sql } = await import("~/db/sql");
const { migrate } = await import("~/db/migrate");
const { localClient } = await import("~/db/supabase-client");
const { getSetting, setSetting } = await import("~/settings/store");
const { saveSecret } = await import("~/platform/secrets");
const { coachSetup } = await import("~/ai/settings");
const { afterRestore, restoredNotice, dismissRestoredNotice } = await import("./restore");

beforeEach(async () => {
  store.clear();
  setSql(await openSqlJs({ persist: false }));
  await migrate(sql());
});

/** What a backup from the old computer carries: a cloud coach with a key, intervals.icu, a picked Health folder. */
async function oldComputer() {
  await setSetting("coach.setup", { mode: "builtin", alongside: true, provider: { kind: "openrouter", baseUrl: "https://openrouter.ai/api/v1", hasKey: true }, chat: { model: "x" }, monthlyCapUsd: 10 });
  await localClient.from("intervals_connections").upsert({ athlete_id: "i1", api_key: "keychain:intervals", connected_at: "2026-11-01T00:00:00Z" });
  await setSetting("health.folder", "/Users/old/Library/Mobile Documents/Health");
}

describe("after a restore", () => {
  it("lists the keys to add again and tidies settings from the old computer", async () => {
    await oldComputer();
    const notice = await afterRestore(new Date("2026-11-08T12:00:00Z"));
    expect(notice).toEqual({ at: "2026-11-08T12:00:00.000Z", keys: ["ai", "intervals"], healthFolder: true, mcp: true });
    expect((await coachSetup()).provider?.hasKey).toBe(false);
    expect(await getSetting("health.folder", "unset")).toBeNull();
    expect(await restoredNotice()).toEqual(notice);
    await dismissRestoredNotice();
    expect(await restoredNotice()).toBeNull();
  });

  it("doesn't ask for keys this computer already has", async () => {
    await oldComputer();
    await saveSecret("ai", "sk-or-aaaa1111");
    await saveSecret("intervals", "intervalskey2222");
    const notice = await afterRestore();
    expect(notice.keys).toEqual([]);
    expect((await coachSetup()).provider?.hasKey).toBe(true);
  });

  it("has nothing to redo for a backup without a coach or connections", async () => {
    const notice = await afterRestore();
    expect(notice).toMatchObject({ keys: [], healthFolder: false, mcp: false });
  });
});
