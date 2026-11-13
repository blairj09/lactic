# Writing a Lactic plugin with an AI assistant

Give this file to your AI assistant (Claude, ChatGPT, Copilot, anything) along with the `sdk/` and `starter/` folders, then describe what you want, for example: *"Make me a Lactic plugin that shows my time above threshold as a ride field, and a table of my best 5-minute efforts after each ride."*

The rest of this file is written for the assistant.

---

## What you are building

A Lactic plugin is **one TypeScript file** bundled into a plain script and packed into a `.lacticplugin` file with a `manifest.json`. Start by copying `starter/` and editing `manifest.json` and `src/plugin.ts`. Build with `npm install && npm run build`. The rider adds `dist/<id>-<version>.lacticplugin` in Lactic Modular under Settings → Plugins → Add from a file.

Types are in `sdk/src/index.ts`. Read it before writing code.

## Hard rules (the file is refused, or the call fails, if you break them)

- **No internet, no storage, no timers, no imports at run time, no DOM, no `fetch`, no `setTimeout`, no `console`.** The plugin runs in a bare JavaScript engine (QuickJS). Use only the language itself plus `Math`, `JSON`, arrays and objects. Bundle any helper code with esbuild; the output must be a plain script (`--format=iife`).
- **Register once:** call `definePlugin({ handlerName(input) { ... } })` at the top level. Every `entry` in the manifest must be a handler name you register.
- **Handlers are synchronous** and must return quickly: widgets and fields have **20 ms** per call (about once a second); ride analyses have **2 s** once per saved ride. Promises never run.
- **Output is `{ tree?, metrics? }` only.**
  - `tree` is built from the kit pieces in the SDK: `field`, `stat`, `text`, `sparkline`, `bars`, `meter`, `stack`, `button` (opens the plugin's own detail view only), `table`, `profile`. No HTML, no styles, no colours beyond `tone`. Respect `KIT_LIMITS`.
  - `metrics` keys must be declared in the manifest's `publishes`; values are finite numbers or one of that metric's `choices`. **Never free text.**
- **Manifest:** `id` is lowercase letters, digits and dashes and must not contain "lactic"; `name` must not look like "Lactic". Unknown keys are refused. Never add `network`, `internet`, `sites`, `secrets` or `write`.
- **Permissions:** ask only for the groups you use in `permissions.read`: `live`, `rides`, `fitness`, `profile`, `recovery` (health data), `location` (GPS; the rider can decline it, so the plugin must still work without it). Ride analyses need `rides`.
- Inputs can be missing: any metric can be `null` (no power meter, no FTP set), and `input.ride` streams can be `null`. Handle every case and show a short muted `text` explaining what's needed instead of throwing.

## The three kinds of contribution

| Kind | Where it shows | Input | Budget |
|---|---|---|---|
| `fields` | Ride screen field | `input.metrics` (live numbers this second, plus profile) | 20 ms |
| `widgets` | A card on Today | `input.metrics` (day numbers) | 20 ms |
| `analyses` | A section on a saved ride's page | `input.ride` (whole ride) + `input.metrics` | 2 s, 128 KB |

Field and widget handlers keep state between calls in ordinary variables (the starter counts seconds this way). An analysis gets the whole ride at once: `ride.watts[i]` is the power at second `i * ride.stepSeconds`.

## Metric ids you can read

See `METRICS` in `sdk/src/index.ts`. Common ones: `power`, `power.3s`, `heart_rate`, `cadence`, `power.target`, `ride.elapsed` (live); `ride.np`, `ride.tss`, `ride.duration`, `ride.avg_hr` (rides); `fitness.ctl`, `fitness.atl`, `fitness.tsb` (fitness); `profile.ftp`, `profile.weight`, `profile.wkg` (profile).

## Checklist before you hand it over

1. `manifest.json` lists every handler as an `entry`, every published metric, and only the permissions used.
2. `npm run build` succeeds and prints the `.lacticplugin` path.
3. Every handler returns a sensible tree when inputs are `null`.
4. Nothing calls an API that doesn't exist in a bare engine (see the hard rules).
5. Tell the rider in one or two sentences what the plugin reads and adds, so they recognise it on Lactic's permission screen.
