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
- **Text:** manifest names, labels and descriptions, and every string a plugin returns, are refused if they hold hidden characters (`@shared/sdk` `hasHiddenText`): control and format characters, Unicode tag characters (invisible to the rider but read by AI models), variation selectors, fillers, separators, private-use and unassigned code points. Returned kit text may use the joiner and variation selectors emoji need; names may not.
- **Ride analyses:** manifest `contributes.analyses` (needs `rides`). `host.analyze(entry, ride, metrics)` runs one with `ANALYSIS_BUDGET` (2 s, 128 KB) on a saved ride, never during one; `ride-input.ts` cuts the ride to the grant (GPS only with `location`, at most 20,000 samples). `analyze.ts` runs each once per ride and package and stores the checked tree in `plugin_analyses`; kit adds `table` and `profile` for them.
- **Out:** `tree` is an SDK kit tree (`@shared/sdk` `validateKit`, plugin buttons only open their own detail). `metrics` are numbers or the manifest's fixed choices, never free text, filed as `plugin.<id>.<name>`.
- **Manifest:** `manifest.ts`. Strict; refuses internet, secrets, writes, unknown keys and names that look like Lactic.
- **Limits** (`protocol.ts` `DEFAULT_LIMITS`, `host.ts` `DEFAULT_POLICY`): 20 ms a tick, 250 ms to load, 16 MB heap, 64 KB stack, 32 KB output; worker killed 500 ms past the budget; off after 3 crashes or 5 overruns in a row. Calls never queue: a tick that arrives while the last is running gets "busy". A call that finishes but took longer than its budget (one long native step QuickJS can't interrupt) counts as a timeout, not a result.
- **Worker layer:** `spawn.ts` starts each worker from a one-line `blob:` module that imports the real script, so the app window's CSP covers the worker (a worker started from its own file gets only its file's headers, usually none). `lockdown.ts` then removes the worker's network, storage and worker APIs. Both only matter if code ever got out of QuickJS.
- **Tests:** `*.test.ts` run the real engine in Vitest with the hostile `fixtures/escape-plugin.js`. `selfcheck.ts` runs the same plugin through the real worker, plus `probe-worker.ts` (what escaped code could reach from a worker), and lists pass/fail: in Lactic Modular it's **Settings → Plugin sandbox check**, and `node scripts/plugin-smoke/run.cjs` runs it in Chromium under the app's production CSP.
- Not here yet: install and permission UI, storage of plugin metrics, coach tools, any network (never in v1).
