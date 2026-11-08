# Lactic

Open-source desktop app for structured cycling training (Tauri 2 + React, SQLite on the rider's computer). Landing page in `site/`. See `app/README.md` for how the app is built and run.

- Before pushing app changes, in `app/`: `npm run typecheck && npm run lint && npm test && npx vite build`, and `cargo check` in `app/src-tauri` when Rust changed.
- The engine (`app/web/lib/engine`) owns every number. The AI coach only reads engine outputs through tools and proposes changes; it never computes metrics.
- Keep `app/web/lib/engine`, `app/web/lib/fit`, `app/web/lib/scale/bodypod.ts`, `app/web/lib/ble/protocol.ts`, `app/web/lib/ble/power-match.ts` and `app/web/lib/ride/` free of browser and Node APIs so they run anywhere and test in Vitest.
- Bluetooth goes through `navigator.bluetooth` (polyfilled in `app/src/bluetooth/` on the Rust core); GATT writes go through `SensorHub`'s queue, one operation at a time.
- Support riding with Zwift open: Lactic holds trainer control; Zwift only reads power, cadence and HR.
- The database schema (`app/src/db/schema.ts`) migrates additively on start: add tables and columns, never drop or rename. Every table has a UUID `id` and `updated_at` so sync can come later.
- Secrets live in the OS keychain only. The UI sends `keychain:<name>` placeholders and Rust swaps in the real value.
- Rider-facing app changes add a plain-words line under **Next** in `app/whats-new.md` (the in-app "What's new"); skip CI, refactors and site changes. A release that bumps the version renames **Next** to that version.
