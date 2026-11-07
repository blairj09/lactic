// The web app's own loaders, run unchanged on the local database.
import { beforeAll, describe, expect, it } from "vitest";
import { openSqlJs } from "./sqljs";
import { setSql } from "./sql";
import { migrate } from "./migrate";
import { localClient } from "./supabase-client";
import { loadTrainingState } from "@shared/training";

beforeAll(async () => {
  const db = await openSqlJs({ persist: false });
  await migrate(db);
  setSql(db);
  await localClient.from("athlete_settings").upsert({ ftp_watts: 250, timezone: "America/Los_Angeles", weight_kg: 72 });
  const start = Date.now() - 3 * 86_400_000;
  await localClient.from("activities").insert({
    source: "fit",
    external_id: "x",
    name: "Endurance",
    started_at: new Date(start).toISOString(),
    duration_seconds: 3600,
    average_power: 180,
    normalized_power: 190,
    training_stress: 58,
    intensity_factor: 0.76,
    stress_method: "power",
    power_curve: { "5": 600, "60": 350, "300": 280, "1200": 250 },
  });
});

describe("web loaders on SQLite", () => {
  it("builds the training state and plan", async () => {
    const state = await loadTrainingState(localClient as never);
    expect(state.athlete.ftp).toBe(250);
    expect(state.rides).toHaveLength(1);
    expect(state.fitness).toBeGreaterThan(0);
    expect(state.plan.weeks.length).toBeGreaterThan(0);
  });
});
