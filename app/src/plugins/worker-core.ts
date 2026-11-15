// The worker's message handling, without the worker. worker.ts wires it to `self`; tests drive it
// directly. No browser or Node APIs.
import type { QuickJSWASMModule } from "quickjs-emscripten-core";
import type { HostToWorker, WorkerToHost } from "./protocol";
import { SandboxRuntime } from "./runtime";

export interface WorkerState {
  runtime: SandboxRuntime | null;
}

export function handleMessage(state: WorkerState, module: QuickJSWASMModule, msg: HostToWorker, post: (m: WorkerToHost) => void) {
  try {
    if (msg.type === "load") {
      state.runtime?.dispose();
      state.runtime = new SandboxRuntime(module, msg.limits);
      post({ type: "loaded", ...state.runtime.load(msg.source, msg.entries) });
    } else if (msg.type === "call") {
      if (!state.runtime) {
        post({ type: "result", seq: msg.seq, ok: false, failure: { kind: "not-loaded", message: "plugin is not loaded" }, ms: 0, restarted: false });
        return;
      }
      post({ type: "result", seq: msg.seq, ...state.runtime.call(msg.entry, msg.input, msg.budget) });
    }
  } catch {
    // The engine itself broke (not just the plugin). Nothing in this worker can be trusted now: say so,
    // and the host terminates it and starts a fresh one.
    state.runtime = null;
    post({ type: "fatal" });
  }
}
