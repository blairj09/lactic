import { describe, expect, it } from "vitest";
import { checkQuery, citations, SEARCH_FEE_USD } from "./web-search";
import { webSearchOn, webSearchSupported, DEFAULT_SETUP, type CoachSetup } from "./settings";

describe("web search", () => {
  it("checks the query", () => {
    expect(checkQuery("  best   power meter  ")).toBe("best power meter");
    expect(() => checkQuery("")).toThrow();
    expect(() => checkQuery("x".repeat(201))).toThrow();
  });

  it("reads OpenRouter's url citations", () => {
    const message = {
      content: "…",
      annotations: [
        { type: "url_citation", url_citation: { url: "https://www.dcrainmaker.com/a", title: "Review", start_index: 0, end_index: 3 } },
        { type: "file", file: {} },
        { type: "url_citation", url_citation: { url: "ftp://x.com/" } },
      ],
    };
    expect(citations(message)).toEqual([{ url: "https://www.dcrainmaker.com/a", title: "Review" }]);
    expect(citations({ content: "no annotations" })).toEqual([]);
  });

  it("counts the search engine's fee", () => {
    expect(SEARCH_FEE_USD).toBeCloseTo(0.007);
  });

  it("is only on when turned on, on OpenRouter, with a model", () => {
    const base: CoachSetup = { ...DEFAULT_SETUP, mode: "builtin", provider: { kind: "openrouter", baseUrl: "https://openrouter.ai/api/v1", hasKey: true }, chat: { model: "anthropic/claude-haiku-5.5" } };
    expect(webSearchOn(base)).toBe(false);
    expect(webSearchOn({ ...base, webSearch: true })).toBe(true);
    expect(webSearchOn({ ...base, webSearch: true, mode: "external" })).toBe(false);
    const anthropic = { ...base, webSearch: true, provider: { kind: "anthropic" as const, baseUrl: "", hasKey: true } };
    expect(webSearchSupported(anthropic)).toBe(false);
    expect(webSearchOn(anthropic)).toBe(false);
  });
});
