// Newline-delimited JSON events for the coach routes: { type: "status", text } while the coach reads
// your data, { type: "reset" } when a new model call starts, { type: "text", delta } as the reply
// streams, then { type: "done", message } with the saved reply, or { type: "error", message }.

import type { ChatHooks } from "@/lib/coach/chat";
import type { StoredMessage } from "@/lib/coach/store";

export function eventStream(work: (hooks: ChatHooks) => Promise<StoredMessage>, after?: (message: StoredMessage) => Promise<void>): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: unknown) => controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      try {
        const message = await work({
          onStatus: (text) => send({ type: "status", text }),
          onTurn: () => send({ type: "reset" }),
          onText: (delta) => send({ type: "text", delta }),
        });
        send({ type: "done", message });
        await after?.(message);
      } catch (e) {
        console.error(e);
        send({ type: "error", message: e instanceof Error ? e.message : String(e) });
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson", "Cache-Control": "no-store" } });
}
