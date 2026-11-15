// Apple Health files into the local database, with a second file filling in what the first lacked.
import { beforeAll, describe, expect, it } from "vitest";
import { openSqlJs } from "~/db/sqljs";
import { setSql } from "~/db/sql";
import { migrate } from "~/db/migrate";
import { localClient } from "~/db/supabase-client";
import { ingestHealth } from "./apple-health";

beforeAll(async () => {
  const db = await openSqlJs({ persist: false });
  await migrate(db);
  setSql(db);
});

describe("Apple Health import", () => {
  it("stores nights and merges later files", async () => {
    const r = await ingestHealth({
      sleepStart: "2026-11-01T23:00:00-06:00\n2026-11-02T03:00:00-06:00\n2026-11-02T04:00:00-06:00",
      sleepEnd: "2026-11-02T03:00:00-06:00\n2026-11-02T04:00:00-06:00\n2026-11-02T06:00:00-06:00",
      sleepValue: "Core\nDeep\nREM",
      hrvDate: "2026-11-02T02:00:00-06:00\n2026-11-02T05:00:00-06:00",
      hrvValue: "40\n50",
      hrvKind: "sdnn",
    });
    expect(r.nights).toBe(1);
    await ingestHealth({ restingHrDate: "2026-11-02T00:00:00-06:00", restingHrValue: "51", sleepStart: "", sleepEnd: "", sleepValue: "" });
    const { data } = await localClient.from("recovery_days").select("*").eq("day", "2026-11-02").single();
    const row = data as { hrv_ms: number; resting_hr: number; sleep_hours: number; sleep_deep_hours: number };
    expect(row.hrv_ms).toBe(45);
    expect(row.sleep_hours).toBe(7);
    expect(row.sleep_deep_hours).toBe(1);
    expect(row.resting_hr).toBe(51);
  });

  it("stores daytime steps and VO2 max", async () => {
    const r = await ingestHealth({ stepsDate: "2026-11-02T10:00:00-06:00\n2026-11-02T15:00:00-06:00", stepsValue: "4000\n3000", vo2maxDate: "2026-11-02T12:00:00-06:00", vo2maxValue: "52.1" });
    expect(r.days).toBe(1);
    const { data } = await localClient.from("health_days").select("*").eq("day", "2026-11-02").single();
    expect(data).toMatchObject({ steps: 7000, vo2max: 52.1 });
  });
});

describe("weigh-ins from Apple Health", () => {
  it("adds other scales' weigh-ins once, skips ones Lactic already has, and updates the profile weight", async () => {
    const t = localClient.from("body_measurements");
    await t.insert({ measured_at: "2026-11-10T13:32:00Z", source: "body_pod", weight_kg: 75.4 });
    const body = {
      weightDate: ["2026-11-10T06:30:00-07:00", "2026-11-11T06:30:00-07:00"],
      weightValue: ["75.43", "75.1"],
      bodyFatDate: ["2026-11-11T06:30:00-07:00"],
      bodyFatValue: ["0.182"],
    };
    expect((await ingestHealth(body)).weighIns).toBe(1);
    expect((await ingestHealth(body)).weighIns).toBe(0);
    const { data } = await localClient.from("body_measurements").select("measured_at, source, weight_kg, body_fat_pct").order("measured_at");
    expect(data).toEqual([
      { measured_at: "2026-11-10T13:32:00.000Z", source: "body_pod", weight_kg: 75.4, body_fat_pct: null },
      { measured_at: "2026-11-11T13:30:00.000Z", source: "apple_health", weight_kg: 75.1, body_fat_pct: 18.2 },
    ]);
    const { data: settings } = await localClient.from("athlete_settings").select("weight_kg").maybeSingle();
    expect((settings as { weight_kg: number }).weight_kg).toBe(75.1);
  });
});
