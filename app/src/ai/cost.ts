// Rough monthly cost of the built-in coach on a model, from its price per million tokens.
// Calibrated on the original app's usage: a coach turn (a chat message, the morning brief, the
// weekly picks) reads about 30k tokens across its tool calls and writes about 1k, and a rider who
// uses the coach every day makes about 200 of them a month.

export const TYPICAL_MONTH = { turns: 200, inputTokens: 30_000, outputTokens: 1_000 };

export function monthlyEstimate(price: { input: number; output: number }): number {
  const { turns, inputTokens, outputTokens } = TYPICAL_MONTH;
  return (turns * (inputTokens * price.input + outputTokens * price.output)) / 1_000_000;
}

/** "under $1", "about $3", "about $14". */
export function formatMonthly(usd: number): string {
  if (usd < 1) return "under $1";
  return `about $${Math.round(usd)}`;
}
