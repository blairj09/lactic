// Writes latest.json, the file installed copies of Lactic read to find an update
// (tauri-plugin-updater's static manifest). Run by the release job after the builds:
//   node app/scripts/update-manifest.mjs <folder with the builds and their .sig files> <version> <owner/repo> [notes.md] > latest.json
// notes.md is GitHub's generated release notes; the app shows them as "What's new".
// Every build that comes with a signature gets an entry under each name the updater looks for:
// `{os}-{arch}-{bundle}` first (so a .deb install updates with a .deb), then plain `{os}-{arch}`.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join } from "node:path";

const KINDS = [
  { match: /\.app\.tar\.gz$/, keys: (arch) => [`darwin-${arch}-app`, `darwin-${arch}`] },
  { match: /-setup\.exe$/, keys: (arch) => [`windows-${arch}-nsis`, `windows-${arch}`] },
  { match: /\.AppImage$/, keys: (arch) => [`linux-${arch}-appimage`, `linux-${arch}`] },
  { match: /\.deb$/, keys: (arch) => [`linux-${arch}-deb`] },
];

/**
 * GitHub's generated notes ("* Title by @someone in https://…/pull/12", a New Contributors list,
 * a Full Changelog link) as the short list the app shows: one "- Title" line per change.
 */
export function whatsNew(generated) {
  const lines = [];
  for (const raw of generated.split(/\r?\n/)) {
    const line = raw.trim();
    if (/^#+\s*new contributors/i.test(line)) break;
    const m = line.match(/^[*-]\s+(.+?)(?:\s+by\s+@\S+)?(?:\s+in\s+https?:\/\/\S+)?$/);
    if (m && !/^full changelog/i.test(m[1])) lines.push(`- ${m[1].replace(/\s*\(#\d+\)$/, "")}`);
  }
  return lines.join("\n");
}

function arch(name) {
  if (/aarch64|arm64/.test(name)) return "aarch64";
  if (/x64|x86_64|amd64/.test(name)) return "x86_64";
  // The Mac updater bundle is Lactic.app.tar.gz with no arch in its name; the release job adds it.
  return undefined;
}

function files(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : [path];
  });
}

/** The manifest for the signed builds among `paths` (each build's signature at `<build>.sig`). */
export function manifest({ paths, version, repo, date = new Date(), notes }) {
  const tag = `v${version.replace(/^v/, "")}`;
  const platforms = {};
  const set = new Set(paths);
  for (const path of paths) {
    const name = basename(path);
    const kind = KINDS.find((k) => k.match.test(name));
    if (!kind || !set.has(`${path}.sig`)) continue;
    const a = arch(name);
    if (!a) throw new Error(`No architecture in ${name}`);
    const entry = {
      signature: readFileSync(`${path}.sig`, "utf8").trim(),
      url: `https://github.com/${repo}/releases/download/${tag}/${encodeURIComponent(name)}`,
    };
    for (const key of kind.keys(a)) platforms[key] ??= entry;
  }
  if (!Object.keys(platforms).length) throw new Error("No signed builds found");
  return {
    version: version.replace(/^v/, ""),
    notes: notes ?? "",
    pub_date: date.toISOString().replace(/\.\d{3}Z$/, "Z"),
    platforms,
  };
}

if (process.argv[1] && import.meta.url.endsWith(basename(process.argv[1]))) {
  const [dir, version, repo, notesFile] = process.argv.slice(2);
  if (!dir || !version || !repo) {
    console.error("usage: update-manifest.mjs <dir> <version> <owner/repo>");
    process.exit(2);
  }
  const notes = notesFile ? whatsNew(readFileSync(notesFile, "utf8")) : undefined;
  console.log(JSON.stringify(manifest({ paths: files(dir), version, repo, notes }), null, 2));
}
