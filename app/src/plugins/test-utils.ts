// Shared helpers for the sandbox tests: a real QuickJS engine (Node build) and an in-process fake
// worker that drives it the same way worker.ts does.
import { newQuickJSWASMModuleFromVariant, type QuickJSWASMModule } from "quickjs-emscripten-core";
import releaseSync from "@jitl/quickjs-wasmfile-release-sync";
import type { WorkerLike } from "./host";
import type { HostToWorker, WorkerToHost } from "./protocol";
import { handleMessage, type WorkerState } from "./worker-core";

let mod: Promise<QuickJSWASMModule> | null = null;
export function quickjs(): Promise<QuickJSWASMModule> {
  mod ??= newQuickJSWASMModuleFromVariant(releaseSync);
  return mod;
}

/** Runs worker-core in this thread, delivering messages asynchronously like a real worker. */
export class InProcessWorker implements WorkerLike {
  onmessage: ((ev: { data: WorkerToHost }) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  terminated = false;
  private state: WorkerState = { runtime: null };
  private module: Promise<QuickJSWASMModule>;
  /** Pass a shared engine, or null for a fresh one of its own (as a real worker has). */
  constructor(module: QuickJSWASMModule | null) {
    this.module = module ? Promise.resolve(module) : newQuickJSWASMModuleFromVariant(releaseSync);
  }
  postMessage(msg: HostToWorker) {
    setTimeout(async () => {
      const mod = await this.module;
      if (this.terminated) return;
      handleMessage(this.state, mod, msg, (out) => {
        setTimeout(() => {
          if (!this.terminated) this.onmessage?.({ data: out });
        }, 0);
      });
    }, 0);
  }
  terminate() {
    this.terminated = true;
    try {
      this.state.runtime?.dispose();
    } catch {
      /* a broken engine is just dropped */
    }
  }
}

/** A worker that never answers calls (a stuck engine), but loads fine. */
export class StuckWorker implements WorkerLike {
  onmessage: ((ev: { data: WorkerToHost }) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  terminated = false;
  postMessage(msg: HostToWorker) {
    if (msg.type === "load") setTimeout(() => this.onmessage?.({ data: { type: "loaded", ok: true, ms: 1 } }), 0);
  }
  terminate() {
    this.terminated = true;
  }
}
