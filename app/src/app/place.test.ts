import { describe, expect, it } from "vitest";
import { PlaceMemory, tabOf } from "./place";

describe("tabOf", () => {
  it("puts each path under its screen", () => {
    expect(tabOf("/")).toBe("/");
    expect(tabOf("/plan")).toBe("/plan");
    expect(tabOf("/progress/vo2max")).toBe("/progress");
    expect(tabOf("/rides/abc")).toBe("/progress");
    expect(tabOf("/rides/abc/race")).toBe("/progress");
    expect(tabOf("/health/sleep")).toBe("/health");
    expect(tabOf("/settings")).toBeNull();
    expect(tabOf("/ride")).toBeNull();
    expect(tabOf("/planner")).toBeNull();
  });
});

describe("PlaceMemory", () => {
  it("returns to the ride you had open in Progress after Settings", () => {
    const m = new PlaceMemory();
    m.visit("/progress?from=2026-08-01&to=2026-11-01");
    m.visit("/rides/abc");
    m.visit("/settings");
    expect(m.hrefFor("/progress", "/settings")).toBe("/rides/abc");
    expect(m.hrefFor("/plan", "/settings")).toBe("/plan");
  });

  it("goes to a screen's top level when you're already in it", () => {
    const m = new PlaceMemory();
    m.visit("/rides/abc");
    expect(m.hrefFor("/progress", "/rides/abc")).toBe("/progress");
  });

  it("keeps the query that was open", () => {
    const m = new PlaceMemory();
    m.visit("/progress?from=2026-01-01&to=2026-11-01&compare=lastYear");
    m.visit("/health");
    expect(m.hrefFor("/progress", "/health")).toBe("/progress?from=2026-01-01&to=2026-11-01&compare=lastYear");
  });

  it("remembers scroll per place", () => {
    const m = new PlaceMemory();
    m.saveScroll("/progress", 820.4);
    m.saveScroll("/rides/abc", 0);
    expect(m.scrollFor("/progress")).toBe(820);
    expect(m.scrollFor("/rides/abc")).toBe(0);
    expect(m.scrollFor("/plan")).toBe(0);
  });
});
