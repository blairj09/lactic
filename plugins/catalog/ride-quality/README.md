# Ride Quality

Variability index (how steady), efficiency factor (watts per heartbeat) and intensity factor (how hard), live and after the ride.

- **Adds:** a ride field, **Variability**; a section on each ride's page, **Ride quality**.
- **Reads:** live ride numbers, your saved rides, your FTP and weight.
- **How it works:** Divides Lactic's own normalized power by average power, heart rate and FTP.
- **Good example of:** Building on engine numbers instead of re-deriving them.

The code, with the sport science explained, is in [`src/plugin.ts`](src/plugin.ts). To add it, download [`ride-quality-1.0.0.lacticplugin`](../dist/ride-quality-1.0.0.lacticplugin) and choose Settings → Plugins → Add a plugin in Lactic Modular.

To make your own version, copy `plugins/starter`, replace its `manifest.json` and `src/plugin.ts` with these, change the `id` and `name`, and build with `npm run build`.
