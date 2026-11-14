# Fuel Reminder

A countdown to your next bite every 20 minutes, then "Eat" with a carb amount that goes up on harder rides.

- **Adds:** a ride field, **Fuel**.
- **Reads:** live ride numbers.
- **How it works:** 40 g an hour on easy rides, 80 g on hard ones (ride intensity of 75% or more).
- **Good example of:** Timed nudges from the ride clock; publishing a `choice` metric.

The code, with the sport science explained, is in [`src/plugin.ts`](src/plugin.ts). To add it, download [`fuel-1.0.1.lacticplugin`](../dist/fuel-1.0.1.lacticplugin) and choose Plugins → Add plugin → From a file in Lactic Modular.

To make your own version, copy `plugins/starter`, replace its `manifest.json` and `src/plugin.ts` with these, change the `id` and `name`, and build with `npm run build`.
