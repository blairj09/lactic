# Aerobic Decoupling

How far your heart rate drifts up against your power on a steady ride (Pw:HR). Under 5% suggests a solid aerobic base.

- **Adds:** a ride field, **HR drift**; a section on each ride's page, **Aerobic decoupling**.
- **Reads:** live ride numbers, your saved rides.
- **How it works:** Watts per heartbeat in the first half against the second, after a 10-minute warm-up.
- **Good example of:** Reading two streams together; saying when a result means little.

The code, with the sport science explained, is in [`src/plugin.ts`](src/plugin.ts). To add it, download [`decoupling-1.0.1.lacticplugin`](../dist/decoupling-1.0.1.lacticplugin) and choose Settings → Plugins → Add a plugin in Lactic Modular.

To make your own version, copy `plugins/starter`, replace its `manifest.json` and `src/plugin.ts` with these, change the `id` and `name`, and build with `npm run build`.
