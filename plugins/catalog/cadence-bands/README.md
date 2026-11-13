# Cadence Bands

Your cadence smoothed over 30 seconds with a trend line under it, and after the ride the time in each cadence band plus time coasting.

- **Adds:** a ride field, **Cadence 30 s**; a section on each ride's page, **Cadence bands**.
- **Reads:** live ride numbers, your saved rides.
- **How it works:** A 30-second moving average; one trend point every 10 seconds.
- **Good example of:** A `sparkline` in a ride field; labelled `bars`.

The code, with the sport science explained, is in [`src/plugin.ts`](src/plugin.ts). To add it, download [`cadence-bands-1.0.1.lacticplugin`](../dist/cadence-bands-1.0.1.lacticplugin) and choose Settings → Plugins → Add a plugin in Lactic Modular.

To make your own version, copy `plugins/starter`, replace its `manifest.json` and `src/plugin.ts` with these, change the `id` and `name`, and build with `npm run build`.
