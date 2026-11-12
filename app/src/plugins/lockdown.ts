// Second layer for the plugin worker: once the engine is loaded, take away the worker's own network,
// storage and worker APIs, on the global and anywhere up its prototype chain. Plugin code runs in
// QuickJS and never sees these anyway; this only matters if something ever got out of QuickJS.
// `import()` can't be removed from JavaScript, so the app's CSP has to cover that (see selfcheck.ts).

export const LOCKED = [
  "fetch", "XMLHttpRequest", "WebSocket", "WebSocketStream", "WebTransport", "EventSource", "importScripts",
  "indexedDB", "caches", "BroadcastChannel", "Worker", "SharedWorker", "navigator", "Request", "RTCPeerConnection",
];

export function lockDown(scope: object) {
  for (const key of LOCKED) {
    for (let o: object | null = scope; o; o = Object.getPrototypeOf(o)) {
      if (o !== scope && !Object.prototype.hasOwnProperty.call(o, key)) continue;
      try {
        Object.defineProperty(o, key, { value: undefined, writable: false, configurable: false });
      } catch {
        /* not present, or already locked */
      }
    }
  }
}
