import { describe, expect, it } from "vitest";
import { reply, weekend } from "./coach";

const chatTools = [{ function: { name: "propose_swap" } }];

describe("demo coach", () => {
  it("proposes swapping the coming weekend when asked to move a ride", () => {
    const r = reply({ messages: [{ role: "user", content: "Can we move Saturday's ride to Sunday?" }], tools: chatTools });
    expect(r).toEqual({ call: { name: "propose_swap", arguments: expect.objectContaining({ date: weekend()[0], other_date: weekend()[1] }) } });
  });

  it("answers after the tool runs, and explains itself otherwise", () => {
    expect(reply({ messages: [{ role: "tool", content: '{"ok":true}' }], tools: chatTools })).toHaveProperty("content");
    expect(reply({ messages: [{ role: "user", content: "hello" }], tools: chatTools })).toEqual({ content: expect.stringContaining("demo") });
  });

  it("picks the weekend ahead, or next weekend's on a weekend", () => {
    expect(weekend(new Date(2026, 10, 4))).toEqual(["2026-11-07", "2026-11-08"]); // Wednesday
    expect(weekend(new Date(2026, 10, 7))).toEqual(["2026-11-14", "2026-11-15"]); // Saturday
    expect(weekend(new Date(2026, 10, 8))).toEqual(["2026-11-14", "2026-11-15"]); // Sunday
  });
});
