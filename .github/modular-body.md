**This is Lactic Modular, a testing build, not a release.** It's the latest `modular-ui` branch: the customizable layouts, ride data fields and plugins work, rebuilt on every merge into that branch. Riders should use the [latest release](https://github.com/blairj09/lactic/releases/latest).

Lactic Modular installs beside Lactic and Lactic Preview as its own app (purple icon) with its own data, saved keys, ports and Claude Desktop entry (`lactic-modular`), so trying it never touches your real rides or your Preview. It checks this page for updates.

**Mac, in Terminal:**

```sh
curl -fsSL https://raw.githubusercontent.com/blairj09/lactic/modular-ui/app/scripts/try-preview.sh | bash -s -- --modular
```

Add a pull request number (`bash -s -- --modular 160`) to try a pull request into `modular-ui` before it's merged (needs the GitHub CLI: `brew install gh && gh auth login`).
