// The card's side of MCP Apps: JSON-RPC over postMessage with the AI app that shows it
// (io.modelcontextprotocol/ui). Just what the card needs: the handshake, the tool result it draws,
// the theme, its size, and calling Lactic's tools for its buttons.

type Json = Record<string, unknown>;

export interface HostContext {
  theme?: "light" | "dark";
  styles?: { variables?: Record<string, string | undefined> };
  locale?: string;
}

export interface ToolResult {
  content?: { type: string; text?: string }[];
  structuredContent?: Json;
  isError?: boolean;
}

const PROTOCOL = "2026-01-26";

export interface Host {
  context: HostContext;
  /** Calls one of Lactic's tools through the AI app. */
  callTool(name: string, args: Json): Promise<ToolResult>;
}

/**
 * Connects to the AI app. `onResult` gets each tool result for this card; `onContext` each change to
 * the theme. Resolves once the handshake is done.
 */
export async function connect(onResult: (r: ToolResult) => void, onContext: (c: HostContext) => void): Promise<Host> {
  let next = 1;
  const waiting = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  const parent = window.parent;
  const post = (message: Json) => parent.postMessage({ jsonrpc: "2.0", ...message }, "*");
  const request = (method: string, params: Json) =>
    new Promise<unknown>((resolve, reject) => {
      const id = next++;
      waiting.set(id, { resolve, reject });
      post({ id, method, params });
    });
  const host: Host = { context: {}, callTool: (name, args) => request("tools/call", { name, arguments: args }) as Promise<ToolResult> };

  window.addEventListener("message", (e: MessageEvent) => {
    if (e.source !== parent) return;
    const m = e.data as Json | null;
    if (!m || m.jsonrpc !== "2.0") return;
    if (typeof m.id === "number" && !("method" in m)) {
      const w = waiting.get(m.id);
      waiting.delete(m.id);
      if (m.error) w?.reject(new Error(String((m.error as Json).message ?? "The AI app refused")));
      else w?.resolve(m.result);
      return;
    }
    const params = (m.params ?? {}) as Json;
    switch (m.method) {
      case "ui/notifications/tool-result":
        onResult(params as ToolResult);
        break;
      case "ui/notifications/host-context-changed":
        host.context = { ...host.context, ...(params as HostContext) };
        onContext(host.context);
        break;
      case "ui/resource-teardown":
      case "ping":
        post({ id: m.id, result: {} });
        break;
      default:
        if (m.id !== undefined) post({ id: m.id, error: { code: -32601, message: "Method not found" } });
    }
  });

  const init = (await request("ui/initialize", {
    protocolVersion: PROTOCOL,
    appInfo: { name: "Lactic", version: "1" },
    appCapabilities: { availableDisplayModes: ["inline"] },
  })) as { hostContext?: HostContext };
  host.context = init?.hostContext ?? {};
  onContext(host.context);
  post({ method: "ui/notifications/initialized", params: {} });

  // Tell the AI app how tall the card is, so it sizes the frame to fit.
  let last = "";
  const report = () => {
    const size = { width: Math.ceil(document.documentElement.scrollWidth), height: Math.ceil(document.documentElement.scrollHeight) };
    const key = `${size.width}x${size.height}`;
    if (key === last) return;
    last = key;
    post({ method: "ui/notifications/size-changed", params: size });
  };
  new ResizeObserver(report).observe(document.body);
  report();
  return host;
}
