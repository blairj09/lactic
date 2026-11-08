// The intervals.icu key lives in the keychain only: disconnecting removes it, and a key an older
// Settings screen left in the database moves to the keychain. Browser storage stands in for the keychain.
import { beforeAll, describe, expect, it } from "vitest";

const store = new Map<string, string>();
Object.assign(globalThis, {
  localStorage: {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
  },
  window: Object.assign(new EventTarget(), { dispatchEvent: () => true }),
});

const { openSqlJs } = await import("~/db/sqljs");
const { setSql } = await import("~/db/sql");
const { migrate } = await import("~/db/migrate");
const { localClient } = await import("~/db/supabase-client");
const { secretStatus } = await import("~/platform/secrets");
const { disconnectIntervals } = await import("@/app/actions");
const { moveIntervalsKeyToKeychain } = await import("./background");

beforeAll(async () => {
  const db = await openSqlJs({ persist: false });
  await migrate(db);
  setSql(db);
});

const row = async () => (await localClient.from("intervals_connections").select("*").maybeSingle()).data as { api_key: string } | null;

describe("intervals.icu key", () => {
  it("moves a key stored in the database into the keychain", async () => {
    await localClient.from("intervals_connections").upsert({ user_id: "local", athlete_id: "i1", api_key: "abcdefghij1234", connected_at: new Date().toISOString() }, { onConflict: "user_id" });
    await moveIntervalsKeyToKeychain();
    expect((await row())?.api_key).toBe("keychain:intervals");
    expect(await secretStatus("intervals")).toBe("…1234");
  });

  it("removes the key when intervals.icu is disconnected", async () => {
    const result = await disconnectIntervals();
    expect(result.ok).toBe(true);
    expect(await row()).toBeNull();
    expect(await secretStatus("intervals")).toBeNull();
  });
});
