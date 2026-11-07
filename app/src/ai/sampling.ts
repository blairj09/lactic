// How each provider wants length and temperature. Kept apart from client.ts (which needs the
// desktop shell) so the coach evals call models exactly as the app does.

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
