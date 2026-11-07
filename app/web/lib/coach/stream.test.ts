import { describe, expect, it } from "vitest";
import { StreamReader } from "./stream";

const event = (delta: unknown) => `data: ${JSON.stringify({ choices: [{ delta }] })}\n\n`;

describe("OpenRouter stream", () => {
  it("passes text through and joins it, across split chunks", () => {
    const seen: string[] = [];
    const reader = new StreamReader((d) => seen.push(d));
    const body = `: OPENROUTER PROCESSING\n\n${event({ content: "Hel" })}${event({ content: "lo" })}data: [DONE]\n\n`;
    reader.push(body.slice(0, 40));
    reader.push(body.slice(40));
    expect(seen).toEqual(["Hel", "lo"]);
    expect(reader.message()).toEqual({ role: "assistant", content: "Hello", tool_calls: undefined });
  });

  it("assembles tool calls from pieces", () => {
    const reader = new StreamReader();
    reader.push(event({ tool_calls: [{ index: 0, id: "c1", type: "function", function: { name: "get_rides", arguments: '{"li' } }] }));
    reader.push(event({ tool_calls: [{ index: 0, function: { arguments: 'mit":1}' } }] }));
    reader.push(event({ tool_calls: [{ index: 1, id: "c2", function: { name: "get_power", arguments: "{}" } }] }));
    expect(reader.message().tool_calls).toEqual([
      { id: "c1", type: "function", function: { name: "get_rides", arguments: '{"limit":1}' } },
      { id: "c2", type: "function", function: { name: "get_power", arguments: "{}" } },
    ]);
  });

  it("raises errors sent mid-stream", () => {
    expect(() => new StreamReader().push(`data: ${JSON.stringify({ error: { message: "Rate limited" } })}\n\n`)).toThrow(/Rate limited/);
  });
});
