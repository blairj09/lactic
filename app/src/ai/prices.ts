// List prices for models whose provider doesn't publish them in its model list (OpenRouter does,
// so its models carry their own price). Without a price a cloud model's calls cost "unknown" and
// the monthly budget can't stop them, so the app falls back to this table. Dollars per million
// tokens, approximate; dated versions (claude-haiku-4-5-20251001) match their family.

import type { ProviderKind } from "./providers";

type Price = { input: number; output: number };

const KNOWN: Partial<Record<ProviderKind, [prefix: string, price: Price][]>> = {
  anthropic: [
    ["claude-haiku-4-5", { input: 1, output: 5 }],
    ["claude-sonnet-4-5", { input: 3, output: 15 }],
    ["claude-sonnet-4", { input: 3, output: 15 }],
    ["claude-opus-4", { input: 15, output: 75 }],
    ["claude-3-5-haiku", { input: 0.8, output: 4 }],
  ],
  openai: [
    ["gpt-5-nano", { input: 0.05, output: 0.4 }],
    ["gpt-5-mini", { input: 0.25, output: 2 }],
    ["gpt-5", { input: 1.25, output: 10 }],
    ["gpt-4.1-nano", { input: 0.1, output: 0.4 }],
    ["gpt-4.1-mini", { input: 0.4, output: 1.6 }],
    ["gpt-4.1", { input: 2, output: 8 }],
    ["gpt-4o-mini", { input: 0.15, output: 0.6 }],
    ["gpt-4o", { input: 2.5, output: 10 }],
  ],
  google: [
    ["gemini-2.5-flash-lite", { input: 0.1, output: 0.4 }],
    ["gemini-2.5-flash", { input: 0.3, output: 2.5 }],
    ["gemini-2.5-pro", { input: 1.25, output: 10 }],
  ],
};

/** The list price for a model, by the longest matching family name; null when unknown. */
export function knownPrice(kind: ProviderKind | string, model: string): Price | null {
  const id = model.replace(/^models\//, "").toLowerCase();
  const rows = KNOWN[kind as ProviderKind] ?? [];
  const match = rows.filter(([prefix]) => id === prefix || id.startsWith(`${prefix}-`)).sort((a, b) => b[0].length - a[0].length)[0];
  return match ? match[1] : null;
}
