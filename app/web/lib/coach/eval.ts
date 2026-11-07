// A small eval set for choosing the coach's model: fixed scenarios run against the real model, each
// checked for the tools it used, what it proposed or saved, and whether every number in its reply
// appears in what it was shown. Run with `npm run eval:coach` (needs OPENROUTER_API_KEY).

import { coachChat, morningBrief } from "./chat";
import type { ChatMessage, Complete } from "./openrouter";
import { data as baseData } from "./fixture";
import type { CoachData } from "./tools";

export interface Scenario {
  name: string;
  /** The athlete's message; none for the morning brief. */
  message?: string;
  data?: CoachData;
  /** At least one of these tools must be called. */
  usesAnyOf?: string[];
  expectProposal?: boolean;
  expectMemory?: boolean;
  /** Text the reply must contain (case-insensitive). */
  mentions?: string[];
}

const withRecovery: CoachData = {
  ...baseData,
  state: {
    ...baseData.state,
    recovery: { today: { hrv: 48, restingHeartRate: 52, sleepHours: 6.2, hrvKind: "rmssd" }, score: { score: 41, reasons: ["HRV below your normal", "Short sleep"] }, baselineDays: 14 },
  } as CoachData["state"],
  recoveryDays: [{ day: "2026-10-29", hrvMs: 48, hrvKind: "rmssd", restingHr: 52, sleepHours: 6.2 }],
};

export const SCENARIOS: Scenario[] = [
  { name: "last ride", message: "How did my last ride go?", usesAnyOf: ["get_rides", "get_ride"], mentions: ["74"] },
  { name: "power w/kg", message: "What's my best 20 minute power in watts per kilo?", usesAnyOf: ["get_power"], mentions: ["3.2"] },
  { name: "recovered?", message: "Am I recovered enough for today's workout?", data: withRecovery, mentions: ["41"] },
  { name: "travel next week", message: "I'm travelling for work from the 9th to the 13th of next month and won't have a bike.", usesAnyOf: ["propose_break"], expectProposal: true },
  { name: "can't ride Saturday", message: "I can't ride this Saturday. What should I do?", usesAnyOf: ["get_day_options", "propose_swap", "propose_day_change"], expectProposal: true },
  { name: "remembers a niggle", message: "Heads up, my left knee gets sore on rides over 3 hours.", usesAnyOf: ["remember"], expectMemory: true },
  { name: "morning brief", data: withRecovery },
];

export interface ScenarioResult {
  name: string;
  ok: boolean;
  failures: string[];
  seconds: number;
  reply: string;
  tools: string[];
}

/** Runs one scenario, recording what the model saw and called. */
export async function runScenario(complete: Complete, scenario: Scenario): Promise<ScenarioResult> {
  const data = scenario.data ?? baseData;
  let seen: ChatMessage[] = [];
  const tools: string[] = [];
  const recording: Complete = async (messages, t, onText) => {
    const reply = await complete(messages, t, onText);
    seen = [...messages, reply];
    for (const call of reply.tool_calls ?? []) tools.push(call.function.name);
    return reply;
  };
  const started = Date.now();
  const failures: string[] = [];
  let reply = "";
  try {
    if (scenario.message) {
      const answer = await coachChat(recording, data, [{ role: "user", content: scenario.message }]);
      reply = answer.message;
      if (scenario.expectProposal && !answer.proposals.length) failures.push("no plan change proposed");
      if (scenario.expectMemory && !answer.memory.some((m) => m.op === "add")) failures.push("nothing saved to memory");
    } else {
      reply = (await morningBrief(recording, data, [])).message;
    }
  } catch (e) {
    failures.push(`error: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (scenario.usesAnyOf && !scenario.usesAnyOf.some((t) => tools.includes(t))) failures.push(`didn't call ${scenario.usesAnyOf.join(" or ")}`);
  for (const text of scenario.mentions ?? []) if (!reply.toLowerCase().includes(text.toLowerCase())) failures.push(`doesn't mention ${text}`);
  const context = seen.filter((m) => m.role !== "assistant").map((m) => m.content ?? "").join("\n");
  const ungrounded = ungroundedNumbers(reply, context);
  if (ungrounded.length) failures.push(`numbers not in the data: ${ungrounded.join(", ")}`);
  return { name: scenario.name, ok: failures.length === 0, failures, seconds: (Date.now() - started) / 1000, reply, tools };
}

/**
 * Numbers in the reply that don't appear in what the model was shown, allowing for rounding. Dates,
 * times and small whole numbers (counts like "3 intervals") are skipped.
 */
export function ungroundedNumbers(reply: string, context: string): string[] {
  const known = (context.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
  const text = reply
    .replace(/\b\d{4}-\d\d-\d\d\b/g, " ")
    .replace(/\b\d{1,2}:\d\d\b/g, " ")
    .replace(/\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.? \d{1,2}\b/gi, " ");
  const found = text.match(/\d+(?:,\d{3})*(?:\.\d+)?/g) ?? [];
  return [
    ...new Set(
      found.filter((raw) => {
        const n = Number(raw.replace(/,/g, ""));
        if (Number.isInteger(n) && n <= 10) return false;
        const tolerance = raw.includes(".") ? 0.051 : 0.5;
        return !known.some((k) => Math.abs(Math.abs(k) - n) <= tolerance);
      }),
    ),
  ];
}
