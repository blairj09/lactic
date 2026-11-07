# Lactic app

Lactic is an open-source desktop app for structured cycling training: training plans, workouts on your smart trainer, recovery and health, and a coach you can bring your own AI to. Everything lives on your computer.

This folder is the app. `web/` holds the training engine, data code and screens, which started life as a single-user web app (Next.js on Supabase) and run here on local SQLite; `src/` is the desktop shell around them.

## How it's built

- **Tauri 2.** The window is a web view running the app's screens; a Rust core (`src-tauri/`) gives it what a browser can't:
  - `db.rs`: the SQLite database (one file in the app's data folder).
  - `secrets.rs`: API keys in the system keychain. The screens never read a key; requests carry a `keychain:<name>` placeholder that Rust swaps for the key on the way out (`net.rs`).
  - `net.rs`: HTTP without CORS, with streaming for AI replies.
  - `ble.rs`: Bluetooth LE through the OS (CoreBluetooth on macOS, WinRT on Windows, BlueZ on Linux), with one GATT operation at a time per device.
  - `mcp.rs`: the MCP server for external AI coaches (Claude Desktop, ChatGPT...), plus `lactic --mcp`, a stdio bridge.
  - `window.rs`: the always-on-top ride overlay, which floats over full-screen apps such as Zwift.
- **The screens in `web/`, close to unchanged.** `src/db/supa.ts` speaks enough of supabase-js over SQLite that the web app's loaders, actions and coach run as they are, on the same schema (`src/db/schema.ts`). Next's server pages run in the window (`src/app/server-page.tsx` resolves their async components), API routes are served in-process (`src/platform/fetch.ts`), and a few modules are swapped for desktop versions through aliases in `vite.config.ts` (the OpenRouter client, the top bar, `next/*`). `web/lib/supabase/*` hands out the local client.- **The coach can look after the app too.** `src/support/` gives the built-in coach and MCP clients app tools (registered through `web/lib/coach/app-tools.ts`): `check_app` reads Bluetooth gear, intervals.icu, Apple Health and the coach's setup plus a short activity log (`src/support/log.ts`, keys stripped) and a troubleshooting guide; `test_connection`, `sync_now`, `reconnect_device` and `scan_for_devices` try things without changing a setting; `propose_app_change` suggests a setting the rider applies with a button. No tool sees an API key, and during a ride only `check_app` runs.

## Running it

```sh
cd app
npm ci
npm run dev       # in a browser at http://localhost:1420 (SQLite in the browser, simulated sensors)
npx tauri dev     # the desktop app (needs Rust: https://rustup.rs)
npx tauri build   # a release build in src-tauri/target/release/bundle
```

Checks: `npm run typecheck && npm run lint && npm test`, and `cargo check` in `src-tauri`.

## Downloads

Releases are on the [Releases page](https://github.com/blairj09/lactic/releases). To ship one, bump the version in `app/package.json`, `app/src-tauri/tauri.conf.json` and `app/src-tauri/Cargo.toml` and merge: when `main` has a version with no release yet, the **App** workflow builds the apps and publishes the release under its v tag (pushing a `v*` tag works too). Every push to `main` also builds them and attaches them to the run: **Lactic-macOS** (.dmg, Apple silicon), **Lactic-Windows** (installer .exe) and **Lactic-Linux** (AppImage and .deb). They're unsigned for now:

- **macOS:** drag Lactic to Applications, then run `xattr -cr /Applications/Lactic.app` once.
- **Windows:** SmartScreen warns about an unknown publisher; choose More info → Run anyway.
- **Linux:** `chmod +x Lactic_*.AppImage` and run it, or `sudo apt install ./Lactic_*.deb`. Bluetooth needs BlueZ; keys are stored through the Secret Service (GNOME Keyring or KWallet).

Simulated gear (a virtual trainer, heart rate strap, power meter and scale) is a testing aid: it's on by default in `npm run dev` and switchable in Settings in development builds.
