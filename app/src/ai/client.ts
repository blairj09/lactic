// The built-in coach's model calls, for whichever provider the rider chose. It stands in for the
// web app's src/lib/coach/openrouter.ts (same exports), so the web coach (chat, brief, weekly
// review, summaries) runs unchanged on OpenRouter, Anthropic, OpenAI, Gemini, Ollama, LM Studio or
// anything OpenAI-compatible. The key is a keychain placeholder; the Rust core adds the real one.
// Every call is counted in ai_usage, and a cloud model stops at the monthly cap.

import { StreamReader } from "@shared/coach/stream";
import { coachSetup, SECRET_AI, type CoachSetup, type ModelChoice } from "./settings";
import { knownPrice, preset, type ProviderKind } from "./providers";
import { sql } from "~/db/sql";
import { uuid } from "~/db/supa";

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: { id: string; type: "function"; function: { name: string; arguments: string } }[];
  tool_call_id?: string;
}

export type Complete = (messages: ChatMessage[], tools: unknown[], onText?: (delta: string) => void) => Promise<ChatMessage>;

export type ContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } }
  | { type: "file"; file: { filename: string; file_data: string } };

export class BudgetReached extends Error {
  constructor(cap: number, now = new Date()) {
    const resets = new Date(now.getFullYear(), now.getMonth() + 1, 1).toLocaleDateString("en-US", { month: "long", day: "numeric" });
    super(
      `This month's AI budget ($${cap.toFixed(2)}) is used up, so the coach is paused until ${resets}. Your plan and workouts carry on as usual. To keep chatting, raise the limit in Settings → Coach or switch to a model on this computer.`,
    );
  }
}

interface Target {
  url: string;
  headers: Record<string, string>;
  provider: string;
  local: boolean;
}

export function target(setup: Pick<CoachSetup, "provider">): Target {
  const p = setup.provider;
  if (!p) throw new Error("No AI provider is set up. Choose one in Settings → Coach.");
  const info = preset(p.kind);
  const base = (p.baseUrl || info.baseUrl).replace(/\/+$/, "");
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (p.hasKey) headers.Authorization = `Bearer keychain:${SECRET_AI}`;
  if (p.kind === "openrouter") {
    headers["HTTP-Referer"] = "https://lactic.fit";
    headers["X-Title"] = "Lactic";
  }
  return { url: `${base}/chat/completions`, headers, provider: p.kind, local: info.local };
}

/** Spend so far this calendar month, in US dollars. */
export async function monthSpend(): Promise<number> {
  const start = new Date();
  start.setDate(1);
  start.setHours(0, 0, 0, 0);
  const rows = await sql().select(`SELECT COALESCE(SUM(cost_usd), 0) AS total FROM ai_usage WHERE at >= ?`, [start.toISOString()]);
  return Number(rows[0]?.total ?? 0);
}

async function checkBudget(setup: CoachSetup, t: Target) {
  if (t.local || setup.monthlyCapUsd === null) return;
  const spent = await monthSpend();
  if (spent >= setup.monthlyCapUsd) throw new BudgetReached(setup.monthlyCapUsd);
}

const estimateTokens = (text: string) => Math.ceil(text.length / 4);

async function record(job: string, t: Target, choice: ModelChoice, input: number, output: number) {
  // The provider's own price when its model list has one (OpenRouter), else the list price Lactic
  // ships for suggested models, so the monthly limit counts direct Anthropic, OpenAI and Gemini keys.
  const price = choice.price ?? knownPrice(t.provider as ProviderKind, choice.model);
  const cost = price ? (input * price.input + output * price.output) / 1_000_000 : t.local ? 0 : null;
  try {
    const now = new Date().toISOString();
    await sql().execute(
      `INSERT INTO ai_usage (id, at, provider, model, job, input_tokens, output_tokens, cost_usd, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [uuid(), now, t.provider, choice.model, job, input, output, cost, now],
    );
  } catch (e) {
    console.error(e);
  }
}

async function failure(response: Response): Promise<Error> {
  const text = (await response.text()).slice(0, 300);
  if (response.status === 401 || response.status === 403) return new Error("The AI provider turned the key down. Check it in Settings → Coach.");
  if (response.status === 404) return new Error(`The model wasn't found (${text.slice(0, 120)}). Pick another in Settings → Coach.`);
  if (response.status === 429) return new Error("The AI provider is rate limiting. Try again in a minute.");
  return new Error(`The AI provider answered ${response.status}: ${text}`);
}

function lastUsage(raw: string): { prompt_tokens?: number; completion_tokens?: number } | null {
  const m = [...raw.matchAll(/"usage"\s*:\s*(\{[^}]*\})/g)].pop();
  if (!m) return null;
  try {
    return JSON.parse(m[1]);
  } catch {
    return null;
  }
}

/**
 * Length and temperature, in the form each provider takes. Current Claude and GPT models think
 * before answering (thinking counts toward the length, so they get room for it), turn down a
 * custom temperature, and OpenAI's want max_completion_tokens.
 */
export function sampling(provider: string, model: string, maxTokens: number): Record<string, unknown> {
  const thinking = provider === "anthropic" || provider === "openai" || /^(anthropic|openai)\//.test(model);
  if (!thinking) return { max_tokens: maxTokens, temperature: 0.3 };
  const room = maxTokens + 4000;
  return provider === "openai" ? { max_completion_tokens: room } : { max_tokens: room };
}

/** One chat completion on the configured model (or `model` on the same provider). */
export function complete({ maxTokens = 800, job = "chat", model, setup: given }: { maxTokens?: number; job?: string; model?: string; setup?: CoachSetup } = {}): Complete {
  return async (messages, tools, onText) => {
    const setup = given ?? (await coachSetup());
    const choice: ModelChoice = model ? { ...(setup.chat ?? {}), model } : (setup.chat ?? { model: "" });
    if (!choice.model) throw new Error("No model chosen. Pick one in Settings → Coach.");
    const t = target(setup);
    await checkBudget(setup, t);
    const stream = Boolean(onText);
    const body: Record<string, unknown> = { model: choice.model, messages, stream, ...sampling(t.provider, choice.model, maxTokens) };
    if (tools.length) Object.assign(body, { tools, tool_choice: "auto" });
    if (stream && (t.provider === "openrouter" || t.provider === "openai")) body.stream_options = { include_usage: true };
    const payload = JSON.stringify(body);
    const headers = { ...t.headers, ...(stream ? { Accept: "text/event-stream" } : {}) };
    const response = await fetch(t.url, { method: "POST", headers, body: payload, signal: AbortSignal.timeout(t.local ? 300_000 : 90_000) });
    if (!response.ok) throw await failure(response);
    if (stream && response.body) {
      const reader = new StreamReader(onText);
      const decoder = response.body.pipeThrough(new TextDecoderStream()).getReader();
      let raw = "";
      for (;;) {
        const { value, done } = await decoder.read();
        if (done) break;
        raw += value;
        reader.push(value);
      }
      const message = reader.message();
      const usage = lastUsage(raw);
      await record(job, t, choice, usage?.prompt_tokens ?? estimateTokens(payload), usage?.completion_tokens ?? estimateTokens(JSON.stringify(message)));
      return message;
    }
    const json = await response.json();
    const message = json?.choices?.[0]?.message;
    if (!message) throw new Error("The model returned no message");
    await record(job, t, choice, json.usage?.prompt_tokens ?? estimateTokens(payload), json.usage?.completion_tokens ?? estimateTokens(JSON.stringify(message)));
    return { role: "assistant", content: message.content ?? null, tool_calls: message.tool_calls };
  };
}

// --- the web code's names -----------------------------------------------------------------------

/** The web app's OpenRouter client, here on the rider's own provider. */
export function openRouter(apiKey: string, model: string, opts: { maxTokens?: number } = {}): Complete {
  void apiKey;
  void model;
  return complete({ maxTokens: opts.maxTokens });
}

/** Reads an image or file with a model that can see (the vision choice, else the chat model). */
export async function openRouterLook(apiKey: string, model: string, system: string, parts: ContentPart[], { maxTokens = 1500 } = {}): Promise<string> {
  void apiKey;
  void model;
  const setup = await coachSetup();
  const choice = setup.vision ?? setup.chat;
  if (!choice) throw new Error("No model chosen");
  const t = target(setup);
  await checkBudget(setup, t);
  const payload = JSON.stringify({ model: choice.model, messages: [{ role: "system", content: system }, { role: "user", content: parts }], temperature: 0.1, max_tokens: maxTokens });
  const response = await fetch(t.url, { method: "POST", headers: t.headers, body: payload, signal: AbortSignal.timeout(120_000) });
  if (!response.ok) throw await failure(response);
  const json = await response.json();
  const text = json?.choices?.[0]?.message?.content;
  if (typeof text !== "string" || !text.trim()) throw new Error("The model returned nothing for that file");
  await record("vision", t, choice, json.usage?.prompt_tokens ?? estimateTokens(payload), json.usage?.completion_tokens ?? estimateTokens(text));
  return text.trim();
}
