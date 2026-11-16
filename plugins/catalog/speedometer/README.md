# Speedometer

The speed your power would carry you on a flat road, on a dial like a car's speedometer.

- **Adds:** a ride field, **Road speed**.
- **Reads:** live ride numbers, your weight.
- **How it works:** Solves the road cycling power model (rolling resistance plus air drag) for speed, for a rider on the hoods at sea level with no wind.
- **Good example of:** A `gauge`: the plugin sends a number, a range and bands, and Lactic draws the dial on every screen.

The code, with the physics explained, is in [`src/plugin.ts`](src/plugin.ts). To add it, download [`speedometer-1.0.0.lacticplugin`](../dist/speedometer-1.0.0.lacticplugin) and choose Settings → Plugins → Add plugin → From a file in Lactic.

To make your own version, copy `plugins/starter`, replace its `manifest.json` and `src/plugin.ts` with these, change the `id` and `name`, and build with `npm run build`.
