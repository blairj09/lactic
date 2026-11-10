**This is Lactic Preview, a testing build, not a release.** It's the latest `main`, rebuilt on every merge. Riders should use the [latest release](https://github.com/blairj09/lactic/releases/latest).

Lactic Preview installs beside Lactic as its own app (orange icon) with its own data, saved keys and Claude Desktop entry, so trying it never touches your real rides or plan. It checks this page for updates, so once it's installed every merge shows up as an update.

**Mac:** open the .dmg, drag Lactic Preview to Applications and open it (it's signed and notarized). Or in Terminal, in one go:

```sh
curl -fsSL https://raw.githubusercontent.com/blairj09/lactic/main/app/scripts/try-preview.sh | bash
```

Add a pull request number at the end (`| bash -s -- 72`) to try that pull request's build before it's merged (needs the GitHub CLI: `brew install gh && gh auth login`).
