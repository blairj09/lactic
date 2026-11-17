// Whether an AI app is coaching through Lactic's MCP server: when one last read something, which
// app it was, and whether Lactic is in Claude Desktop's settings. Shown on the AI app pill, by friendly name.

import { useEffect, useState } from "react";
import { getSetting, setSetting } from "~/settings/store";
import { invoke, isDesktop } from "~/platform/native";

const KEY = "mcp.last_seen";
/** Every AI app that has read from Lactic, by friendly name, with when it last did. */
const APPS = "mcp.apps";

export interface LastSeen {
  at: string;
  /** The AI app's own name for itself, e.g. "Claude". */
  client: string | null;
}

export interface SeenApp {
  name: string;
  at: string;
}

export interface McpStatus {
  lastSeen: LastSeen | null;
  claudeAdded: boolean;
  /** Connected apps, most recent first. */
  apps?: SeenApp[];
}

// Names AI apps send in MCP's clientInfo, matched loosely, and what Lactic calls them.
const KNOWN: [RegExp, string][] = [
  [/claude|local-agent-mode|anthropic|cowork/i, "Claude"],
  [/chatgpt|openai/i, "ChatGPT"],
  [/codex/i, "Codex"],
  [/cursor/i, "Cursor"],
  [/visual studio code|vscode|vs code|copilot/i, "VS Code"],
  [/windsurf|codeium/i, "Windsurf"],
  [/gemini/i, "Gemini"],
  [/goose/i, "Goose"],
  [/\bzed\b/i, "Zed"],
  [/cline/i, "Cline"],
  [/\bcontinue\b/i, "Continue"],
  [/raycast/i, "Raycast"],
  [/lm ?studio/i, "LM Studio"],
  [/msty/i, "Msty"],
  [/perplexity/i, "Perplexity"],
  [/mistral|le chat/i, "Le Chat"],
];

/** A friendly name for what an AI app calls itself: "Claude" for "local-agent-mode-lactic", else "AI app". */
export function friendlyName(client: string | null | undefined): string {
  if (!client) return "AI app";
  for (const [re, name] of KNOWN) if (re.test(client)) return name;
  return "AI app";
}

let lastWrite = 0;

/** Records an AI app's request. Writes at most once a minute, unless the app changed. */
export async function recordSeen(client: string | null, now = Date.now()) {
  const prev = await getSetting<LastSeen | null>(KEY, null);
  if (prev && now - lastWrite < 60_000 && prev.client === client) return;
  lastWrite = now;
  const at = new Date(now).toISOString();
  await setSetting(KEY, { at, client: client ?? prev?.client ?? null });
  const apps = await getSetting<Record<string, string>>(APPS, {});
  await setSetting(APPS, { ...apps, [friendlyName(client ?? prev?.client)]: at });
}

/** The apps to list: every one seen, or the last one for riders from before the list existed. */
export function seenApps(lastSeen: LastSeen | null, apps: Record<string, string>): SeenApp[] {
  const list = Object.entries(apps).map(([name, at]) => ({ name, at }));
  if (!list.length && lastSeen) list.push({ name: friendlyName(lastSeen.client), at: lastSeen.at });
  return list.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
}

/** A short name for the app coaching: "Claude", "ChatGPT", or "your AI app" when Lactic can't tell. */
export function appName(status: McpStatus | null): string {
  const apps = status?.apps ?? (status?.lastSeen ? seenApps(status.lastSeen, {}) : []);
  if (apps.length === 1 && apps[0].name !== "AI app") return apps[0].name;
  if (apps.length) return "your AI app";
  return status?.claudeAdded ? "Claude" : "your AI app";
}

/** The pill: "Claude connected" for one known app, else "AI connected". */
export function pillLabel(status: McpStatus | null): string {
  const name = appName(status);
  return `${name === "your AI app" ? "AI" : name} connected`;
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
      const apps = seenApps(lastSeen, await getSetting<Record<string, string>>(APPS, {}));
      const claudeAdded = isDesktop ? await invoke<{ claudeAdded?: boolean }>("mcp_setup").then((s) => Boolean(s.claudeAdded)).catch(() => false) : false;
      setStatus({ lastSeen, claudeAdded, apps });
    };
    void load();
    const onSettings = (e: Event) => [KEY, APPS].includes((e as CustomEvent<string>).detail) && void load();
    window.addEventListener("lactic:settings", onSettings);
    window.addEventListener("focus", load);
    return () => {
      window.removeEventListener("lactic:settings", onSettings);
      window.removeEventListener("focus", load);
    };
  }, []);
  return status;
}
