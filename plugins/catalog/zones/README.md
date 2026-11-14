# Zones

Live ride fields with small charts: time in each heart rate and power zone as bars in Lactic's zone colours, and a trend line of your last 5 minutes of power.

- **Adds:** three ride fields, **HR zones**, **Power zones** and **Power, last 5 min**.
- **Reads:** live ride numbers.
- **How it works:** each tick adds the seconds since the last one to the current zone (Lactic works out the zone from your FTP and threshold heart rate).
- **Good example of:** charts in a ride field (`bars` with `palette: "zones"`, `sparkline`); several fields from one plugin.

The code is in [`src/plugin.ts`](src/plugin.ts). To add it, download [`zones-0.1.0.lacticplugin`](../dist/zones-0.1.0.lacticplugin) and choose Plugins → Add plugin → From a file in Lactic Modular.

To make your own version, copy `plugins/starter`, replace its `manifest.json` and `src/plugin.ts` with these, change the `id` and `name`, and build with `npm run build`.
