// The models under test, on any provider the app supports. A model is written `provider:model`,
// e.g. `openrouter:moonshotai/kimi-k2`, `anthropic:claude-haiku-4-5`, `ollama:qwen3:8b`. Calls go
// to the provider's OpenAI-compatible chat completions with the same settings as the app's own
// client (src/ai/client.ts), so a model scores here as it would behave in Lactic.

import { preset, PROVIDERS, type ProviderKind } from "~/ai/providers";
import type { ChatMessage, Complete } from "@shared/coach/openrouter";

export interface ModelSpec {
  /** As written on the command line. */
  id: string;
  provider: ProviderKind;
  model: string;
  baseUrl: string;
  local: boolean;
}

/** Keys come from the environment, never from files in the repo. */
export const KEY_ENV: Partial<Record<ProviderKind, string[]>> = {
  openrouter: ["OPENROUTER_API_KEY"],
  anthropic: ["ANTHROPIC_API_KEY"],
  openai: ["OPENAI_API_KEY"],
  google: ["GEMINI_API_KEY", "GOOGLE_API_KEY"],
  custom: ["EVAL_API_KEY"],
};

export function parseModel(id: string, env: Record<string, string | undefined> = process.env): ModelSpec {
  const at = id.indexOf(":");
  const kind = id.slice(0, at) as ProviderKind;
  const model = id.slice(at + 1);
  if (at < 1 || !model || !PROVIDERS.some((p) => p.kind === kind)) {
    throw new Error(`"${id}" should be provider:model, with provider one of ${PROVIDERS.map((p) => p.kind).join(", ")}`);
  }
  const info = preset(kind);
  const baseUrl = (kind === "custom" ? (env.EVAL_BASE_URL ?? "") : (env[`EVAL_${kind.toUpperCase()}_URL`] ?? info.baseUrl)).replace(/\/+$/, "");
  if (!baseUrl) throw new Error(`Set EVAL_BASE_URL for ${id}`);
  return { id, provider: kind, model, baseUrl, local: info.local };
}

export function apiKey(spec: ModelSpec, env: Record<string, string | undefined> = process.env): string | null {
  for (const name of KEY_ENV[spec.provider] ?? []) if (env[name]) return env[name]!;
  return null;
}

/** Dollars per million tokens, input and output, where known. Approximate list prices; check the provider. */
export const PRICES: Record<string, { input: number; output: number }> = {
  "openrouter:moonshotai/kimi-k2": { input: 0.57, output: 2.3 },
  "openrouter:moonshotai/kimi-k2-0905": { input: 0.4, output: 2 },
  "openrouter:qwen/qwen3-235b-a22b-2507": { input: 0.12, output: 0.6 },
  "openrouter:openai/gpt-oss-120b": { input: 0.1, output: 0.5 },
  "openrouter:openai/gpt-oss-20b": { input: 0.05, output: 0.2 },
  "openrouter:deepseek/deepseek-chat-v3.1": { input: 0.25, output: 1 },
  "openrouter:google/gemini-2.5-flash": { input: 0.3, output: 2.5 },
  "openrouter:anthropic/claude-haiku-4.5": { input: 1, output: 5 },
  "openrouter:anthropic/claude-sonnet-4.5": { input: 3, output: 15 },
  "openrouter:openai/gpt-5-mini": { input: 0.25, output: 2 },
  "anthropic:claude-haiku-4-5": { input: 1, output: 5 },
  "anthropic:claude-sonnet-4-5": { input: 3, output: 15 },
  "openai:gpt-5-mini": { input: 0.25, output: 2 },
  "openai:gpt-5": { input: 1.25, output: 10 },
  "google:gemini-2.5-flash": { input: 0.3, output: 2.5 },
  "google:gemini-2.5-pro": { input: 1.25, output: 10 },
};

export interface Usage {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  /** Dollars: what the provider reported, else from PRICES; null when neither is known. */
  cost: number | null;
}

export const emptyUsage = (): Usage => ({ calls: 0, inputTokens: 0, outputTokens: 0, cost: 0 });

export function addUsage(into: Usage, more: Usage) {
  into.calls += more.calls;
  into.inputTokens += more.inputTokens;
  into.outputTokens += more.outputTokens;
  into.cost = into.cost === null || more.cost === null ? null : into.cost + more.cost;
}

export function priceOf(spec: ModelSpec, input: number, output: number, reported?: number): number | null {
  if (typeof reported === "number") return reported;
  if (spec.local) return 0;
  const p = PRICES[spec.id];
  return p ? (input * p.input + output * p.output) / 1_000_000 : null;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * A Complete for the model, counting tokens and cost into `usage`. Retries rate limits and server
 * errors a few times. `maxTokens` matches the app's chat (800); the judge asks for more.
 */
export function completer(spec: ModelSpec, usage: Usage, { maxTokens = 800, temperature = 0.3, json = false, fetcher = fetch } = {}): Complete {
  const key = apiKey(spec);
  if (!key && !spec.local) throw new Error(`No API key for ${spec.id}: set ${(KEY_ENV[spec.provider] ?? []).join(" or ")}`);
  return async (messages, tools) => {
    const body: Record<string, unknown> = { model: spec.model, messages, temperature, max_tokens: maxTokens };
    if (tools.length) Object.assign(body, { tools, tool_choice: "auto" });
    if (json && spec.provider !== "anthropic") body.response_format = { type: "json_object" };
    if (spec.provider === "openrouter") body.usage = { include: true };
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (key) headers.Authorization = `Bearer ${key}`;
    if (spec.provider === "openrouter") Object.assign(headers, { "HTTP-Referer": "https://lactic.fit", "X-Title": "Lactic evals" });
    for (let attempt = 0; ; attempt++) {
      const response = await fetcher(`${spec.baseUrl}/chat/completions`, { method: "POST", headers, body: JSON.stringify(body), signal: AbortSignal.timeout(spec.local ? 300_000 : 120_000) });
      if ((response.status === 429 || response.status >= 500) && attempt < 3) {
        await sleep(2000 * 2 ** attempt);
        continue;
      }
      if (!response.ok) throw new Error(`${spec.id} answered ${response.status}: ${(await response.text()).slice(0, 300)}`);
      const json = await response.json();
      const message = json?.choices?.[0]?.message;
      if (!message) throw new Error(`${spec.id} returned no message`);
      const input = Number(json.usage?.prompt_tokens ?? 0);
      const output = Number(json.usage?.completion_tokens ?? 0);
      addUsage(usage, { calls: 1, inputTokens: input, outputTokens: output, cost: priceOf(spec, input, output, json.usage?.cost) });
      return { role: "assistant", content: message.content ?? null, tool_calls: message.tool_calls?.length ? message.tool_calls : undefined } satisfies ChatMessage;
    }
  };
}
