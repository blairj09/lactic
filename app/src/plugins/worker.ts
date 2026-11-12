// The plugin worker. One worker per plugin, off the main thread, so a plugin can never stall the ride
// screen or trainer control. QuickJS interrupts a handler that runs over its budget; if the whole
// worker ever stops answering, the main thread terminates it (see host.ts).
//
// Tauri only injects its IPC bridge into windows, not workers, so nothing here can reach Rust. As a
// second layer, the worker drops its own network and storage APIs once the engine has loaded.
import { newQuickJSWASMModuleFromVariant, newVariant, type QuickJSWASMModule } from "quickjs-emscripten-core";
import releaseSync from "@jitl/quickjs-wasmfile-release-sync";
import wasmUrl from "@jitl/quickjs-wasmfile-release-sync/wasm?url";
import type { HostToWorker, WorkerToHost } from "./protocol";
import { handleMessage, type WorkerState } from "./worker-core";
import { lockDown } from "./lockdown";

// The app's tsconfig uses the DOM lib, so describe just the worker scope this file touches.
declare const self: typeof globalThis & {
  postMessage(msg: WorkerToHost): void;
  onmessage: ((ev: MessageEvent<HostToWorker>) => void) | null;
};

// The worker runs from a blob: wrapper (spawn.ts), so a bare "/assets/…" path has no base: resolve it
// against this script's own address.
let modulePromise: Promise<QuickJSWASMModule> | null = null;
const state: WorkerState = { runtime: null };

self.onmessage = async (ev: MessageEvent<HostToWorker>) => {
  if (!modulePromise) {
    modulePromise = newQuickJSWASMModuleFromVariant(newVariant(releaseSync, { wasmLocation: new URL(wasmUrl, import.meta.url).href })).then((m) => {
      lockDown(self);
      return m;
    });
  }
  let mod: QuickJSWASMModule;
  try {
    mod = await modulePromise;
  } catch {
    self.postMessage({ type: "fatal" });
    return;
  }
  handleMessage(state, mod, ev.data, (m) => self.postMessage(m));
};
