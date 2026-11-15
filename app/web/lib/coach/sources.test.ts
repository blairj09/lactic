import { describe, expect, it } from "vitest";
import { cleanSources, siteOf, sourcesOf } from "./sources";

describe("cleanSources", () => {
  it("keeps http(s) links once each, with titles", () => {
    const out = cleanSources([
      { url: "https://www.dcrainmaker.com/2026/power.html#top", title: "  Power meter  guide " },
      { url: "https://www.dcrainmaker.com/2026/power.html", title: "dupe" },
      { url: "javascript:alert(1)", title: "bad" },
      { url: "file:///etc/passwd" },
      { url: "not a url" },
      { url: "http://favero.com/" },
      null,
      42,
    ]);
    expect(out).toEqual([
      { url: "https://www.dcrainmaker.com/2026/power.html", title: "Power meter guide" },
      { url: "http://favero.com/", title: "favero.com" },
    ]);
  });

  it("keeps at most six", () => {
    expect(cleanSources(Array.from({ length: 10 }, (_, i) => ({ url: `https://a${i}.com/` })))).toHaveLength(6);
  });

  it("reads saved meta and ignores junk", () => {
    expect(sourcesOf({ sources: "x" })).toEqual([]);
    expect(sourcesOf(undefined)).toEqual([]);
    expect(siteOf("https://www.bikeradar.com/x")).toBe("bikeradar.com");
  });
});
