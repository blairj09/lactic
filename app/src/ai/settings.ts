// How the rider set up their coach: none, the built-in coach on a model they chose, or an AI app
// they already use, connected over MCP.

import { getSetting, setSetting } from "~/settings/store";
import { preset, type ProviderKind } from "./providers";

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
  /** `signedIn`: the key came from Sign in with OpenRouter rather than being pasted. */
  provider: { kind: ProviderKind; baseUrl: string; hasKey: boolean; signedIn?: boolean } | null;
  chat: ModelChoice | null;
  /** For reading images; the chat model when it can see. */
  vision?: ModelChoice | null;
  /** Monthly spend limit in US dollars for cloud models; null for none. */
  monthlyCapUsd: number | null;
  /** With the built-in coach: AI apps can still connect over MCP too. */
  alongside?: boolean;
  /** The built-in coach may search the web (OpenRouter only, see web-search.ts). Off unless the rider turns it on. */
  webSearch?: boolean;
}

/** Whether AI apps can reach Lactic's MCP server with this setup. */
export const mcpOn = (s: Pick<CoachSetup, "mode" | "alongside">) => s.mode === "external" || (s.mode === "builtin" && Boolean(s.alongside));

export const SECRET_AI = "ai";

/**
 * Whether the built-in coach can run: chosen, with a model, and a key in the keychain unless the
 * provider needs none (local models, a custom server). Without one, Lactic acts as if the coach is
 * off rather than sending keyless requests the provider turns down.
 */
export function builtinReady(setup: CoachSetup, keySaved: boolean): boolean {
  if (setup.mode !== "builtin" || !setup.chat || !setup.provider) return false;
  const { kind, hasKey } = setup.provider;
  if (kind === "custom" || preset(kind).local) return true;
  return hasKey && keySaved;
}

/** Web search needs OpenRouter's web plugin; other providers' OpenAI-compatible APIs have no search. */
export const webSearchSupported = (setup: Pick<CoachSetup, "provider">) => setup.provider?.kind === "openrouter";

/** Whether the built-in coach is offered search_web: turned on, on OpenRouter, with a model. */
export const webSearchOn = (setup: CoachSetup) => setup.mode === "builtin" && Boolean(setup.webSearch) && webSearchSupported(setup) && Boolean(setup.chat?.model);

const KEY = "coach.setup";
export const DEFAULT_SETUP: CoachSetup = { mode: "none", provider: null, chat: null, vision: null, monthlyCapUsd: 10 };

export async function coachSetup(): Promise<CoachSetup> {
  return { ...DEFAULT_SETUP, ...(await getSetting<Partial<CoachSetup>>(KEY, {})) };
}

/** Whether the rider has picked a coach, No coach included: setup's coach step saves its choice. */
export async function coachChosen(): Promise<boolean> {
  return (await getSetting<unknown>(KEY, null)) !== null;
}

/** Setup's coach step starts on No coach; finishing it keeps that as the rider's choice. */
export async function keepCoachChoice() {
  if (!(await coachChosen())) await saveCoachSetup(await coachSetup());
}

export async function saveCoachSetup(setup: CoachSetup) {
  await setSetting(KEY, setup);
  const { applyEnv } = await import("~/boot/env");
  await applyEnv();
}
