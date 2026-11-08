// Runs one scenario against a model through the coach's own code (chat, brief or weekly planning),
// recording every tool call, then scores it: the scenario's checks plus checks every answer gets.

import { coachChat, morningBrief, planWeek } from "@shared/coach/chat";
import type { ChatMessage, Complete } from "@shared/coach/openrouter";
import { keyDays } from "./athlete";
import { withApp } from "./app";
import { grounded, toolErrorsAtMost } from "./checks";
import type { Check, Scenario, Transcript } from "./types";

/** Checks every scenario gets: numbers come from the data, and tools are called correctly. */
export const ALWAYS: Check[] = [grounded, toolErrorsAtMost(2)];

/** Runs the scenario through the coach and returns what happened. Never throws. */
export async function transcribe(complete: Complete, scenario: Scenario): Promise<Transcript> {
  const data = scenario.data();
  let seen: ChatMessage[] = [];
  const recording: Complete = async (messages, tools, onText) => {
    const reply = await complete(messages, tools, onText);
    seen = [...messages, reply];
    return reply;
  };
  const t: Transcript = { reply: "", calls: [], proposals: [], memory: [], picks: [], context: "" };
  try {
    const answer = await withApp(scenario.app ?? {}, () => {
      const kind = scenario.kind ?? "chat";
      if (kind === "brief") return morningBrief(recording, data, scenario.history ?? []);
      if (kind === "week") return planWeek(recording, data, keyDays(data));
      return coachChat(recording, data, [...(scenario.history ?? []), { role: "user", content: scenario.message ?? "" }], "", {}, scenario.page);
    });
    Object.assign(t, { reply: answer.message, proposals: answer.proposals, memory: answer.memory, picks: answer.picks, today: answer.today, feedback: answer.feedback });
  } catch (e) {
    t.error = e instanceof Error ? e.message : String(e);
  }
  // Pair each call with its result from the conversation the model saw last.
  const results = new Map(seen.filter((m) => m.role === "tool").map((m) => [m.tool_call_id, m.content ?? ""]));
  for (const m of seen) {
    for (const call of m.tool_calls ?? []) {
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(call.function.arguments || "{}");
      } catch {
        args = { unparsed: call.function.arguments };
      }
      t.calls.push({ name: call.function.name, args, result: results.get(call.id) ?? "" });
    }
  }
  t.context = seen
    .filter((m) => m.role !== "assistant")
    .map((m) => m.content ?? "")
    .join("\n");
  return t;
}

/** The scenario's failures: its own checks and the ones every answer gets. */
export function score(scenario: Scenario, t: Transcript): string[] {
  if (t.error) return [`error: ${t.error}`];
  const data = scenario.data();
  return [...scenario.checks, ...ALWAYS].map((check) => check(t, data)).filter((f): f is string => Boolean(f));
}
