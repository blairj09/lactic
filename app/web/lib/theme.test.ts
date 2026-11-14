import { describe, expect, it } from "vitest";
import { isHighContrast, parseContrast, parseTheme, themeScript } from "./theme";

describe("theme", () => {
  it("falls back to system for anything but light or dark", () => {
    expect(parseTheme("light")).toBe("light");
    expect(parseTheme("dark")).toBe("dark");
    expect(parseTheme(null)).toBe("system");
    expect(parseTheme("blue")).toBe("system");
  });

  it("inline script parses", () => {
    expect(() => new Function(themeScript)).not.toThrow();
  });

  it("falls back to system contrast for anything but standard or high", () => {
    expect(parseContrast("high")).toBe("high");
    expect(parseContrast("standard")).toBe("standard");
    expect(parseContrast(null)).toBe("system");
    expect(parseContrast("more")).toBe("system");
  });

  it("System follows the OS, High and Standard don't", () => {
    expect(isHighContrast("system", true)).toBe(true);
    expect(isHighContrast("system", false)).toBe(false);
    expect(isHighContrast("high", false)).toBe(true);
    expect(isHighContrast("standard", true)).toBe(false);
  });
});
