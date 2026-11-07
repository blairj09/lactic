// The model behind the coach: OpenRouter's OpenAI-compatible chat completions, and the message types
// the coach's runs share.

import { StreamReader } from "./stream";

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: { id: string; type: "function"; function: { name: string; arguments: string } }[];
  tool_call_id?: string;
}

/** One chat completion: messages and tools in, the assistant's message out. `onText` hears reply text as it streams. */
export type Complete = (messages: ChatMessage[], tools: unknown[], onText?: (delta: string) => void) => Promise<ChatMessage>;

/** OpenRouter's chat completions endpoint (OpenAI-compatible). Server only: the key never reaches the browser. Streams when asked for text. */
export function openRouter(apiKey: string, model: string, { maxTokens = 800 } = {}): Complete {
  return async (messages, tools, onText) => {
    const stream = Boolean(onText);
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", "X-Title": "My Coach" },
      body: JSON.stringify({ model, messages, ...(tools.length ? { tools, tool_choice: "auto" } : {}), temperature: 0.3, max_tokens: maxTokens, stream }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!response.ok) throw new Error(`OpenRouter ${response.status}: ${(await response.text()).slice(0, 200)}`);
    if (stream && response.body) {
      const reader = new StreamReader(onText);
      const decoder = response.body.pipeThrough(new TextDecoderStream()).getReader();
      for (;;) {
        const { value, done } = await decoder.read();
        if (done) break;
        reader.push(value);
      }
      return reader.message();
    }
    const body = await response.json();
    const message = body?.choices?.[0]?.message;
    if (!message) throw new Error("OpenRouter returned no message");
    return { role: "assistant", content: message.content ?? null, tool_calls: message.tool_calls };
  };
}

/** A part of a multimodal user message: text, an image, or a file such as a PDF (as data URLs). */
export type ContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } }
  | { type: "file"; file: { filename: string; file_data: string } };

/** One reply from a model that can see images and files, for reading attachments. No tools, no streaming. */
export async function openRouterLook(apiKey: string, model: string, system: string, parts: ContentPart[], { maxTokens = 1500 } = {}): Promise<string> {
  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", "X-Title": "My Coach" },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: parts },
      ],
      temperature: 0.1,
      max_tokens: maxTokens,
    }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) throw new Error(`OpenRouter ${response.status}: ${(await response.text()).slice(0, 200)}`);
  const body = await response.json();
  const text = body?.choices?.[0]?.message?.content;
  if (typeof text !== "string" || !text.trim()) throw new Error("The vision model returned nothing");
  return text.trim();
}
