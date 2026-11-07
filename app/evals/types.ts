import type { Proposal } from "@shared/coach/changes";
import type { ChatTurn, ChatReply } from "@shared/coach/chat";
import type { CoachData } from "@shared/coach/tools";
import type { OptionId } from "@shared/engine/checkin";
import type { AppState } from "./app";
import type { Usage } from "./models";

export const CATEGORIES = {
  plan: "Plan changes",
  recovery: "Recovery advice",
  workouts: "Rule-based workouts",
  troubleshooting: "App troubleshooting",
  safety: "Safety",
  tools: "Tool use and grounding",
} as const;
export type Category = keyof typeof CATEGORIES;

/** One tool call and what it returned. */
export interface ToolCall {
  name: string;
  args: Record<string, unknown>;
  result: string;
}

/** Everything a run produced, for the checks and the judge. */
export interface Transcript {
  reply: string;
  calls: ToolCall[];
  proposals: Proposal[];
  memory: ChatReply["memory"];
  picks: ChatReply["picks"];
  today?: OptionId;
  /** What the model was shown: system prompt, messages and tool results. */
  context: string;
  /** The run threw instead of answering. */
  error?: string;
}

/** A deterministic check: null when it passes, else what went wrong. */
export type Check = (t: Transcript, data: CoachData) => string | null;

export interface Scenario {
  id: string;
  category: Category;
  /** What it tests, in a line. */
  title: string;
  /** chat (default), the morning brief, or the weekly planning run. */
  kind?: "chat" | "brief" | "week";
  /** The athlete's message (chat). */
  message?: string;
  /** Earlier turns before the message. */
  history?: ChatTurn[];
  /** The athlete and their data; built once per run. */
  data: () => CoachData;
  /** The desktop shell's state, for app tools. Healthy when left out. */
  app?: AppState;
  /** The page the athlete is on (page-context.ts text). */
  page?: string;
  checks: Check[];
  /** What a great answer does, for the judge. */
  rubric: string;
  /** Critical scenarios: failing one is worse than failing others (the report counts them apart). */
  critical?: boolean;
}

export interface JudgeVerdict {
  /** 1 to 5 each. */
  scores: { coaching: number; grounding: number; safety: number; appRules: number; communication: number };
  pass: boolean;
  notes: string;
}

export interface RunResult {
  scenario: string;
  category: Category;
  critical: boolean;
  model: string;
  repeat: number;
  failures: string[];
  checksPassed: boolean;
  judge: JudgeVerdict | null;
  judgeError?: string;
  /** Checks pass and, when judged, the judge passes it. */
  pass: boolean;
  seconds: number;
  usage: Usage;
  judgeUsage: Usage | null;
  toolErrors: number;
  transcript: Omit<Transcript, "context">;
}
