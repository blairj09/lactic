# On Target

How close this interval's power is to its target, and after the ride each interval against its target with a count of the ones within 5%.

- **Adds:** a ride field, **On target**; a section on each ride's page, **Intervals vs target**.
- **Reads:** live ride numbers, your saved rides.
- **How it works:** Interval average power ÷ target; intervals under 30 seconds are skipped.
- **Good example of:** Reading workout targets and the intervals as ridden; `bars` and a `table`.

The code, with the sport science explained, is in [`src/plugin.ts`](src/plugin.ts). To add it, download [`on-target-1.0.1.lacticplugin`](../dist/on-target-1.0.1.lacticplugin) and choose Settings → Plugins → Add a plugin in Lactic Modular.

To make your own version, copy `plugins/starter`, replace its `manifest.json` and `src/plugin.ts` with these, change the `id` and `name`, and build with `npm run build`.
