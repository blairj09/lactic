// Start a real plugin worker. Kept apart from host.ts so the host can be tested with a fake worker.
import type { WorkerLike } from "./host";

export function createPluginWorker(): WorkerLike {
  return new Worker(new URL("./worker.ts", import.meta.url), { type: "module", name: "lactic-plugin" }) as unknown as WorkerLike;
}
