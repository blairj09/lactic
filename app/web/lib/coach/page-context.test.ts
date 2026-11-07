import { describe, expect, it } from "vitest";
import { coachChat } from "./chat";
import type { ChatMessage } from "./openrouter";
import { data } from "./fixture";
import { describePage } from "./page-context";

describe("describePage", () => {
  it("names the page and what it shows", () => {
    expect(describePage("/")).toContain("Today");
    expect(describePage("/plan/")).toContain("Plan");
    expect(describePage("/ride", "?day=2026-11-02")).toContain("planned session for 2026-11-02");
  });

  it("reads the Progress range and comparison", () => {
    const line = describePage("/progress", "?from=2026-08-01&to=2026-10-29&compare=lastYear");
    expect(line).toContain("2026-08-01 to 2026-10-29");
    expect(line).toContain("a year earlier");
    expect(describePage("/progress")).toContain("last 3 months");
  });

  it("ignores unknown pages and malformed dates", () => {
    expect(describePage("/somewhere")).toBeNull();
    expect(describePage("/ride", "?day=tomorrow")).not.toContain("tomorrow");
  });

  it("goes into the chat coach's prompt", async () => {
    const seen: ChatMessage[][] = [];
    await coachChat(async (m) => (seen.push([...m]), { role: "assistant", content: "Looks good." }), data, [{ role: "user", content: "How's this range?" }], "", {}, describePage("/progress"));
    expect(seen[0][0].content).toContain("Progress: fitness, fatigue and form, power curve");
  });
});
