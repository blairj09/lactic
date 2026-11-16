import { describe, expect, it } from "vitest";
import { stableId } from "./ids";

describe("stableId", () => {
  it("is the same for the same parts and differs otherwise", async () => {
    const a = await stableId("analysis", "zones", "ride-1");
    expect(a).toBe(await stableId("analysis", "zones", "ride-1"));
    expect(a).not.toBe(await stableId("analysis", "zones", "ride-2"));
    expect(a).not.toBe(await stableId("analysis", "zonesride-1"));
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});
