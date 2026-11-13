// Sandbox self-check only (selfcheck.ts): a worker set up like the plugin worker (same origin, same
// lock-down) that tries the worker's own ways out, as code that had escaped QuickJS would. Each probe
// reports "blocked" or what it reached. Nothing here runs plugin code.
import { lockDown } from "./lockdown";

declare const self: typeof globalThis & { postMessage(msg: unknown): void };

const within = <T,>(p: Promise<T>, ms = 4000) => Promise.race([p, new Promise<never>((_, no) => setTimeout(() => no(new Error("no answer")), ms))]);

async function probe(fn: () => Promise<unknown>): Promise<string> {
  try {
    const r = await within(fn());
    let shown: string;
    try {
      shown = typeof r === "object" && r !== null ? `a ${Object.prototype.toString.call(r)}` : String(r);
    } catch {
      shown = typeof r;
    }
    return `reached (${shown.slice(0, 60)})`;
  } catch (e) {
    return `blocked (${String((e as Error)?.message ?? e).slice(0, 80)})`;
  }
}

// Kept before the lock-down so the probes can try it the way escaped code would.
const scopeProto = Object.getPrototypeOf(self) as Record<string, unknown>;

lockDown(self);

void (async () => {
  const g = self as unknown as Record<string, unknown>;
  const fetchFn = (g.fetch ?? scopeProto.fetch) as typeof fetch | undefined;
  const out: Record<string, string> = {
    fetchInternet: await probe(async () => (fetchFn ? (await fetchFn.call(self, "https://example.com/")).status : Promise.reject(new Error("fetch removed")))),
    fetchTauriIpc: await probe(async () => (fetchFn ? (await fetchFn.call(self, "ipc://localhost/plugin%3Aapp%7Cversion", { method: "POST", body: "{}" })).status : Promise.reject(new Error("fetch removed")))),
    importInternet: await probe(() => import(/* @vite-ignore */ "https://example.com/x.js".toString())),
    // data: isn't in the app's script-src, so this is blocked only when the app's CSP covers the worker.
    cspCoversWorker: await probe(() => import(/* @vite-ignore */ "data:text/javascript,export default 1".toString())),
    webSocket: await probe(async () => (typeof g.WebSocket === "function" ? "WebSocket left" : Promise.reject(new Error("WebSocket removed")))),
    storage: await probe(async () => {
      const nav = g.navigator as { storage?: { getDirectory?: () => Promise<unknown> } } | undefined;
      if (!nav?.storage?.getDirectory) throw new Error("navigator removed");
      return nav.storage.getDirectory();
    }),
    indexedDB: await probe(async () => (g.indexedDB ? "indexedDB left" : Promise.reject(new Error("indexedDB removed")))),
    tauri: await probe(async () => ("__TAURI_INTERNALS__" in g || "__TAURI__" in g ? "Tauri bridge present" : Promise.reject(new Error("no Tauri bridge")))),
  };
  self.postMessage(out);
})();
