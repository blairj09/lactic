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
  /** Good starting models, shown before (or instead of) the provider's own list. */
  suggested: { id: string; label: string; note?: string }[];
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
      { id: "moonshotai/kimi-k2", label: "Kimi K2", note: "Strong and cheap; what the original app uses" },
      { id: "qwen/qwen3-235b-a22b-2507", label: "Qwen 3 235B", note: "Open model, good with tools" },
      { id: "openai/gpt-oss-120b", label: "gpt-oss 120B", note: "Open model, very cheap" },
      { id: "anthropic/claude-sonnet-4.5", label: "Claude Sonnet", note: "Top quality, costs more" },
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
      { id: "claude-haiku-4-5", label: "Claude Haiku", note: "Fast and inexpensive" },
      { id: "claude-sonnet-4-5", label: "Claude Sonnet", note: "Best coaching quality" },
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
      { id: "gpt-5-mini", label: "GPT-5 mini", note: "Inexpensive" },
      { id: "gpt-5", label: "GPT-5" },
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
      { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash", note: "Fast, free tier" },
      { id: "gemini-2.5-pro", label: "Gemini 2.5 Pro" },
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
      { id: "qwen3:8b", label: "Qwen 3 8B", note: "Good with tools, runs on most Macs (5 GB)" },
      { id: "qwen3:30b-a3b", label: "Qwen 3 30B", note: "Better, needs 32 GB of memory" },
      { id: "gpt-oss:20b", label: "gpt-oss 20B", note: "Needs 16 GB of memory" },
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
