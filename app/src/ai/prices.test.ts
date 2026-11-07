import { describe, expect, it } from "vitest";
import { knownPrice } from "./prices";

describe("known prices", () => {
  it("matches a model's family, dated versions included, longest name first", () => {
    expect(knownPrice("anthropic", "claude-haiku-4-5-20251001")).toEqual({ input: 1, output: 5 });
    expect(knownPrice("openai", "gpt-5-mini")).toEqual({ input: 0.25, output: 2 });
    expect(knownPrice("openai", "gpt-5")).toEqual({ input: 1.25, output: 10 });
    expect(knownPrice("google", "models/gemini-2.5-flash-lite")).toEqual({ input: 0.1, output: 0.4 });
  });

  it("knows nothing about other models or providers", () => {
    expect(knownPrice("openai", "gpt-5o")).toBeNull();
    expect(knownPrice("custom", "llama-3")).toBeNull();
  });
});
