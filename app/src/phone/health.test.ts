// Rides go into Apple Health once, even when a Health wake and synced rides ask at the same time.
import { describe, expect, it, vi } from "vitest";

const saved: string[] = [];
let cleanups = 0;
vi.mock("./plugin", () => ({
  saveWorkout: async (w: { id: string }) => {
    // HealthKit takes a while to finish a workout with its samples.
    await new Promise((r) => setTimeout(r, 20));
    saved.push(w.id);
    return { saved: true, reason: null };
  },
  removeDuplicateWorkouts: async () => {
    cleanups++;
    return { removed: 1 };
  },
  ackPending: async () => {},
  authorizeHealth: async () => ({ granted: true }),
  phoneStatus: async () => ({}),
  readHealth: async () => ({}),
  takePending: async () => [],
}));
const settings = new Map<string, unknown>([["phone.health.writeSince", new Date(Date.now() - 86_400_000).toISOString()]]);
vi.mock("~/settings/store", () => ({
  getSetting: async (k: string, d: unknown) => (settings.has(k) ? settings.get(k) : d),
  setSetting: async (k: string, v: unknown) => void settings.set(k, v),
}));
const ride = { id: "ride-1", name: "Sweet spot", started_at: new Date(Date.now() - 3 * 3600_000).toISOString(), duration_seconds: 3600, distance_meters: null, average_power: 200 };
vi.mock("~/db/supabase-client", () => {
  const query = (rows: unknown) => {
    const q: Record<string, unknown> = {};
    for (const m of ["select", "gte", "is", "eq"]) q[m] = () => q;
    q.order = async () => ({ data: rows });
    q.maybeSingle = async () => ({ data: null });
    return q;
  };
  return { createClient: () => ({ from: (t: string) => query(t === "activities" ? [ride] : []) }) };
});
vi.mock("~/integrations/apple-health", () => ({ ingestHealth: async () => ({}), IPHONE_SETTING: "health.iphone", SOURCE_SETTING: "health.source" }));
vi.mock("~/shims/next-cache", () => ({ revalidatePath: () => {} }));
vi.mock("~/support/log", () => ({ logEvent: () => {} }));

import { writeRides } from "./health";

describe("writeRides", () => {
  it("saves a ride once when asked twice at the same time", async () => {
    await Promise.all([writeRides(), writeRides(), writeRides()]);
    await writeRides();
    expect(saved).toEqual(["ride-1"]);
  });

  it("removes the duplicates older versions left in Health once", () => {
    expect(cleanups).toBe(1);
  });
});
