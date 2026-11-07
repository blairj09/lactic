// "Test this model": one short round trip that checks the key, the model, and whether it can call
// tools (the coach needs tools to read your training). Also lists a provider's models.

import { complete, target } from "./client";
import type { CoachSetup, ModelChoice } from "./settings";
import { knownPrice } from "./prices";

export interface ModelInfo {
  id: string;
  name?: string;
  /** Per million tokens. */
  price?: { input: number; output: number };
  context?: number;
}

/** The provider's model list, or [] when it doesn't offer one. */
export async function listModels(setup: Pick<CoachSetup, "provider">): Promise<ModelInfo[]> {
  const t = target(setup);
  const url = t.url.replace(/\/chat\/completions$/, "/models");
  const response = await fetch(url, { headers: t.headers, signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error(response.status === 401 || response.status === 403 ? "The key was turned down" : `The provider answered ${response.status}`);
  const json = await response.json();
  const rows: unknown[] = Array.isArray(json?.data) ? json.data : Array.isArray(json?.models) ? json.models : [];
  return rows
    .map((r) => {
      const m = r as { id?: string; name?: string; pricing?: { prompt?: string; completion?: string }; context_length?: number };
      if (!m.id) return null;
      const input = Number(m.pricing?.prompt);
      const output = Number(m.pricing?.completion);
      const info: ModelInfo = { id: m.id.replace(/^models\//, ""), name: m.name, context: m.context_length };
      if (Number.isFinite(input) && Number.isFinite(output)) info.price = { input: input * 1e6, output: output * 1e6 };
      else info.price = knownPrice(t.provider, info.id) ?? undefined;
      return info;
    })
    .filter((m): m is ModelInfo => m !== null);
}

const TOOL = {
  type: "function",
  function: {
    name: "get_ftp",
    description: "The rider's current FTP in watts.",
    parameters: { type: "object", properties: {}, required: [] },
  },
};

/** Sends one question that needs a tool. Resolves with what to show; never throws. */
export async function testModel(setup: CoachSetup, choice: ModelChoice): Promise<NonNullable<ModelChoice["tested"]>> {
  const started = performance.now();
  const at = new Date().toISOString();
  const seconds = () => Math.round((performance.now() - started) / 100) / 10;
  try {
    const ask = complete({ maxTokens: 200, job: "test", model: choice.model, setup: { ...setup, chat: choice } });
    const reply = await ask(
      [
        { role: "system", content: "You are a cycling coach. Use the tools to look things up." },
        { role: "user", content: "What's my FTP?" },
      ],
      [TOOL],
    );
    const tools = Boolean(reply.tool_calls?.some((c) => c.function.name === "get_ftp"));
    return {
      at,
      ok: true,
      tools,
      seconds: seconds(),
      note: tools ? undefined : "It answered, but didn't use tools. The coach works best with a model that does.",
    };
  } catch (e) {
    return { at, ok: false, tools: false, seconds: seconds(), note: e instanceof Error ? e.message : String(e) };
  }
}
