// The export: a ride's FIT file reads back, and the zip holds every ride, the CSV and the tables
// without any key.
import { beforeAll, describe, expect, it } from "vitest";
import { strFromU8, unzipSync } from "fflate";

const store = new Map<string, string>();
Object.assign(globalThis, {
  localStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) },
  window: Object.assign(new EventTarget(), { dispatchEvent: () => true }),
});

const { openSqlJs } = await import("~/db/sqljs");
const { setSql } = await import("~/db/sql");
const { migrate } = await import("~/db/migrate");
const { localClient } = await import("~/db/supabase-client");
const { decodeFit } = await import("@/lib/fit/decode");
const { exportEverything, rideFit, safeName } = await import("./export");

const ID = "11111111-1111-4111-8111-111111111111";

beforeAll(async () => {
  setSql(await openSqlJs({ persist: false }));
  const { sql } = await import("~/db/sql");
  await migrate(sql());
  await localClient.from("activities").insert({ id: ID, source: "app", name: "Sweet spot / 3x10", started_at: "2026-11-01T14:00:00Z", duration_seconds: 20, average_power: 210, training_stress: 1 });
  await localClient.from("activity_streams").insert({ activity_id: ID, step_seconds: 5, watts: [200, 210, 220, 210], heart_rate: [130, 132, 134, 135], cadence: [90, 90, 90, 90] });
  await localClient.from("activities").insert({ source: "intervals", name: "No samples", started_at: "2026-10-30T14:00:00Z", duration_seconds: 3600 });
  await localClient.from("intervals_connections").upsert({ user_id: "local", athlete_id: "i1", api_key: "secretkey12345", connected_at: new Date().toISOString() }, { onConflict: "user_id" });
});

describe("export", () => {
  it("writes one ride as a FIT file at its stored resolution", async () => {
    const file = await rideFit(ID);
    expect(file?.name).toBe("2026-11-01 Sweet spot 3x10.fit");
    const fit = decodeFit(file!.bytes);
    expect(fit.records).toHaveLength(4);
    expect(fit.totalTimerSeconds).toBe(20);
    expect(fit.records[3].power).toBe(210);
  });

  it("zips every ride with samples, a CSV of all rides and every table, without keys", async () => {
    const files = unzipSync(await exportEverything());
    expect(Object.keys(files).filter((f) => f.startsWith("rides/"))).toEqual(["rides/2026-11-01 Sweet spot 3x10.fit"]);
    const csv = strFromU8(files["rides.csv"]).trim().split("\n");
    expect(csv).toHaveLength(3);
    expect(csv[1]).toContain("No samples");
    const streams = JSON.parse(strFromU8(files["tables/activity_streams.json"]));
    expect(streams[0].watts).toEqual([200, 210, 220, 210]);
    expect(files["tables/ingest_tokens.json"]).toBeUndefined();
    expect(strFromU8(files["tables/intervals_connections.json"])).not.toContain("secretkey12345");
    expect(files["README.txt"]).toBeDefined();
  });

  it("makes names safe for any file system", () => {
    expect(safeName('a/b:c*?"<>|d')).toBe("a b c d");
    expect(safeName("   ")).toBe("Ride");
  });
});
