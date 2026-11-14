# W′ Balance

A gauge of the hard-effort energy you have left (W′, in kJ), and a line of it over the ride with the low stretches marked.

- **Adds:** a ride field, **W′ balance**; a section on each ride's page, **W′ balance**.
- **Reads:** live ride numbers, your saved rides, your FTP and weight.
- **How it works:** Skiba and Clarke's W′ balance model, one step per second. Constants at the top (`W_PRIME`, `CP_OVERRIDE`) are yours to change.
- **Good example of:** Keeping state between ticks; a `meter` in a ride field; a `profile` with marks.

The code, with the sport science explained, is in [`src/plugin.ts`](src/plugin.ts). To add it, download [`w-prime-1.0.1.lacticplugin`](../dist/w-prime-1.0.1.lacticplugin) and choose Plugins → Add plugin → From a file in Lactic Modular.

To make your own version, copy `plugins/starter`, replace its `manifest.json` and `src/plugin.ts` with these, change the `id` and `name`, and build with `npm run build`.
