import { afterEach, describe, expect, it, vi } from "vitest";
import { countTestDrive, testDrivePath } from "./count";

describe("test drive counts", () => {
  afterEach(() => {
    delete (globalThis as { va?: unknown }).va;
  });

  it("names each step by the gear it was ridden on", () => {
    expect(testDrivePath("connected", false)).toBe(
      "/test-drive/trainer/connected",
    );
    expect(testDrivePath("finished", true)).toBe(
      "/test-drive/simulated/finished",
    );
  });

  it("sends a pageview through the site's analytics", () => {
    const va = vi.fn();
    (globalThis as { va?: unknown }).va = va;
    countTestDrive("saved-fit", false);
    expect(va).toHaveBeenCalledWith("pageview", {
      route: "/test-drive/[gear]/[step]",
      path: "/test-drive/trainer/saved-fit",
    });
  });

  it("does nothing without analytics on the page", () => {
    expect(() => countTestDrive("started", true)).not.toThrow();
  });
});
