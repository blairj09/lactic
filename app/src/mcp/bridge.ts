// The MCP server's tools, answered in the window. The Rust core speaks MCP (HTTP and the stdio
// bridge) and forwards tools/list and tools/call here; this runs them with the same tools the
// built-in coach uses, so an external AI coach reads the engine's numbers and can only propose.
// Proposals wait in coach_proposals until the rider applies them in Lactic.
//
// AI apps that show MCP Apps (Rust tells us per request: `ui`) also get Lactic's cards: proposals,
// rides and fitness come back with the card's data, the card page is a resource, and the card's
// Apply, Dismiss and Open buttons call one tool that only cards can see.

import { appTools } from "@/lib/coach/app-tools";
import { applyMemory, loadCoachData } from "@/lib/coach/store";
import { forFeatures, MEMORY_TOOLS, runTool, status, TOOLS } from "@/lib/coach/tools";
import { features } from "@/lib/features";
import { createClient } from "~/db/supabase-client";
import { invoke, isDesktop, listen } from "~/platform/native";
import { revalidatePath } from "~/shims/next-cache";
import { navigateTo } from "~/shims/next-navigation";
import { CHAT_ONLY_TOOLS } from "~/support/definitions";
import { CARD_ACTION_TOOL, CARD_MIME, CARD_URI, safePath, type Card, type CardAction } from "./card-data";
import { fitnessCard, rideCard } from "./cards";
import { decideProposal, loadProposal, PROPOSALS_CHANGED } from "./proposals";
import { recordSeen } from "./status";

export { PROPOSALS_CHANGED };

interface FnTool {
  function: { name: string; description: string; parameters: Record<string, unknown> };
}

const OVERVIEW = {
  name: "get_overview",
  description:
    "Start here. A snapshot of the rider today: FTP, fitness, fatigue and form, recovery, this week's plan with what's been ridden, upcoming events, recent rides, and what you've been asked to remember. Most questions need nothing else.",
  inputSchema: { type: "object", properties: {} },
};

/** Tools whose result shows a card, in AI apps that show them. */
const CARD_TOOLS = (name: string) => name === "get_ride" || name === "get_fitness" || name.startsWith("propose_");
const CARD_META = { ui: { resourceUri: CARD_URI }, "ui/resourceUri": CARD_URI };

/** The cards' buttons. `visibility: ["app"]` keeps it out of the model's tools: only the rider's tap calls it. */
const CARD_ACTION = {
  name: CARD_ACTION_TOOL,
  title: "Lactic card buttons",
  description: "Used by Lactic's cards for their buttons: Apply or Dismiss a suggestion, check whether it's still waiting, or open a page in Lactic.",
  inputSchema: {
    type: "object",
    properties: {
      action: { type: "string", enum: ["status", "apply", "dismiss", "open"] },
      proposal_id: { type: "string" },
      path: { type: "string" },
    },
    required: ["action"],
  },
  _meta: { ui: { resourceUri: CARD_URI, visibility: ["app"] } },
};

/** Tools that only look: everything named get_, list_ or read_, plus these. */
const LOOKS = new Set(["check_app", "test_connection", "plugin_guide"]);
/** Tools that can take something away: a remembered fact, or a card's Apply (which may replace a plan). */
const REMOVES = new Set(["forget", CARD_ACTION_TOOL]);
/** Tools that talk to a service beyond Lactic (intervals.icu). */
const REACHES_OUT = new Set(["sync_now", "test_connection"]);

/** MCP tool annotations, so an AI app knows which tools only read and can ask before the rest. */
export function annotationsFor(name: string) {
  const title = (name.charAt(0).toUpperCase() + name.slice(1)).replaceAll("_", " ");
  const readOnly = /^(get|list|read)_/.test(name) || LOOKS.has(name);
  return { title, readOnlyHint: readOnly, destructiveHint: !readOnly && REMOVES.has(name), openWorldHint: REACHES_OUT.has(name) };
}

const annotate = <T extends { name: string }>(t: T) => {
  const annotations = annotationsFor(t.name);
  return { ...t, title: (t as { title?: string }).title ?? annotations.title, annotations };
};

/** The tools in MCP's shape. With `ui`, for an AI app that shows cards. */
export function mcpTools(ui = false) {
  const fromFn = (t: FnTool) => ({ name: t.function.name, description: t.function.description, inputSchema: t.function.parameters });
  const tools: { name: string; description: string; inputSchema: unknown; _meta?: unknown }[] = [OVERVIEW, ...forFeatures(TOOLS as FnTool[], features()).map(fromFn), ...(MEMORY_TOOLS as FnTool[]).map(fromFn), ...(appTools()?.tools ?? []).filter((t) => !CHAT_ONLY_TOOLS.includes(t.function.name)).map(fromFn)];
  if (!ui) return tools.map(annotate);
  return [...tools.map((t) => (CARD_TOOLS(t.name) ? { ...t, _meta: CARD_META } : t)), CARD_ACTION].map(annotate);
}

const text = (s: string, isError = false) => ({ content: [{ type: "text", text: s }], ...(isError ? { isError: true } : {}) });
const withCard = (result: ReturnType<typeof text>, card: Card | null) => (card ? { ...result, structuredContent: card } : result);

/** The card page, for resources/list and resources/read. Built from src/mcp/view (vite.config.ts). */
export async function cardResource(uri?: string) {
  const meta = { ui: { prefersBorder: false } };
  if (uri === undefined) return { resources: [{ uri: CARD_URI, name: "lactic-card", title: "Lactic card", description: "Lactic's workouts, rides and fitness, drawn in the chat.", mimeType: CARD_MIME, _meta: meta }] };
  if (uri !== CARD_URI) throw Object.assign(new Error(`Unknown resource ${uri}`), { code: -32002 });
  const { default: html } = await import("virtual:lactic-mcp-view");
  return { contents: [{ uri: CARD_URI, mimeType: CARD_MIME, text: html, _meta: meta }] };
}

/** A card's button: only for AI apps that show cards, and never anything but these few actions. */
async function cardAction(args: Record<string, unknown>) {
  const a = args as CardAction;
  if (a.action === "open") {
    const path = safePath(a.path);
    if (!path) return text("Error: unknown page", true);
    navigateTo(path);
    await invoke("mcp_show_main").catch(() => {});
    return text("Opened in Lactic.");
  }
  const id = typeof a.proposal_id === "string" ? a.proposal_id : "";
  if (a.action === "status") {
    const row = await loadProposal(id);
    return row ? { ...text(`This suggestion is ${row.status}.`), structuredContent: { status: row.status } } : text("Error: that suggestion is no longer in Lactic.", true);
  }
  if (a.action !== "apply" && a.action !== "dismiss") return text("Error: unknown action", true);
  try {
    const { status, message } = await decideProposal(id, a.action === "apply");
    return { ...text(message), structuredContent: { status, message } };
  } catch (e) {
    return text(`Error: ${e instanceof Error ? e.message : String(e)}`, true);
  }
}

/** Runs one tool call. Never throws: errors go back to the model as text it can act on. `ui`: the AI app shows cards. */
export async function callTool(name: string, args: Record<string, unknown>, ui = false) {
  const supabase = createClient();
  if (!mcpTools(ui).some((t) => t.name === name)) return text(`Unknown tool ${name}`, true);
  if (name === CARD_ACTION_TOOL) return cardAction(args ?? {});
  const app = appTools();
  const isApp = Boolean(app?.tools.some((t) => t.function.name === name));
  const data = isApp ? null : await loadCoachData(supabase);
  if (name === "get_overview") return text(JSON.stringify({ ...status(data!), memory: data!.memory }));
  const result = isApp ? await app!.run(name, args ?? {}, { via: "mcp" }) : runTool(data!, name, args ?? {});
  if (result.proposal) {
    const { data: row, error } = await supabase.from("coach_proposals").insert({ source: "mcp", proposal: result.proposal }).select("id").single();
    if (error) return text(`Couldn't save the proposal: ${error.message}`, true);
    globalThis.dispatchEvent?.(new Event(PROPOSALS_CHANGED));
    const where = ui ? "on a card here and in Lactic" : "in Lactic";
    const card: Card | null = ui && row ? { view: "proposal", id: String((row as { id: string }).id), proposal: result.proposal, status: "pending" } : null;
    return withCard(text(`${result.content}\nThe rider sees this ${where} with Apply and Dismiss. Nothing changes until they apply it.`), card);
  }
  if (result.memory) {
    await applyMemory(supabase, [result.memory]);
    revalidatePath("/");
  }
  const failed = result.content.startsWith("Error:");
  if (!ui || failed) return text(result.content, failed);
  const card = name === "get_ride" ? await rideCard(String(args?.id ?? "")).catch(() => null) : name === "get_fitness" ? fitnessCard(data!, args ?? {}) : null;
  return withCard(text(result.content), card);
}

interface McpRequest {
  requestId: number;
  method: string;
  params?: { name?: string; arguments?: Record<string, unknown>; uri?: string };
  /** The AI app that sent it, when it said. */
  client?: string | null;
  /** The AI app shows cards (MCP Apps). */
  ui?: boolean;
}

/** Answers the MCP server from this window (the main one) for as long as the app runs. */
export function startMcpBridge() {
  if (!isDesktop) return () => undefined;
  const stop = listen<McpRequest>("mcp:request", async (req) => {
    void recordSeen(req.client ?? null).catch(() => {});
    try {
      const ui = req.ui === true;
      const p = (req.params ?? {}) as { name?: string; arguments?: Record<string, unknown>; uri?: string };
      const result =
        req.method === "tools/list"
          ? { tools: mcpTools(ui) }
          : req.method === "tools/call"
            ? await callTool(String(p.name ?? ""), p.arguments ?? {}, ui)
            : ui && req.method === "resources/list"
              ? await cardResource()
              : ui && req.method === "resources/read"
                ? await cardResource(String(p.uri ?? ""))
                : null;
      if (result === null) await invoke("mcp_respond", { requestId: req.requestId, result: null, error: { code: -32601, message: `Unknown method ${req.method}` } });
      else await invoke("mcp_respond", { requestId: req.requestId, result, error: null });
    } catch (e) {
      await invoke("mcp_respond", { requestId: req.requestId, result: null, error: { code: -32000, message: e instanceof Error ? e.message : String(e) } });
    }
  });
  return () => void stop.then((f) => f());
}
