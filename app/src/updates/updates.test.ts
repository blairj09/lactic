import { describe, expect, it } from "vitest";
import { parseNotes } from "./updates";

describe("parseNotes", () => {
  it("keeps one line per change, without Markdown", () => {
    expect(parseNotes("- Today: an **Indoors / Outside** switch\n* Check for [updates](https://x.y) on start\n\nnot a change")).toEqual(["Today: an Indoors / Outside switch", "Check for updates on start"]);
    expect(parseNotes(undefined)).toEqual([]);
  });
});
