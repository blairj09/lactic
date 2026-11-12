# Plugin sandbox

Third-party plugin code runs here and nowhere else. Design: the modular UI design doc, "Security and UX review" (S1 to S4).

```
main thread                                 plugin worker (one per plugin)
PluginHost (host.ts)  ── load / call ──▶    worker.ts → worker-core.ts → SandboxRuntime (runtime.ts)
  trims input to approved groups                QuickJS in WebAssembly: plain JavaScript only,
  watchdog: kills a worker that hangs           no fetch, DOM, storage, timers, imports or Tauri
  crash / overrun counting, restart, off        interrupt at the tick budget, heap and stack limits
  validates output (validate.ts + SDK      ◀── result: the handler's output as a JSON string
  validateKit) before anything uses it
```

- **Plugin API (v1):** the bundle calls `lactic.register({ handlerName(input) { return { tree, metrics } } })` once. `input` is `{ metrics, now }` with only the metrics the rider approved, as numbers. Handlers are synchronous; promise work never runs.
- **Out:** `tree` is an SDK kit tree (`@shared/sdk` `validateKit`, plugin buttons only open their own detail). `metrics` are numbers or the manifest's fixed choices, never free text, filed as `plugin.<id>.<name>`.
- **Manifest:** `manifest.ts`. Strict; refuses internet, secrets, writes, unknown keys and names that look like Lactic.
- **Limits** (`protocol.ts` `DEFAULT_LIMITS`, `host.ts` `DEFAULT_POLICY`): 20 ms a tick, 250 ms to load, 16 MB heap, 64 KB stack, 32 KB output; worker killed 500 ms past the budget; off after 3 crashes or 5 overruns in a row. Calls never queue: a tick that arrives while the last is running gets "busy".
- **Tests:** `*.test.ts` run the real engine in Vitest with the hostile `fixtures/escape-plugin.js`. `node scripts/plugin-smoke/run.cjs` runs the same plugin in Chromium through a real module worker under the app's production CSP.
- Not here yet: install and permission UI, storage of plugin metrics, coach tools, any network (never in v1).
