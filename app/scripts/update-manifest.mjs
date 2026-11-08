// Writes latest.json, the file installed copies of Lactic read to find an update
// (tauri-plugin-updater's static manifest). Run by the release job after the builds:
//   node app/scripts/update-manifest.mjs <folder with the builds and their .sig files> <version> <owner/repo> > latest.json
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
    notes: notes ?? `https://github.com/${repo}/releases/tag/${tag}`,
    pub_date: date.toISOString().replace(/\.\d{3}Z$/, "Z"),
    platforms,
  };
}

if (process.argv[1] && import.meta.url.endsWith(basename(process.argv[1]))) {
  const [dir, version, repo] = process.argv.slice(2);
  if (!dir || !version || !repo) {
    console.error("usage: update-manifest.mjs <dir> <version> <owner/repo>");
    process.exit(2);
  }
  console.log(JSON.stringify(manifest({ paths: files(dir), version, repo }), null, 2));
}
