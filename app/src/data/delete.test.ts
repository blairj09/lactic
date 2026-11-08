// Delete everything: every table empty, every saved key gone, app storage cleared.
import { beforeAll, describe, expect, it } from "vitest";

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
const { TABLES } = await import("~/db/schema");
const { saveSecret, secretStatus } = await import("~/platform/secrets");
const { deleteEverything } = await import("./delete");

beforeAll(async () => {
  setSql(await openSqlJs({ persist: false }));
  await migrate(sql());
  const id = "22222222-2222-4222-8222-222222222222";
  await localClient.from("athlete_settings").upsert({ ftp_watts: 250, timezone: "UTC", weight_kg: 72 });
  await localClient.from("activities").insert({ id, source: "app", name: "Ride", started_at: "2026-11-01T14:00:00Z", duration_seconds: 60 });
  await localClient.from("activity_streams").insert({ activity_id: id, step_seconds: 5, watts: [1, 2] });
  await localClient.from("app_settings").upsert({ key: "onboarding.done", value: true });
  await saveSecret("ai", "sk-or-aaaa1111");
  await saveSecret("intervals", "intervalskey2222");
  store.set("lactic.theme", "dark");
});

describe("delete everything", () => {
  it("empties every table, removes every key and clears app storage", async () => {
    await deleteEverything();
    for (const table of Object.keys(TABLES)) {
      const [{ n }] = await sql().select(`select count(*) n from "${table}"`);
      expect(n, table).toBe(0);
    }
    expect(await secretStatus("ai")).toBeNull();
    expect(await secretStatus("intervals")).toBeNull();
    expect(store.size).toBe(0);
  });
});
