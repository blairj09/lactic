import { describe, expect, it } from "vitest";
import { coachChat, titleFrom } from "./chat";
import type { ChatMessage } from "./openrouter";
import { data } from "./fixture";
import { DEFAULT_PERSONA, personaPrompt, toPersona } from "./persona";

describe("persona", () => {
  it("falls back to the defaults for missing or unknown values", () => {
    expect(toPersona(null)).toEqual(DEFAULT_PERSONA);
    expect(toPersona({ name: "  ", tone: "shouty", detail: "thorough", instructions: " Use km. " })).toEqual({ name: "Coach", tone: "direct", detail: "thorough", instructions: "Use km." });
  });

  it("puts the name, tone, detail and instructions into the prompt, keeping the rule about numbers", () => {
    const prompt = personaPrompt({ name: "Sam", tone: "encouraging", detail: "brief", instructions: "Use kilometres." });
    expect(prompt).toContain("Your name is Sam.");
    expect(prompt).toContain("warm and encouraging");
    expect(prompt).toContain("two or three sentences");
    expect(prompt).toContain("Use kilometres.");
    expect(prompt).toContain("every number still comes from the status and tools");
    expect(personaPrompt(DEFAULT_PERSONA)).not.toContain("instructions for you");
  });

  it("goes into the chat coach's system prompt", async () => {
    const seen: ChatMessage[][] = [];
    const persona = { name: "Sam", tone: "analytical" as const, detail: "thorough" as const, instructions: "" };
    await coachChat(async (m) => (seen.push([...m]), { role: "assistant", content: "Hi." }), { ...data, persona }, [{ role: "user", content: "hi" }]);
    expect(seen[0][0].content).toContain("Your name is Sam.");
    expect(seen[0][0].content).toContain("Lead with the data");
  });
});

describe("titleFrom", () => {
  it("makes one short line from the first message", () => {
    expect(titleFrom("How did\n\nmy ride   go?")).toBe("How did my ride go?");
    const long = titleFrom("a".repeat(200));
    expect(long.length).toBeLessThanOrEqual(80);
    expect(long.endsWith("…")).toBe(true);
  });
});
