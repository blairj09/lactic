import { describe, expect, it } from "vitest";
import { FINISH_SETUP_DONE, markSetupDone, setupDone } from "./finish-setup";

describe("finish setup", () => {
  it("counts saved steps, and rides once there are any", () => {
    expect([...setupDone(["week", "nope"], { hasRides: false })]).toEqual([
      "week",
    ]);
    expect(setupDone([], { hasRides: true }).has("rides")).toBe(true);
  });

  it("ticks a step off once", async () => {
    const store = new Map<string, unknown>();
    const get = async <T>(k: string, f: T) =>
      store.has(k) ? (store.get(k) as T) : f;
    const set = async (k: string, v: unknown) => void store.set(k, v);
    await markSetupDone("coach", get, set);
    await markSetupDone("coach", get, set);
    expect(store.get(FINISH_SETUP_DONE)).toEqual(["coach"]);
  });
});
