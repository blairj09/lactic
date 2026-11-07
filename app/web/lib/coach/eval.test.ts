import { describe, expect, it } from "vitest";
import type { ChatMessage } from "./openrouter";
import { runScenario, SCENARIOS, ungroundedNumbers } from "./eval";

describe("coach eval", () => {
  it("flags numbers that aren't in the data, allowing for rounding", () => {
    const context = '{"ftp":250,"wattsPerKg":3.33,"stress":74.4,"form":-5}';
    expect(ungroundedNumbers("FTP 250 W, 3.33 W/kg, 74 TSS, form -5, 3 intervals on Oct 31 at 7:30, 2026-10-30.", context)).toEqual([]);
    expect(ungroundedNumbers("Aim for 265 W, about 3.5 W/kg and 1,006 W sprints.", context)).toEqual(["265", "3.5", "1,006"]);
  });

  it("scores a scenario from the tools called and the reply", async () => {
    const scenario = SCENARIOS.find((s) => s.name === "last ride")!;
    const replies: ChatMessage[] = [
      { role: "assistant", content: null, tool_calls: [{ id: "1", type: "function", function: { name: "get_rides", arguments: "{}" } }] },
      { role: "assistant", content: "Good one: 74 TSS at 215 W normalized." },
    ];
    const good = await runScenario(async () => replies.shift()!, scenario);
    expect(good).toMatchObject({ ok: true, tools: ["get_rides"] });

    const bad = await runScenario(async () => ({ role: "assistant", content: "Probably about 80 TSS." }), scenario);
    expect(bad.failures).toEqual(["didn't call get_rides or get_ride", "doesn't mention 74", "numbers not in the data: 80"]);
  });
});
