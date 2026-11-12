#!/usr/bin/env node
// lactic-pack [manifest.json] [bundle.js] [out-dir]
// Writes <id>-<version>.lacticplugin: { "lacticplugin": 1, "manifest": ..., "main": "<code>" }.
// The bundle must be a plain script (esbuild --format=iife), not an ES module: the sandbox has no imports.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";

const [manifestPath = "manifest.json", bundlePath, outDir] = process.argv.slice(2);
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const code = readFileSync(bundlePath ?? join(dirname(manifestPath), "dist", manifest.main), "utf8");
if (/^\s*(import|export)\s/m.test(code)) {
  console.error("lactic-pack: the bundle has import/export statements. Build it as a plain script (esbuild --format=iife).");
  process.exit(1);
}
for (const key of ["network", "internet", "sites", "secrets", "write"]) {
  if (key in manifest) {
    console.error(`lactic-pack: "${key}" isn't allowed in this version of Lactic; the file would be refused.`);
    process.exit(1);
  }
}
const out = outDir ?? join(dirname(manifestPath), "dist");
mkdirSync(out, { recursive: true });
const file = join(out, `${manifest.id}-${manifest.version}.lacticplugin`);
writeFileSync(file, JSON.stringify({ lacticplugin: 1, manifest, main: code }));
console.log(`lactic-pack: wrote ${file}`);
