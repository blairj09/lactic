// How the rider set up their coach: none, the built-in coach on a model they chose, or an AI app
// they already use, connected over MCP.

import { getSetting, setSetting } from "~/settings/store";
import type { ProviderKind } from "./providers";

export type CoachMode = "none" | "builtin" | "external";

export interface ModelChoice {
  model: string;
  /** Per million tokens, when the provider says (OpenRouter does). */
  price?: { input: number; output: number };
  /** From "Test this model". */
  tested?: { at: string; ok: boolean; tools: boolean; seconds: number; note?: string };
}

export interface CoachSetup {
  mode: CoachMode;
  provider: { kind: ProviderKind; baseUrl: string; hasKey: boolean } | null;
  chat: ModelChoice | null;
  /** For reading images; the chat model when it can see. */
  vision?: ModelChoice | null;
  /** Monthly spend limit in US dollars for cloud models; null for none. */
  monthlyCapUsd: number | null;
}

export const SECRET_AI = "ai";

const KEY = "coach.setup";
export const DEFAULT_SETUP: CoachSetup = { mode: "none", provider: null, chat: null, vision: null, monthlyCapUsd: 10 };

export async function coachSetup(): Promise<CoachSetup> {
  return { ...DEFAULT_SETUP, ...(await getSetting<Partial<CoachSetup>>(KEY, {})) };
}

export async function saveCoachSetup(setup: CoachSetup) {
  await setSetting(KEY, setup);
  const { applyEnv } = await import("~/boot/env");
  await applyEnv();
}
