import { describe, expect, it, vi } from "vitest";
import { BudgetReached, sampling, stallWatch } from "./client";

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

describe("stallWatch", () => {
  it("aborts a stream that goes quiet, not one that keeps sending", () => {
    vi.useFakeTimers();
    const watch = stallWatch(1000);
    vi.advanceTimersByTime(900);
    watch.alive();
    vi.advanceTimersByTime(900);
    expect(watch.signal.aborted).toBe(false);
    vi.advanceTimersByTime(200);
    expect(watch.signal.aborted).toBe(true);
    expect((watch.signal.reason as DOMException).name).toBe("TimeoutError");
    vi.useRealTimers();
  });

  it("caps a reply that never ends", () => {
    vi.useFakeTimers();
    const watch = stallWatch(1000);
    for (let i = 0; i < 400; i++) {
      vi.advanceTimersByTime(900);
      watch.alive();
    }
    expect(watch.signal.aborted).toBe(true);
    watch.stop();
    vi.useRealTimers();
  });
});
