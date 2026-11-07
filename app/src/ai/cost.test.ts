import { describe, expect, it } from "vitest";
import { formatMonthly, monthlyEstimate } from "./cost";
import { knownPrice, PROVIDERS } from "./providers";

describe("monthlyEstimate", () => {
  it("matches the original app's Kimi K2 spend of a few dollars a month", () => {
    expect(monthlyEstimate({ input: 0.57, output: 2.3 })).toBeCloseTo(3.88, 2);
  });

  it("formats small and larger amounts", () => {
    expect(formatMonthly(0.7)).toBe("under $1");
    expect(formatMonthly(14.2)).toBe("about $14");
  });
});

describe("suggested models", () => {
  it("each provider with suggestions starts with exactly one pick, and cloud ones carry a price", () => {
    for (const p of PROVIDERS.filter((x) => x.suggested.length)) {
      expect(p.suggested.filter((s) => s.pick), p.kind).toHaveLength(1);
      if (!p.local) expect(p.suggested.every((s) => s.price), p.kind).toBe(true);
    }
  });

  it("knows list prices for direct keys, so the monthly limit can count them", () => {
    expect(knownPrice("anthropic", "claude-haiku-5-5")).toEqual({ input: 0.1, output: 0.5 });
    expect(knownPrice("openai", "some-other-model")).toBeUndefined();
  });
});
