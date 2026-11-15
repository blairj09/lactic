// Writes latest.json, the file installed copies of Lactic read to find an update
// (tauri-plugin-updater's static manifest). Run by the release job after the builds:
//   node app/scripts/update-manifest.mjs <folder with the builds and their .sig files> <version> <owner/repo> [app/whats-new.md] [tag] > latest.json
// The tag defaults to v<version>; Lactic Preview builds live on the rolling `preview` release, and
// their notes are the **Next** section.
//   node app/scripts/update-manifest.mjs --notes app/whats-new.md <version>   (just this release's notes, for the release page)
// The app shows the release's section of whats-new.md as "What's new".
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
 * One release's section of app/whats-new.md (`## 0.1.3`) as the list the app shows: "- change"
 * lines, written for riders. Empty when the release has no section.
 */
export function whatsNew(markdown, version) {
  const lines = [];
  let inside = false;
  for (const raw of markdown.split(/\r?\n/)) {
    const heading = raw.match(/^##\s+v?(\S+)/);
    if (heading) {
      if (inside) break;
      inside = heading[1] === version.replace(/^v/, "");
      continue;
    }
    if (inside && /^[-*]\s+\S/.test(raw.trim())) lines.push(`- ${raw.trim().replace(/^[-*]\s+/, "")}`);
  }
  return lines.join("\n");
}

/** The architectures a build runs on: a universal Mac app counts for both Apple silicon and Intel. */
function arches(name) {
  if (/universal/.test(name)) return ["aarch64", "x86_64"];
  if (/aarch64|arm64/.test(name)) return ["aarch64"];
  if (/x64|x86_64|amd64/.test(name)) return ["x86_64"];
  // The Mac updater bundle is Lactic.app.tar.gz with no arch in its name; the release job adds it.
  return [];
}

function files(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : [path];
  });
}

/** The manifest for the signed builds among `paths` (each build's signature at `<build>.sig`). */
export function manifest({ paths, version, repo, date = new Date(), notes, tag = `v${version.replace(/^v/, "")}` }) {
  const platforms = {};
  const set = new Set(paths);
  for (const path of paths) {
    const name = basename(path);
    const kind = KINDS.find((k) => k.match.test(name));
    if (!kind || !set.has(`${path}.sig`)) continue;
    const list = arches(name);
    if (!list.length) throw new Error(`No architecture in ${name}`);
    const entry = {
      signature: readFileSync(`${path}.sig`, "utf8").trim(),
      url: `https://github.com/${repo}/releases/download/${tag}/${encodeURIComponent(name)}`,
    };
    for (const a of list) for (const key of kind.keys(a)) platforms[key] ??= entry;
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
  if (process.argv[2] === "--notes") {
    console.log(whatsNew(readFileSync(process.argv[3], "utf8"), process.argv[4] ?? ""));
    process.exit(0);
  }
  const [dir, version, repo, notesFile, tag] = process.argv.slice(2);
  if (!dir || !version || !repo) {
    console.error("usage: update-manifest.mjs <dir> <version> <owner/repo>");
    process.exit(2);
  }
  // A preview (0.1.4-preview.12) or modular build (0.1.4-modular.3) lists what's coming: the Next section.
  const section = /-(preview|modular)\./.test(version) ? "Next" : version;
  const notes = notesFile ? whatsNew(readFileSync(notesFile, "utf8"), section) : undefined;
  console.log(JSON.stringify(manifest({ paths: files(dir), version, repo, notes, tag: tag || undefined }), null, 2));
}
