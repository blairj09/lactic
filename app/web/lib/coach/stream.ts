// Reads OpenRouter's streamed chat completion (server-sent events, OpenAI format) into one assistant
// message, passing text through as it arrives. Tool calls come in pieces keyed by index.

import type { ChatMessage } from "./openrouter";

type ToolCall = NonNullable<ChatMessage["tool_calls"]>[number];

export class StreamReader {
  private buffer = "";
  private content = "";
  private calls: ToolCall[] = [];

  constructor(private onText?: (delta: string) => void) {}

  /** Feeds a chunk of the response body. */
  push(chunk: string) {
    this.buffer += chunk;
    const lines = this.buffer.split("\n");
    this.buffer = lines.pop() ?? "";
    for (const line of lines) this.line(line.trim());
  }

  private line(line: string) {
    // Blank lines end an event; lines starting with ":" are keep-alive comments.
    if (!line.startsWith("data:")) return;
    const data = line.slice(5).trim();
    if (data === "[DONE]") return;
    let event;
    try {
      event = JSON.parse(data);
    } catch {
      return;
    }
    if (event?.error) throw new Error(`OpenRouter: ${event.error.message ?? JSON.stringify(event.error)}`);
    const delta = event?.choices?.[0]?.delta;
    if (!delta) return;
    if (typeof delta.content === "string" && delta.content) {
      this.content += delta.content;
      this.onText?.(delta.content);
    }
    for (const part of delta.tool_calls ?? []) {
      const i = typeof part.index === "number" ? part.index : this.calls.length;
      const call = (this.calls[i] ??= { id: "", type: "function", function: { name: "", arguments: "" } });
      if (part.id) call.id = part.id;
      if (part.function?.name) call.function.name += part.function.name;
      if (part.function?.arguments) call.function.arguments += part.function.arguments;
    }
  }

  /** The whole message once the stream has ended. */
  message(): ChatMessage {
    if (this.buffer.trim()) this.line(this.buffer.trim());
    const calls = this.calls.filter(Boolean).map((c, i) => ({ ...c, id: c.id || `call_${i}` }));
    return { role: "assistant", content: this.content || null, tool_calls: calls.length ? calls : undefined };
  }
}
