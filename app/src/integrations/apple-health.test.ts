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
