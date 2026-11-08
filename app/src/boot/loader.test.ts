import { describe, expect, it } from "vitest";
import { LOADER_MIN_MS, loaderHoldMs } from "./loader";

describe("loaderHoldMs", () => {
  it("holds a fast start until one full build", () => {
    expect(loaderHoldMs(200)).toBe(LOADER_MIN_MS - 200);
  });
  it("never adds time once startup took longer", () => {
    expect(loaderHoldMs(LOADER_MIN_MS)).toBe(0);
    expect(loaderHoldMs(4000)).toBe(0);
  });
});
