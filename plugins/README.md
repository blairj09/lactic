# Lactic plugins

Plugins add cards to Today and fields to the ride screen in **Lactic Modular**, the test build of the modular UI. They aren't in the regular Lactic app yet.

- `sdk/` is `@lactic/sdk`: TypeScript types for the plugin API, the kit, metric ids and the manifest, `definePlugin()`, and `lactic-pack`, which turns a manifest and a built bundle into a `.lacticplugin` file.
- `starter/` is a small working plugin (Sweet Spot) to copy from.

## What a plugin can do

There are three kinds of contribution:

- **widgets**: cards on Today.
- **fields**: ride screen fields.
- **analyses**: these run once on a saved ride (never during one) and draw on that ride's page. They get the whole ride as `input.ride`: power, heart rate, cadence and target samples, the intervals as ridden, and the GPS track only if the rider ticked "where you ride". They need `"rides"` in `permissions.read`. They have 2 seconds and can return up to 128 KB, and can use the `table` and `profile` kit pieces.

A plugin is plain JavaScript that runs in a sandbox (QuickJS compiled to WebAssembly, in a worker). It has no internet, no storage, no timers, no DOM and no access to the app. It gets the metrics the rider approved, as numbers, and returns two things:

- `tree`: what to draw, built from Lactic's kit (field, stat, text, sparkline, bars, meter, stack, button). Lactic draws it in its own style, inside a frame that names the plugin.
- `metrics`: numbers, or one of the manifest's fixed choices, that it publishes under `plugin.<id>.<name>`. Free text is never accepted.

Each call has 20 ms. A plugin that runs late shows "–", and it is switched off after 5 late calls in a row or 3 crashes. It can't stall a ride or the trainer.

## Permissions

`permissions.read` lists the groups the plugin wants: `live`, `rides`, `fitness`, `profile`, `recovery` (health data), `location`. The rider sees these in plain words before adding it. Location is a separate tick that starts off, so a plugin has to work without it. Asking for `network`, `secrets` or `write` gets the file refused.

## Build and try

```sh
cd plugins/starter
npm install
npm run build         # dist/sweet-spot-0.1.0.lacticplugin
```

In Lactic Modular, go to Settings → Plugins → Add a plugin… and pick the file. To update a plugin, add the newer file. Lactic shows what changed and asks first.
