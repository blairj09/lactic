# Lactic app

Lactic is an open-source desktop app for structured cycling training: training plans, workouts on your smart trainer, recovery and health, and a coach you can bring your own AI to. Everything lives on your computer.

This folder is the app. `web/` holds the training engine, data code and screens, which started life as a single-user web app (Next.js on Supabase) and run here on local SQLite; `src/` is the desktop shell around them.

## How it's built

- **Tauri 2.** The window is a web view running the app's screens; a Rust core (`src-tauri/`) gives it what a browser can't:
  - `db.rs`: the SQLite database (one file in the app's data folder).
  - `secrets.rs`: API keys in the system keychain. The screens never read a key; requests carry a `keychain:<name>` placeholder that Rust swaps for the key on the way out (`net.rs`).
  - `net.rs`: HTTP without CORS, with streaming for AI replies.
  - `strava.rs`: Strava sign-in (a one-shot listener on 127.0.0.1 catches the browser's redirect) and token refreshes, through the relay at lactic.fit/api/strava, which holds Strava's client secret since an open-source app can't ship one. Tokens stay in the keychain; uploads carry `keychain:strava` (`src/integrations/strava.ts`).
  - `ble.rs`: Bluetooth LE through the OS (CoreBluetooth on macOS, WinRT on Windows, BlueZ on Linux), with one GATT operation at a time per device.
  - `mcp.rs`: the MCP server for external AI coaches (Claude Desktop, ChatGPT...), plus `lactic --mcp`, a stdio bridge.
  - `window.rs`: the always-on-top ride overlay, which stays on top of other windows, full-screen apps included.
  - `sync.rs` and `phone.rs`: keeping a paired iPhone in step (see iPhone below).
- **The screens in `web/`, close to unchanged.** `src/db/supa.ts` speaks enough of supabase-js over SQLite that the web app's loaders, actions and coach run as they are, on the same schema (`src/db/schema.ts`). Next's server pages run in the window (`src/app/server-page.tsx` resolves their async components), API routes are served in-process (`src/platform/fetch.ts`), and a few modules are swapped for desktop versions through aliases in `vite.config.ts` (the OpenRouter client, the top bar, `next/*`). `web/lib/supabase/*` hands out the local client.- **The coach can look after the app too.** `src/support/` gives the built-in coach and MCP clients app tools (registered through `web/lib/coach/app-tools.ts`): `check_app` reads Bluetooth gear, intervals.icu, Apple Health and the coach's setup plus a short activity log (`src/support/log.ts`, keys stripped) and a troubleshooting guide; `test_connection`, `sync_now`, `reconnect_device` and `scan_for_devices` try things without changing a setting; `propose_app_change` suggests a setting the rider applies with a button. No tool sees an API key, and during a ride only `check_app` runs.

## Running it

```sh
cd app
npm ci
npm run dev       # in a browser at http://localhost:1420 (SQLite in the browser, simulated sensors)
npx tauri dev     # the desktop app (needs Rust: https://rustup.rs)
npm run tauri:preview  # the desktop app as Lactic Preview, with its own data (Mac and Linux)
npm run tauri:modular  # the desktop app as Lactic Modular (modular-ui branch work), with its own data again
npx tauri build   # a release build in src-tauri/target/release/bundle
```

`npx tauri dev` uses the real app's data folder and keychain item; on a computer you also ride on, use `npm run tauri:preview` so a dev build never touches your rides.

Checks: `npm run typecheck && npm run lint && npm test`, and `cargo check` in `src-tauri`.

Coach evals: `npm run eval:coach` scores how well a model coaches inside Lactic, across providers. See [evals/README.md](evals/README.md).

## iPhone

The iPhone app is this same app built for iOS (`npx tauri ios dev` on a Mac with Xcode; CI: `.github/workflows/ios.yml`, which builds for the simulator on pull requests that touch the Rust side and, with the App Store Connect key, uploads a signed build from main to TestFlight; run it by hand on a branch to TestFlight that branch). On the phone, `src/phone/` replaces the background jobs and `src-tauri/plugins/lactic-phone/` (Swift) does what only iOS can:

- **Apple Health.** Reads sleep, HRV, resting heart rate, breathing, wrist temperature, heart rate, energy, steps and VO2 max in the Lactic Shortcut's column format, so `web/lib/engine/health-import.ts` reads both alike. Background delivery wakes the app when new sleep, HRV or resting heart rate lands; the wake sends the data straight to the computer if it can and queues it for the app either way. Rides are written back to Health as cycling workouts (`web/lib/engine/health-export.ts`), skipping any that Zwift, a bike computer or a watch already put there.
- **Pairing and sync.** The computer stays the source of truth. Settings → iPhone on the computer shows a QR code (a `https://lactic.fit/pair#...` link holding a fresh AES-256 key, the computer's local addresses and a port); the phone scans it and keeps the key in the iOS keychain, the computer in its own (`phone:<device>`). From then on the phone posts sealed requests (AES-GCM) to `phone.rs` over the local network, which listens only while a phone is paired. `sync.rs` logs each changed row's key with triggers; one exchange applies the phone's changes last-writer-wins on `updated_at` and answers with a page of the computer's (a snapshot first). Device-specific settings (`health.folder`, `bluetooth.*`, `phone.*` and a few more) stay on their device, and the phone leaves intervals.icu to the computer.
- **Rides** run on the phone with the same ride screen and Bluetooth code (btleplug uses CoreBluetooth on iOS).

## Downloads

Releases are on the [Releases page](https://github.com/blairj09/lactic/releases). To ship one, bump the version in `app/package.json`, `app/src-tauri/tauri.conf.json` and `app/src-tauri/Cargo.toml`, rename **Next** in `app/whats-new.md` to that version, and merge: when `main` has a version with no release yet, the **App** workflow builds the apps and publishes the release under its v tag (pushing a `v*` tag works too). A release run attaches the apps to the run as **Lactic-macOS** (universal .dmg for Apple silicon and Intel), **Lactic-Windows** (installer .exe) and **Lactic-Linux** (AppImage and .deb); every other run builds Lactic Preview (below). The Mac app is signed and notarized (see Mac signing below); Windows and Linux aren't signed yet:

- **macOS:** drag Lactic to Applications and open it.
- **Windows:** SmartScreen warns about an unknown publisher; choose More info → Run anyway.
- **Linux:** `chmod +x Lactic_*.AppImage` and run it, or `sudo apt install ./Lactic_*.deb`. Bluetooth needs BlueZ; keys are stored through the Secret Service (GNOME Keyring or KWallet).

**Testing a change: Lactic Preview.** Pull requests and every push to `main` that isn't a release build **Lactic Preview** (`src-tauri/tauri.preview.conf.json`): the same app under its own name, bundle id (`fit.lactic.preview`), orange icon, data folder, keychain item, MCP port and Claude Desktop entry (`lactic-preview`), with Preview in place of Beta beside the name. It installs beside Lactic, so testing never touches real rides, and needs no version bump.

- **Latest `main`:** each push to `main` replaces the rolling [`preview`](https://github.com/blairj09/lactic/releases/tag/preview) pre-release (version `<version>-preview.<run>`, notes from **Next** in `whats-new.md`). An installed Preview updates itself from it like the real app does from releases. It's a pre-release, never "latest", so the site and the release updater don't see it.
- **A pull request before it's merged:** its run's artifacts are **Lactic-macOS-Preview**, **Lactic-Windows-Preview** and **Lactic-Linux-Preview**.
- **On a Mac, one command** installs or refreshes `/Applications/Lactic Preview.app` and opens it: `app/scripts/try-preview.sh` for the latest `main`, `app/scripts/try-preview.sh 72` for pull request #72, or a branch name. Pull request builds need the GitHub CLI (`brew install gh && gh auth login`). Without a clone: `curl -fsSL https://raw.githubusercontent.com/blairj09/lactic/main/app/scripts/try-preview.sh | bash -s -- 72`.

**Testing the modular UI: Lactic Modular.** The customizable layouts, ride data fields and plugins work lives on the long-lived `modular-ui` branch, not `main`; its pull requests target `modular-ui`. Pushes to `modular-ui` and pull requests into it build **Lactic Modular** (`src-tauri/tauri.modular.conf.json`): a third app with its own name, bundle id (`fit.lactic.modular`), purple icon, data folder, keychain item, MCP port (47675), phone link port (47680) and Claude Desktop entry (`lactic-modular`), with Modular beside the name. Each push to `modular-ui` replaces the rolling [`modular`](https://github.com/blairj09/lactic/releases/tag/modular) pre-release, which installed copies update from; pull request artifacts are **Lactic-macOS-Modular** and so on. On a Mac: `curl -fsSL https://raw.githubusercontent.com/blairj09/lactic/modular-ui/app/scripts/try-preview.sh | bash -s -- --modular` (add a pull request number after `--modular` for that pull request). Merge `main` into `modular-ui` regularly so it doesn't drift.

Preview builds come from this repository's workflows, so they're signed for updates (and, with the Apple secrets, signed and notarized) just like releases.

**Updates.** Installed copies check `releases/latest/download/latest.json` on every start and every 6 hours (`src/updates/`, `tauri-plugin-updater`), show a card when there's a newer version listing what's new (the release's section of `app/whats-new.md`, carried in `latest.json`; not on the Ride screen), and on "Update and restart" download it, verify its signature against the public key in `tauri.conf.json`, install it and restart; after the restart an "Updated to X" card lists the changes once. Check for Updates… is in the Lactic menu on a Mac and in Settings → About everywhere. The release job signs each build with the `TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` secrets and writes `latest.json` with `app/scripts/update-manifest.mjs`; without the key (forks), builds skip the update files. Losing the private key means installed copies can't update anymore, so keep a copy somewhere safe. On a Mac the updater replaces the app in place, and its download carries no quarantine flag, so updates install without any Gatekeeper prompt.

**Mac signing.** With these repository secrets the App workflow signs the Mac app with Lactic's Developer ID (hardened runtime), has Apple notarize it, and staples the tickets to the app and the .dmg, so it opens with no Terminal step and macOS keychain "Always Allow" carries over between updates (the keychain trusts the signer, not one build). Without them (forks) the app gets the ad-hoc signature and needs the `xattr` step.

| Secret | What it is |
| --- | --- |
| `APPLE_CERTIFICATE` | The "Developer ID Application" certificate with its private key, exported from Keychain Access as a .p12, base64 (`base64 -i cert.p12 \| pbcopy`) |
| `APPLE_CERTIFICATE_PASSWORD` | The password set when exporting the .p12 |
| `APPLE_API_KEY` | App Store Connect API key ID (Users and Access → Integrations → Team Keys, Developer access) |
| `APPLE_API_ISSUER` | The Issuer ID shown above that key list |
| `APPLE_API_KEY_P8` | The contents of the downloaded `AuthKey_<id>.p8` |

The certificate step finds the signing identity in the .p12 itself; Tauri notarizes and staples the app, and the workflow then notarizes the .dmg and checks both with `spctl`.

Simulated gear (a virtual trainer, heart rate strap, power meter and scale) is a testing aid: it's on by default in `npm run dev` and switchable in Settings in development builds.
