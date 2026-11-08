// The MCP server's tools, answered in the window. The Rust core speaks MCP (HTTP and the stdio
// bridge) and forwards tools/list and tools/call here; this runs them with the same tools the
// built-in coach uses, so an external AI coach reads the engine's numbers and can only propose.
// Proposals wait in coach_proposals until the rider applies them in Lactic.

import { appTools } from "@/lib/coach/app-tools";
import { applyMemory, loadCoachData } from "@/lib/coach/store";
import { forFeatures, MEMORY_TOOLS, runTool, status, TOOLS } from "@/lib/coach/tools";
import { features } from "@/lib/features";
import { createClient } from "~/db/supabase-client";
import { invoke, isDesktop, listen } from "~/platform/native";
import { revalidatePath } from "~/shims/next-cache";

interface FnTool {
  function: { name: string; description: string; parameters: Record<string, unknown> };
}

export const PROPOSALS_CHANGED = "lactic:proposals";

const OVERVIEW = {
  name: "get_overview",
  description:
    "Start here. A snapshot of the rider today: FTP, fitness, fatigue and form, recovery, this week's plan with what's been ridden, upcoming events, recent rides, and what you've been asked to remember. Most questions need nothing else.",
  inputSchema: { type: "object", properties: {} },
};

/** The tools in MCP's shape. */
export function mcpTools() {
  const fromFn = (t: FnTool) => ({ name: t.function.name, description: t.function.description, inputSchema: t.function.parameters });
  return [OVERVIEW, ...forFeatures(TOOLS as FnTool[], features()).map(fromFn), ...(MEMORY_TOOLS as FnTool[]).map(fromFn), ...(appTools()?.tools ?? []).map(fromFn)];
}

const text = (s: string, isError = false) => ({ content: [{ type: "text", text: s }], ...(isError ? { isError: true } : {}) });

/** Runs one tool call. Never throws: errors go back to the model as text it can act on. */
export async function callTool(name: string, args: Record<string, unknown>) {
  const supabase = createClient();
  if (!mcpTools().some((t) => t.name === name)) return text(`Unknown tool ${name}`, true);
  const app = appTools();
  const isApp = Boolean(app?.tools.some((t) => t.function.name === name));
  const data = isApp ? null : await loadCoachData(supabase);
  if (name === "get_overview") return text(JSON.stringify({ ...status(data!), memory: data!.memory }));
  const result = isApp ? await app!.run(name, args ?? {}) : runTool(data!, name, args ?? {});
  if (result.proposal) {
    const { error } = await supabase.from("coach_proposals").insert({ source: "mcp", proposal: result.proposal });
    if (error) return text(`Couldn't save the proposal: ${error.message}`, true);
    globalThis.dispatchEvent?.(new Event(PROPOSALS_CHANGED));
    return text(`${result.content}\nThe rider sees this in Lactic with Apply and Dismiss. Nothing changes until they apply it.`);
  }
  if (result.memory) {
    await applyMemory(supabase, [result.memory]);
    revalidatePath("/");
  }
  return text(result.content, result.content.startsWith("Error:"));
}

interface McpRequest {
  requestId: number;
  method: string;
  params?: { name?: string; arguments?: Record<string, unknown> };
}

/** Answers the MCP server from this window (the main one) for as long as the app runs. */
export function startMcpBridge() {
  if (!isDesktop) return () => undefined;
  const stop = listen<McpRequest>("mcp:request", async (req) => {
    try {
      const result = req.method === "tools/list" ? { tools: mcpTools() } : req.method === "tools/call" ? await callTool(String(req.params?.name ?? ""), req.params?.arguments ?? {}) : null;
      if (result === null) await invoke("mcp_respond", { requestId: req.requestId, result: null, error: { code: -32601, message: `Unknown method ${req.method}` } });
      else await invoke("mcp_respond", { requestId: req.requestId, result, error: null });
    } catch (e) {
      await invoke("mcp_respond", { requestId: req.requestId, result: null, error: { code: -32000, message: e instanceof Error ? e.message : String(e) } });
    }
  });
  return () => void stop.then((f) => f());
}
