import { describe, expect, it } from "vitest";
import { parseTheme, themeScript } from "./theme";

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
});
