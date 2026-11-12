// Start a real plugin worker. Kept apart from host.ts so the host can be tested with a fake worker.
//
// The worker starts from a one-line blob: module that imports the real worker script. A worker
// started from a blob: URL takes on the app window's Content Security Policy, while one started from
// its own file only gets whatever headers that file was served with (often none). So the app's
// policy (no internet, only Lactic's own scripts) covers the worker too: a second layer behind
// QuickJS, which already gives plugin code no way to load or send anything.
import type { WorkerLike } from "./host";
import workerUrl from "./worker.ts?worker&url";
import probeUrl from "./probe-worker.ts?worker&url";

function startModuleWorker(scriptUrl: string, name: string): Worker {
  const abs = new URL(scriptUrl, location.href).href;
  const blob = URL.createObjectURL(new Blob([`import ${JSON.stringify(abs)};`], { type: "text/javascript" }));
  try {
    return new Worker(blob, { type: "module", name });
  } finally {
    // The worker has fetched its script once construction returns; the blob is no longer needed.
    setTimeout(() => URL.revokeObjectURL(blob), 30_000);
  }
}

export function createPluginWorker(): WorkerLike {
  return startModuleWorker(workerUrl, "lactic-plugin") as unknown as WorkerLike;
}

/** The self-check's probe worker, started exactly the same way (selfcheck.ts). */
export function createProbeWorker(): Worker {
  return startModuleWorker(probeUrl, "lactic-plugin-probe");
}
