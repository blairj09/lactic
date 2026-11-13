#!/usr/bin/env node
// Builds the official plugin catalog (plugins/catalog): bundles each plugin, packs it into a
// .lacticplugin file in plugins/catalog/dist and writes plugins/catalog/index.json with each file's
// checksum. Run from app/: `npm run plugins:catalog` to write, `npm run plugins:catalog -- --check`
// to fail if the committed files don't match the sources (CI runs the same check in Vitest).
//
// A plugin's built file can only change with a new version: rebuilding different code under a
// version that's already in dist/ stops with "bump the version". Older versions' files stay in
// dist/ untouched: the app ships them all, so it can still tell a rider's older catalog plugin is
// Lactic's own (app/src/plugins/catalog.ts). index.json lists only the current versions.
import { build } from "esbuild";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
export const CATALOG = join(here, "../../plugins/catalog");
const SDK = join(here, "../../plugins/sdk/src/index.ts");

const sha256 = (text) => createHash("sha256").update(text, "utf8").digest("hex");

/** The plugin folders, in name order. */
export function pluginDirs(root = CATALOG) {
  return readdirSync(root, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(root, d.name, "manifest.json")))
    .map((d) => d.name)
    .sort();
}

/** Builds every plugin in memory: { files: { "dist/<id>-<version>.lacticplugin": text }, index }. */
export async function buildCatalog(root = CATALOG) {
  const files = {};
  const plugins = [];
  for (const dir of pluginDirs(root)) {
    const manifest = JSON.parse(readFileSync(join(root, dir, "manifest.json"), "utf8"));
    if (manifest.id !== dir) throw new Error(`${dir}: the folder must be named after the manifest id (${manifest.id})`);
    const out = await build({
      entryPoints: [join(root, dir, "src/plugin.ts")],
      bundle: true,
      format: "iife",
      target: "es2020",
      write: false,
      charset: "utf8",
      legalComments: "none",
      alias: { "@lactic/sdk": SDK },
      logLevel: "silent",
    });
    const code = out.outputFiles[0].text;
    // The same format as the SDK's lactic-pack and the app's packagePlugin().
    const text = JSON.stringify({ lacticplugin: 1, manifest, main: code });
    const file = `dist/${manifest.id}-${manifest.version}.lacticplugin`;
    files[file] = text;
    const c = manifest.contributes ?? {};
    plugins.push({
      id: manifest.id,
      name: manifest.name,
      version: manifest.version,
      description: manifest.description,
      reads: manifest.permissions.read,
      adds: {
        fields: (c.fields ?? []).map((f) => f.title),
        analyses: (c.analyses ?? []).map((a) => a.title),
        widgets: (c.widgets ?? []).map((w) => w.title),
      },
      source: `${dir}/src/plugin.ts`,
      file,
      bytes: Buffer.byteLength(text, "utf8"),
      sha256: sha256(text),
    });
  }
  return { files, index: { catalog: 1, plugins } };
}

export const indexText = (index) => `${JSON.stringify(index, null, 2)}\n`;

/** Differences between a fresh build and what's on disk, as sentences; empty when they match. */
export function compare(built, root = CATALOG) {
  const problems = [];
  for (const [file, text] of Object.entries(built.files)) {
    const path = join(root, file);
    if (!existsSync(path)) problems.push(`${file} is missing; run npm run plugins:catalog`);
    else if (readFileSync(path, "utf8") !== text) problems.push(`${file} doesn't match its source; bump the plugin's version and run npm run plugins:catalog`);
  }
  const dist = join(root, "dist");
  const ids = new Set(built.index.plugins.map((p) => p.id));
  for (const name of existsSync(dist) ? readdirSync(dist) : []) {
    if (`dist/${name}` in built.files) continue;
    // An older version of a plugin still in the catalog is kept as it was shipped.
    const m = name.match(/^([a-z0-9-]+)-(\d+\.\d+\.\d+)\.lacticplugin$/);
    if (!m || !ids.has(m[1])) problems.push(`dist/${name} isn't a version of any plugin in the catalog`);
  }
  const index = join(root, "index.json");
  if (!existsSync(index) || readFileSync(index, "utf8") !== indexText(built.index)) problems.push("index.json is out of date; run npm run plugins:catalog");
  return problems;
}

async function main() {
  const built = await buildCatalog();
  if (process.argv.includes("--check")) {
    const problems = compare(built);
    for (const p of problems) console.error(`plugins:catalog: ${p}`);
    process.exit(problems.length ? 1 : 0);
  }
  const dist = join(CATALOG, "dist");
  mkdirSync(dist, { recursive: true });
  // Refuse to change a file without a new version: riders who added it would get different code.
  for (const [file, text] of Object.entries(built.files)) {
    const path = join(CATALOG, file);
    if (existsSync(path) && readFileSync(path, "utf8") !== text) {
      console.error(`plugins:catalog: ${file} changed; bump that plugin's version in its manifest.json`);
      process.exit(1);
    }
  }
  for (const [file, text] of Object.entries(built.files)) writeFileSync(join(CATALOG, file), text);
  writeFileSync(join(CATALOG, "index.json"), indexText(built.index));
  console.log(`plugins:catalog: built ${built.index.plugins.length} plugins`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await main();
