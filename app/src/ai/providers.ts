// Where the built-in coach's model can come from. Every one is reached through the same
// OpenAI-compatible chat completions API, so adding a provider is one entry here.

export type ProviderKind = "openrouter" | "openai" | "anthropic" | "google" | "ollama" | "lmstudio" | "custom";

export interface ProviderPreset {
  kind: ProviderKind;
  label: string;
  /** One line for the picker. */
  blurb: string;
  baseUrl: string;
  local: boolean;
  /** Where to get a key, for cloud providers. */
  keyUrl?: string;
  keyHint?: string;
  /** Good starting models, shown before (or instead of) the provider's own list. Checked November 2026. */
  suggested: SuggestedModel[];
}

export interface SuggestedModel {
  id: string;
  label: string;
  note?: string;
  /** List price per million tokens, for cost estimates and the monthly limit when the provider doesn't say. */
  price?: { input: number; output: number };
  /** The one to start with. */
  pick?: boolean;
}

export const PROVIDERS: ProviderPreset[] = [
  {
    kind: "openrouter",
    label: "OpenRouter",
    blurb: "One key for hundreds of models, including open ones. Pay as you go.",
    baseUrl: "https://openrouter.ai/api/v1",
    local: false,
    keyUrl: "https://openrouter.ai/keys",
    keyHint: "sk-or-…",
    suggested: [
      { id: "anthropic/claude-haiku-5.5", label: "Claude Haiku 5.5", note: "Reliable with tools and very cheap. The best place to start", price: { input: 0.1, output: 0.5 }, pick: true },
      { id: "anthropic/claude-sonnet-5.5", label: "Claude Sonnet 5.5", note: "The most thoughtful coaching, at a higher price", price: { input: 2, output: 10 } },
      { id: "z-ai/glm-5.3", label: "GLM 5.3", note: "Open model, good with tools, cheap", price: { input: 0.07, output: 1.4 } },
      { id: "moonshotai/kimi-k2.6", label: "Kimi K2.6", note: "Open model, strong with tools", price: { input: 0.39, output: 1.64 } },
      { id: "deepseek/deepseek-v4.1-flash", label: "DeepSeek V4.1 Flash", note: "Open model, the cheapest that still handles tools well", price: { input: 0.006, output: 0.5 } },
    ],
  },
  {
    kind: "anthropic",
    label: "Anthropic (Claude)",
    blurb: "Claude models with your Anthropic API key.",
    baseUrl: "https://api.anthropic.com/v1",
    local: false,
    keyUrl: "https://console.anthropic.com/settings/keys",
    keyHint: "sk-ant-…",
    suggested: [
      { id: "claude-haiku-5-5", label: "Claude Haiku 5.5", note: "Reliable with tools and very cheap. The best place to start", price: { input: 0.1, output: 0.5 }, pick: true },
      { id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5", note: "The most thoughtful coaching, at a higher price", price: { input: 2, output: 10 } },
    ],
  },
  {
    kind: "openai",
    label: "OpenAI",
    blurb: "GPT models with your OpenAI API key.",
    baseUrl: "https://api.openai.com/v1",
    local: false,
    keyUrl: "https://platform.openai.com/api-keys",
    keyHint: "sk-…",
    suggested: [
      { id: "gpt-6-luna", label: "GPT-6 Luna", note: "Inexpensive and quick", price: { input: 0.1, output: 0.5 }, pick: true },
      { id: "gpt-6.1-terra", label: "GPT-6.1 Terra", note: "A step up in reasoning", price: { input: 1, output: 5 } },
      { id: "gpt-6.1-sol", label: "GPT-6.1 Sol", note: "OpenAI's top general model", price: { input: 2, output: 10 } },
    ],
  },
  {
    kind: "google",
    label: "Google Gemini",
    blurb: "Gemini models with a Google AI Studio key (there's a free tier).",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    local: false,
    keyUrl: "https://aistudio.google.com/apikey",
    keyHint: "AIza…",
    suggested: [
      { id: "gemini-3.8-flash", label: "Gemini 3.8 Flash", note: "Fast and good with tools", price: { input: 1.5, output: 7.5 }, pick: true },
      { id: "gemini-3.5-flash-lite", label: "Gemini 3.5 Flash-Lite", note: "Cheaper, a little less careful", price: { input: 0.3, output: 2.5 } },
      { id: "gemini-4-argon", label: "Gemini 4 Argon", note: "Google's top model, costs more", price: { input: 4, output: 20 } },
    ],
  },
  {
    kind: "ollama",
    label: "Ollama (on this computer)",
    blurb: "Free and private: the model runs on your own computer. Needs Ollama installed.",
    baseUrl: "http://localhost:11434/v1",
    local: true,
    keyUrl: "https://ollama.com/download",
    suggested: [
      { id: "qwen3:8b", label: "Qwen 3 8B", note: "The smallest that uses tools reliably. Runs on a 16 GB Mac (5 GB download)", pick: true },
      { id: "qwen3:14b", label: "Qwen 3 14B", note: "Steadier, wants 24 GB of memory (9 GB download)" },
      { id: "gpt-oss:20b", label: "gpt-oss 20B", note: "Good with tools, wants 24 GB of memory (14 GB download)" },
      { id: "qwen3.8:27b", label: "Qwen 3.8 27B", note: "The best local coach, wants 32 GB of memory (17 GB download)" },
    ],
  },
  {
    kind: "lmstudio",
    label: "LM Studio (on this computer)",
    blurb: "Free and private, with LM Studio's model library. Turn on its local server.",
    baseUrl: "http://localhost:1234/v1",
    local: true,
    keyUrl: "https://lmstudio.ai",
    suggested: [],
  },
  {
    kind: "custom",
    label: "Another service",
    blurb: "Anything with an OpenAI-compatible API: Groq, Together, a server of your own.",
    baseUrl: "",
    local: false,
    suggested: [],
  },
];

export const preset = (kind: ProviderKind) => PROVIDERS.find((p) => p.kind === kind)!;

/** The list price Lactic ships for a suggested model, for providers whose model list has no prices. */
export function knownPrice(kind: ProviderKind | undefined, model: string): SuggestedModel["price"] {
  const own = kind ? preset(kind).suggested.find((s) => s.id === model) : undefined;
  return own?.price;
}
