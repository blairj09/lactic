// Who made an App history entry, in words.

import type { Entry } from "./store";

export function byLineText(e: Pick<Entry, "author" | "client">): string {
  if (e.author === "coach") return "Coach";
  if (e.author === "ai_app") return e.client && e.client !== "AI app" ? e.client : "Your AI app";
  if (e.author === "lactic") return "Lactic";
  if (e.author === "sync") return "Sync";
  return "You";
}
