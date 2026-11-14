# Form Zones

A card in the Plugins tab placing today's form (fitness minus fatigue) in a zone, from Fresh to High risk.

- **Adds:** a card in the Plugins tab, **Form zone**.
- **Reads:** fitness, fatigue and form.
- **How it works:** Transition over +25, Fresh +5 to +25, Grey zone −10 to +5, Optimal −30 to −10, High risk under −30.
- **Good example of:** A widget: a card for the Plugins tab.

The code, with the sport science explained, is in [`src/plugin.ts`](src/plugin.ts). To add it, download [`form-zones-1.0.1.lacticplugin`](../dist/form-zones-1.0.1.lacticplugin) and choose Plugins → Add plugin → From a file in Lactic Modular.

To make your own version, copy `plugins/starter`, replace its `manifest.json` and `src/plugin.ts` with these, change the `id` and `name`, and build with `npm run build`.
