import { describe, expect, it } from "vitest";
import { matches, sectionFor } from "./sections";

describe("sectionFor", () => {
  it("opens sections by id and by the anchors other screens already link to", () => {
    expect(sectionFor("profile")).toBe("profile");
    expect(sectionFor("#connections")).toBe("connections");
    expect(sectionFor("coach-settings")).toBe("coach");
    expect(sectionFor("gear")).toBe("devices");
    expect(sectionFor("about")).toBe("help");
  });
  it("falls back to the menu for nothing or something unknown", () => {
    expect(sectionFor("")).toBeNull();
    expect(sectionFor(null)).toBeNull();
    expect(sectionFor("nope")).toBeNull();
  });
});

describe("matches", () => {
  const head = { section: "devices" as const, text: "Free ride Ride with Zwift, Rouvy or any app, your fields on top" };
  it("needs every word, in any order and case", () => {
    expect(matches(head, "zwift")).toBe(true);
    expect(matches(head, "ROUVY fields")).toBe(true);
    expect(matches(head, "zwift garmin")).toBe(false);
  });
  it("counts the section's name", () => {
    expect(matches(head, "trainer zwift")).toBe(true);
  });
  it("ignores an empty query and accents", () => {
    expect(matches(head, "  ")).toBe(false);
    expect(matches({ section: "profile", text: "Café" }, "cafe")).toBe(true);
  });
});
