// Reads the coach routes' newline-delimited JSON events in the browser.

import type { StoredMessage } from "@/lib/coach/store";

export interface EventHandlers {
  status?: (text: string) => void;
  text?: (delta: string) => void;
  reset?: () => void;
}

/** POSTs to a coach route and calls the handlers as events arrive. Resolves with the saved message. */
export async function streamCoach(url: string, body: unknown, on: EventHandlers): Promise<StoredMessage> {
  const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body ?? {}) });
  if (!response.ok || !response.body) throw new Error((await response.json().catch(() => null))?.error ?? `The coach is unavailable (${response.status})`);
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += value;
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines.filter(Boolean)) {
      const event = JSON.parse(line);
      if (event.type === "status") on.status?.(event.text);
      else if (event.type === "text") on.text?.(event.delta);
      else if (event.type === "reset") on.reset?.();
      else if (event.type === "done") return event.message;
      else if (event.type === "error") throw new Error(event.message);
    }
  }
  throw new Error("The coach stopped before answering");
}
