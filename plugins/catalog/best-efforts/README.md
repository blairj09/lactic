# Best Efforts

Your best efforts so far during a ride, up to four durations in one field, and a table of your best 5 s, 1, 5, 20 and 60 minutes after it, with W/kg and % of FTP.

- **Adds:** ride fields **Best efforts** (pick up to four durations in the field editor) and **Best 5 min**; a section on each ride's page, **Best efforts**.
- **Reads:** live ride numbers, your saved rides, your FTP and weight.
- **How it works:** A rolling sum over each window, so each second costs the same however long the window is.
- **Good example of:** A `values` field with `options`; ring buffers in a field; a `table` on the ride page.

The code, with the sport science explained, is in [`src/plugin.ts`](src/plugin.ts). To add it, download [`best-efforts-1.1.0.lacticplugin`](../dist/best-efforts-1.1.0.lacticplugin) and choose Settings → Plugins → Add plugin → From a file in Lactic.

To make your own version, copy `plugins/starter`, replace its `manifest.json` and `src/plugin.ts` with these, change the `id` and `name`, and build with `npm run build`.
