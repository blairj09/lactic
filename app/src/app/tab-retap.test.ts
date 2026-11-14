import { describe, expect, it, vi } from "vitest";
import { retap, scrollToTop } from "./tab-retap";

const at = (pathname: string, search = "", riding = false) => ({ pathname, search, riding });

describe("retap", () => {
  it("leaves taps on other tabs to the link", () => {
    expect(retap({ href: "/plan", current: "/", ...at("/") })).toBe("none");
  });
  it("scrolls to the top on the tab's own page", () => {
    expect(retap({ href: "/", current: "/", ...at("/") })).toBe("top");
    expect(retap({ href: "/plan", current: "/plan", ...at("/plan") })).toBe("top");
  });
  it("goes back to the tab's page from a page inside it", () => {
    expect(retap({ href: "/plan", current: "/plan", ...at("/plan", "?tab=workouts") })).toBe("root");
    expect(retap({ href: "/plan", current: "/plan", ...at("/plan/events/abc") })).toBe("root");
    expect(retap({ href: "/progress", current: "/progress", ...at("/rides/r1") })).toBe("root");
    expect(retap({ href: "/health", current: "/health", ...at("/health/sleep") })).toBe("root");
  });
  it("does nothing mid-ride", () => {
    expect(retap({ href: "/ride", current: "/ride", ...at("/ride", "", true) })).toBe("none");
    expect(retap({ href: "/", current: "/", ...at("/", "", true) })).toBe("none");
  });
});

describe("scrollToTop", () => {
  const win = (reduce: boolean) => ({ scrollTo: vi.fn(), matchMedia: vi.fn(() => ({ matches: reduce }) as unknown as MediaQueryList) });
  it("glides up", () => {
    const w = win(false);
    scrollToTop(w as never);
    expect(w.scrollTo).toHaveBeenCalledWith({ top: 0, behavior: "smooth" });
  });
  it("jumps with reduced motion", () => {
    const w = win(true);
    scrollToTop(w as never);
    expect(w.scrollTo).toHaveBeenCalledWith({ top: 0, behavior: "auto" });
  });
});
