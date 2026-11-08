// Whether an AI app is coaching through Lactic's MCP server: when one last read something, which
// app it was, and whether Lactic is in Claude Desktop's settings. Shown on the External coach pill.

import { useEffect, useState } from "react";
import { getSetting, setSetting } from "~/settings/store";
import { invoke, isDesktop } from "~/platform/native";

const KEY = "mcp.last_seen";

export interface LastSeen {
  at: string;
  /** The AI app's own name for itself, e.g. "Claude". */
  client: string | null;
}

export interface McpStatus {
  lastSeen: LastSeen | null;
  claudeAdded: boolean;
}

let lastWrite = 0;

/** Records an AI app's request. Writes at most once a minute, unless the app changed. */
export async function recordSeen(client: string | null, now = Date.now()) {
  const prev = await getSetting<LastSeen | null>(KEY, null);
  if (prev && now - lastWrite < 60_000 && prev.client === client) return;
  lastWrite = now;
  await setSetting(KEY, { at: new Date(now).toISOString(), client: client ?? prev?.client ?? null });
}

/** A short name for the app: "Claude" for Claude Desktop and Claude Code, else what it calls itself. */
export function appName(status: McpStatus | null): string {
  const client = status?.lastSeen?.client;
  if (client && /claude/i.test(client)) return "Claude";
  if (client) return client;
  return status?.claudeAdded ? "Claude" : "your AI app";
}

/** "just now", "5 min ago", "3 hours ago", "2 days ago". */
export function ago(iso: string, now = Date.now()): string {
  const mins = Math.max(0, Math.round((now - Date.parse(iso)) / 60_000));
  if (mins < 2) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

export type Connection = "active" | "added" | "none";

/** active: an app has read from Lactic; added: in Claude Desktop but not used yet; none: not set up. */
export const connection = (s: McpStatus | null): Connection => (s?.lastSeen ? "active" : s?.claudeAdded ? "added" : "none");

export function useMcpStatus(): McpStatus | null {
  const [status, setStatus] = useState<McpStatus | null>(null);
  useEffect(() => {
    const load = async () => {
      const lastSeen = await getSetting<LastSeen | null>(KEY, null);
      const claudeAdded = isDesktop ? await invoke<{ claudeAdded?: boolean }>("mcp_setup").then((s) => Boolean(s.claudeAdded)).catch(() => false) : false;
      setStatus({ lastSeen, claudeAdded });
    };
    void load();
    const onSettings = (e: Event) => (e as CustomEvent<string>).detail === KEY && void load();
    window.addEventListener("lactic:settings", onSettings);
    window.addEventListener("focus", load);
    return () => {
      window.removeEventListener("lactic:settings", onSettings);
      window.removeEventListener("focus", load);
    };
  }, []);
  return status;
}
