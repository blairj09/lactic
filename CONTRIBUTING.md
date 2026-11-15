# Contributing to Lactic

Thanks for helping. Bug reports, support for new gear or health sources, plugins, workouts and pull requests are all welcome.

## Reporting a problem

- **In the app:** the speech bubble at the top attaches a picture of the screen you're on. Circle the problem and send. No GitHub account needed; it arrives here as an issue.
- **On GitHub:** [open an issue](https://github.com/blairj09/lactic/issues/new/choose). Say what you expected, what happened, your computer (Mac, Windows or Linux) and your trainer.

Windows and Linux reports are especially welcome, since those builds haven't been tested on real hardware yet.

## Writing a plugin

Most new fields and ride analyses don't need a change to Lactic. Write a plugin instead: see [plugins/](plugins/), copy [`plugins/starter`](plugins/starter), or give [`plugins/AI-GUIDE.md`](plugins/AI-GUIDE.md) to an AI assistant. To add one to the official catalog, open a pull request with a new folder in [`plugins/catalog`](plugins/catalog/).

## Pull requests

Set up with [Build from source](README.md#build-from-source), then before you open a pull request run the checks in `app/`:

```sh
npm run typecheck && npm run lint && npm test && npx vite build
(cd src-tauri && cargo check)   # when Rust changed
```

Changing the coach's prompt or tools? `npm run eval:coach` scores it across models. See [app/evals](app/evals/README.md).

If riders will notice the change, add a plain-words line under **Next** in [`app/whats-new.md`](app/whats-new.md).

## House rules

These keep Lactic trustworthy:

- **The engine owns every number.** The AI coach reads engine outputs through tools and proposes changes; it never computes metrics.
- **Keep the core portable.** `web/lib/engine`, `web/lib/fit`, `web/lib/ride`, `web/lib/sdk` and the Bluetooth protocol code stay free of browser and Node APIs, so they run anywhere and test in Vitest.
- **One GATT write at a time,** through `SensorHub`'s queue.
- **Lactic holds the trainer.** With Zwift open, Zwift only reads power, cadence and heart rate (except in Head unit mode, where Lactic never touches the trainer).
- **Migrations only add.** New tables and columns, never drops or renames. Every table has a UUID `id` and `updated_at`.
- **Plugin code stays in the sandbox.** Third-party code runs only in `app/src/plugins`' QuickJS worker. Never `eval` it anywhere else, and validate everything a plugin returns.
- **Secrets stay in the OS keychain.** The UI only ever sends `keychain:<name>` placeholders.

By contributing, you agree your work is released under the [MIT license](LICENSE).
