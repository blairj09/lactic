# Matches

Counts the hard efforts above threshold you make ("matches burned") and lists each one after the ride: when, how long, how hard.

- **Adds:** a ride field, **Matches**; a section on each ride's page, **Matches burned**.
- **Reads:** live ride numbers, your saved rides, your FTP and weight.
- **How it works:** An effort starts at 120% of FTP and ends after 5 seconds back under FTP; under 10 seconds doesn't count.
- **Good example of:** A small state machine shared by the live field and the ride analysis.

The code, with the sport science explained, is in [`src/plugin.ts`](src/plugin.ts). To add it, download [`matches-1.0.1.lacticplugin`](../dist/matches-1.0.1.lacticplugin) and choose Settings → Plugins → Add a plugin in Lactic Modular.

To make your own version, copy `plugins/starter`, replace its `manifest.json` and `src/plugin.ts` with these, change the `id` and `name`, and build with `npm run build`.
