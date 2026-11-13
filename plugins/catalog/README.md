# Lactic plugin catalog

Official plugins for **Lactic Modular**: add them as they are, or read them to learn how a plugin is built. Each one is a single commented file that explains the sport science behind it.

| Plugin | Adds | Reads | Version |
| --- | --- | --- | --- |
| [Best Efforts](best-efforts/) | ride field, ride page | live, rides, profile | 1.0.0 |
| [Cadence Bands](cadence-bands/) | ride field, ride page | live, rides | 1.0.0 |
| [Aerobic Decoupling](decoupling/) | ride field, ride page | live, rides | 1.0.0 |
| [Form Zones](form-zones/) | Plugins tab | fitness | 1.0.0 |
| [Fuel Reminder](fuel/) | ride field | live | 1.0.0 |
| [Matches](matches/) | ride field, ride page | live, rides, profile | 1.0.0 |
| [On Target](on-target/) | ride field, ride page | live, rides | 1.0.0 |
| [Ride Quality](ride-quality/) | ride field, ride page | live, rides, profile | 1.0.0 |
| [W′ Balance](w-prime/) | ride field, ride page | live, rides, profile | 1.0.0 |

None of them read health data or where you ride, and none appear on Today.

## Add one

Open the plugin's folder, download its `.lacticplugin` file from [`dist/`](dist/), then in Lactic Modular choose Settings → Plugins → Add a plugin and pick the file. Lactic shows what it reads before anything runs.

## Learn from one

Start with [Ride Quality](ride-quality/src/plugin.ts) (a few lines on top of Lactic's own numbers), then [Best Efforts](best-efforts/src/plugin.ts) (state between ticks) and [W′ Balance](w-prime/src/plugin.ts) (a model, a gauge and a chart). To write your own, copy [`../starter`](../starter), or hand [`../AI-GUIDE.md`](../AI-GUIDE.md) to an AI assistant.

## How the catalog works

- Each folder has `manifest.json`, `src/plugin.ts` and a README. The folder name is the plugin's `id`.
- `dist/` holds the built files and [`index.json`](index.json) lists each with its checksum (SHA-256 of the file). Both are generated: in `app/`, run `npm run plugins:catalog`.
- Each plugin has its own version, separate from Lactic's. Any change to its code or manifest needs a new version; the build refuses to change a file under an old one, so a rider who added 1.0.0 always has the same code as anyone else with 1.0.0.
- `app/src/plugins/catalog.test.ts` checks the built files match their sources and runs every plugin through a simulated 40-minute ride, and with no data at all, in the real sandbox. A plugin that throws, runs over its 20 ms, or publishes a number its manifest doesn't declare fails CI.
- New plugins and changes go through the same security review as Lactic's plugin sandbox: no internet, numbers only, nothing shared with the coach unless the rider turns it on.
