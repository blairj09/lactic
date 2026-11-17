# Writing a Lactic plugin with an AI assistant

Give this file to your AI assistant (Claude, ChatGPT, Copilot, anything) along with the `sdk/` and `starter/` folders, then describe what you want, for example: *"Make me a Lactic plugin that shows my time above threshold as a ride field, and a table of my best 5-minute efforts after each ride."*

The rest of this file is written for the assistant.

---

## What you are building

A Lactic plugin is **one TypeScript file** bundled into a plain script and packed into a `.lacticplugin` file with a `manifest.json`. Start by copying `starter/` and editing `manifest.json` and `src/plugin.ts`. Build with `npm install && npm run build`. The rider adds `dist/<id>-<version>.lacticplugin` in Lactic under Settings → Plugins → Add plugin → From a file.

Types are in `sdk/src/index.ts`. Read it before writing code. For worked examples of ride fields and ride analyses, read the plugins in `catalog/` (each `src/plugin.ts`).

## Hard rules (the file is refused, or the call fails, if you break them)

- **No internet, no storage, no timers, no imports at run time, no DOM, no `fetch`, no `setTimeout`, no `console`.** The plugin runs in a bare JavaScript engine (QuickJS). Use only the language itself plus `Math`, `JSON`, arrays and objects. Bundle any helper code with esbuild; the output must be a plain script (`--format=iife`).
- **Register once:** call `definePlugin({ handlerName(input) { ... } })` at the top level. Every `entry` in the manifest must be a handler name you register.
- **Handlers are synchronous** and must return quickly: fields have **20 ms** per call (about once a second); ride analyses have **2 s** once per saved ride. Promises never run.
- **Output is `{ tree?, metrics? }` only.**
  - `tree` is built from the kit pieces in the SDK: `field`, `stat`, `text`, `sparkline`, `bars`, `meter`, `stack`, `button` (opens the plugin's own detail view only), `table`, `profile`, `values`, and the built-in blocks (`gauge`, `ring`, `zonebar`, `target`, `list`, `status`, `countdown`, `balance`). No HTML, no styles, no colours: colour comes only from `tone` (`good`, `warn`, `bad`, `muted`, `accent`) or `zone` (1 to 7, Lactic's zone ramp). Respect `KIT_LIMITS`.
  - `metrics` keys must be declared in the manifest's `publishes`; values are finite numbers or one of that metric's `choices`. **Never free text.**
- **Manifest:** `id` is lowercase letters, digits and dashes and must not contain "lactic"; `name` must not look like "Lactic". Unknown keys are refused. Never add `network`, `internet`, `sites`, `secrets` or `write`.
- **Permissions:** ask only for the groups you use in `permissions.read`: `live`, `rides`, `fitness`, `profile`, `recovery` (health data), `location` (GPS; the rider can decline it, so the plugin must still work without it). Ride analyses need `rides`.
- Inputs can be missing: any metric can be `null` (no power meter, no FTP set), and `input.ride` streams can be `null`. Handle every case and show a short muted `text` explaining what's needed instead of throwing.

## The two kinds of contribution

A plugin adds ride fields, ride page sections, or both. Nothing else: no cards, pages or tabs, and nothing on Today. If the rider asks for something else (a dashboard, a health or recovery card), say plugins can't add that and suggest a ride field or a section on the ride's page instead.

| Kind | Where it shows | Input | Budget |
|---|---|---|---|
| `fields` | A ride field (ride screen, overlay, free rides) | `input.metrics` (live numbers this second, plus profile) | 20 ms |
| `analyses` | A section on a saved ride's page | `input.ride` (whole ride) + `input.metrics` | 2 s, 128 KB |

Field handlers keep state between calls in ordinary variables (the starter counts seconds this way). All of a plugin's fields share one sandbox, so they can share that state.

### What a ride field shows

- **One number:** the first `field` (or `stat`) in the tree: value up to 12 characters, unit up to 8, `sub` line up to 40, plus at most one chart or block under it (the first `bars`, `sparkline`, `meter` or block in the tree).
- **A block:** a `gauge`, `ring`, `zonebar`, `target`, `list`, `status`, `countdown` or `balance` (see `BlockNode` in the SDK). You describe the numbers; Lactic draws the block to fit a phone field, a big field, a wide desktop field, the Zwift overlay strip and the ride's page. Every block except a `ring` without `text` shows the field's number itself, so it can be the whole tree:

  ```ts
  return { tree: { type: "gauge", value: kmh, min: 0, max: 60, unit: "km/h", decimals: 1, zones: [{ to: 25 }, { to: 40 }, { to: 60 }], ticks: 10, needle: true } };
  ```

  A `countdown` takes a moment (`until: input.now + 258`) and Lactic ticks it each second. In a ride field a `list` shows 5 rows and a `status` 20 characters. See `catalog/speedometer` for a worked example.
- **A few numbers:** a `values` node, `{ type: "values", unit: "W", items: [{ label: "5 s", value: "612" }, { label: "1 min", value: "402", tone: "good" }] }`, with 2 to 4 items, labels up to 8 characters and values up to 7. It takes the whole field; Lactic lays the numbers out to fit (a 2×2 block, one row in a wide field, a compact block on the overlay). Use it instead of several fields that show the same kind of number.

The rider can make any field wide (two slots) in the field editor; you don't need to do anything for that.

### Numbers and looks

- **Send numbers as numbers** where you can: `{ type: "field", label: "Speed", value: 34.2, unit: "km/h", decimals: 1 }`. Lactic writes them (thousands, decimals 0 to 3, `format: "duration"` for 724 → 12:04, `format: "percent"` for 0.72 → 72%) and converts metric units (km/h, km, m, kg, °C) for riders who use imperial. So always send metric. Text values still work.
- **Colour by meaning:** `tone` on the number, `subTone` on the line under it, or `zone: 1..7` to colour the number like a zone.
- **Change:** `change: { by: 1.1, since: "20 min", good: "down" }` adds ▲ or ▼ after the number, coloured by whether the move is good, and "+1.1 since 20 min" as the line under it unless you wrote one.
- **Emphasis:** `emphasis: "flash"` rings the field for 3 seconds when it starts (at most once every 30 s, so a new best can't strobe); `"quiet"` dims a field that doesn't matter right now.
- **Charts:** a `sparkline` takes `fill`, `band: [low, high]` (a shaded good range), `ref` (a dashed line), `marker: "last"` and fixed `min`/`max`. `bars` take `target` (a dashed line) and `highlight` (the index of the bar to stand out, e.g. the interval you're in).

### Field options

A field can offer the rider simple choices in the field editor, so one field covers what would otherwise be several:

```json
{ "id": "efforts", "title": "Best efforts", "entry": "efforts",
  "options": [{ "id": "durations", "label": "Durations", "choices": ["5 s", "1 min", "5 min", "20 min", "60 min"], "default": ["5 s", "1 min", "5 min", "20 min"], "max": 4 }] }
```

Up to 4 options a field; each has 2 to 12 `choices` (up to 16 characters), a `default` of 1 to `max` of them, and `max` (how many the rider may pick, 1 when left out). The handler gets the picks as `input.options.durations`, always an array of the choices, in the order listed. There's no free text. See `catalog/best-efforts` for a worked example. An analysis gets the whole ride at once: `ride.watts[i]` is the power at second `i * ride.stepSeconds`.

## Metric ids you can read

See `METRICS` in `sdk/src/index.ts`. Common ones: `power`, `power.3s`, `heart_rate`, `cadence`, `power.target`, `ride.elapsed` (live); `ride.np`, `ride.tss`, `ride.duration`, `ride.avg_hr` (rides); `fitness.ctl`, `fitness.atl`, `fitness.tsb` (fitness); `profile.ftp`, `profile.weight`, `profile.wkg` (profile).

## Checklist before you hand it over

1. `manifest.json` lists every handler as an `entry`, every published metric, and only the permissions used.
2. `npm run build` succeeds and prints the `.lacticplugin` path.
3. Every handler returns a sensible tree when inputs are `null`.
4. Nothing calls an API that doesn't exist in a bare engine (see the hard rules).
5. Tell the rider in one or two sentences what the plugin reads and adds, so they recognise it on Lactic's permission screen.
