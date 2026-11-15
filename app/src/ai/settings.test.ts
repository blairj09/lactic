import { describe, expect, it } from "vitest";
import { builtinReady, DEFAULT_SETUP, type CoachSetup } from "./settings";

const cloud: CoachSetup = { ...DEFAULT_SETUP, mode: "builtin", provider: { kind: "openrouter", baseUrl: "https://openrouter.ai/api/v1", hasKey: true }, chat: { model: "m" } };

describe("builtinReady", () => {
  it("needs the built-in mode and a model", () => {
    expect(builtinReady(cloud, true)).toBe(true);
    expect(builtinReady({ ...cloud, mode: "external" }, true)).toBe(false);
    expect(builtinReady({ ...cloud, mode: "none" }, true)).toBe(false);
    expect(builtinReady({ ...cloud, chat: null }, true)).toBe(false);
    expect(builtinReady({ ...cloud, provider: null }, true)).toBe(false);
  });

  it("needs a saved key for a cloud provider", () => {
    expect(builtinReady({ ...cloud, provider: { ...cloud.provider!, hasKey: false } }, false)).toBe(false);
    // Marked as saved but missing from this computer's keychain (a setup that came from another device).
    expect(builtinReady(cloud, false)).toBe(false);
  });

  it("needs no key for a local model or a custom server", () => {
    expect(builtinReady({ ...cloud, provider: { kind: "ollama", baseUrl: "http://localhost:11434/v1", hasKey: false } }, false)).toBe(true);
    expect(builtinReady({ ...cloud, provider: { kind: "custom", baseUrl: "http://x", hasKey: false } }, false)).toBe(true);
  });
});
