import { describe, expect, it } from "vitest";
import { BudgetReached, sampling } from "./client";

describe("BudgetReached", () => {
  it("says when the coach comes back", () => {
    expect(new BudgetReached(10, new Date(2026, 10, 7)).message).toContain("paused until December 1");
  });
});

describe("sampling", () => {
  it("keeps a low temperature for open and local models", () => {
    expect(sampling("ollama", "qwen3:8b", 800)).toEqual({ max_tokens: 800, temperature: 0.3 });
    expect(sampling("openrouter", "z-ai/glm-5.3", 800)).toEqual({ max_tokens: 800, temperature: 0.3 });
  });

  it("gives thinking models room and no temperature", () => {
    expect(sampling("anthropic", "claude-haiku-5-5", 800)).toEqual({ max_tokens: 4800 });
    expect(sampling("openrouter", "anthropic/claude-sonnet-5.5", 800)).toEqual({ max_tokens: 4800 });
    expect(sampling("openai", "gpt-6-luna", 800)).toEqual({ max_completion_tokens: 4800 });
  });
});
