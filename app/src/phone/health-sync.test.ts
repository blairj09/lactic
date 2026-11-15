// A Health read that never answers, or a background read that can't be imported, mustn't stop
// every read after it.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let read: () => Promise<Record<string, unknown>>;
let asks = 0;
let pending: { id: string; body: Record<string, unknown> }[] = [];
const acked: string[] = [];
vi.mock("./plugin", () => ({
  saveWorkout: async () => ({ saved: true, reason: null }),
  saveWeighIn: async () => ({ saved: true, reason: null }),
  removeDuplicateWorkouts: async () => ({ removed: 0 }),
  ackPending: async (ids: string[]) => void acked.push(...ids),
  authorizeHealth: () => {
    asks++;
    return new Promise((resolve) => setTimeout(() => resolve({ granted: true }), 10));
  },
  phoneStatus: async () => ({ healthAvailable: true, healthAsked: true }),
  readHealth: () => read(),
  takePending: async () => pending,
}));
const settings = new Map<string, unknown>([
  ["phone.health.askedTypes", 2],
  ["phone.health.writeRides", false],
]);
vi.mock("~/settings/store", () => ({
  getSetting: async (k: string, d: unknown) => (settings.has(k) ? settings.get(k) : d),
  setSetting: async (k: string, v: unknown) => void settings.set(k, v),
}));
vi.mock("~/db/supabase-client", () => ({ createClient: () => ({}) }));
vi.mock("~/integrations/apple-health", () => ({
  ingestHealth: async (body: { night?: string; bad?: boolean }) => {
    if (body.bad) throw new Error("bad row");
    return { nights: 1, days: 1, latest: body.night ?? null };
  },
  IPHONE_SETTING: "health.iphone",
  SOURCE_SETTING: "health.source",
}));
vi.mock("~/shims/next-cache", () => ({ revalidatePath: () => {} }));
vi.mock("~/support/log", () => ({ logEvent: () => {} }));

import { askHealth, healthError, syncPhoneHealth } from "./health";

describe("askHealth", () => {
  it("shows one permission sheet at a time", async () => {
    asks = 0;
    const [a, b] = await Promise.all([askHealth(), askHealth()]);
    expect(a.granted && b.granted).toBe(true);
    expect(asks).toBe(1);
    await askHealth();
    expect(asks).toBe(2);
  });
});

describe("syncPhoneHealth", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("gives up on a read that never answers, and the next one goes through", async () => {
    read = () => new Promise(() => {});
    const stuck = syncPhoneHealth();
    await vi.advanceTimersByTimeAsync(130_000);
    expect(await stuck).toBeNull();
    expect(healthError()).toMatch(/didn't answer/);

    read = async () => ({ night: "2026-11-14" });
    expect(await syncPhoneHealth()).toBe("2026-11-14");
    expect(healthError()).toBeNull();
    expect((settings.get("health.iphone") as { latest: string }).latest).toBe("2026-11-14");
  });

  it("drops a background read that can't be imported instead of failing every read", async () => {
    read = async () => ({ night: "2026-11-15" });
    pending = [{ id: "bad", body: { bad: true } }];
    expect(await syncPhoneHealth()).toBe("2026-11-15");
    expect(acked).toEqual(["bad"]);
  });
});
