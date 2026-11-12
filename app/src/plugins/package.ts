// A .lacticplugin file: one JSON document holding the manifest and the plugin's code, so installing
// needs no unzipping, no folder access and no network. Lactic pins the exact bytes by SHA-256; any
// later change to the code is an update the rider has to approve (review S6).
//
//   { "lacticplugin": 1, "manifest": { ... }, "main": "<the bundle's JavaScript>" }
//
// Plain data apart from crypto.subtle (present in browsers, workers and Node).
import { parseManifestText, validateManifest, type PluginManifest } from "./manifest";

export const PACKAGE_VERSION = 1;
export const PACKAGE_EXTENSION = ".lacticplugin";
/** The whole file. The sandbox has its own heap limit; this keeps the database small. */
export const MAX_PACKAGE_BYTES = 1024 * 1024;
export const MAX_SOURCE_BYTES = 512 * 1024;

export interface PluginPackage {
  manifest: PluginManifest;
  /** The plugin's JavaScript, run only in the sandbox. */
  source: string;
  /** SHA-256 of the file's manifest and code, lowercase hex. */
  sha256: string;
}

export type PackageResult = { ok: true; pkg: PluginPackage } | { ok: false; reason: string; details: string[] };

/** The rider-facing reason for a refusal: the manifest check's own plain words where it has them. */
function refuse(details: string[]): PackageResult {
  const words = details.map((d) => d.replace(/^[^:]*:\s*/, ""));
  const plain = words.find((w) => /^Plugins can/.test(w));
  const name = words.find((w) => /look like Lactic|Lactic name/.test(w));
  const reason = plain ?? (name ? "Its name looks like Lactic's own, which plugins can't use." : "It isn't a plugin file this version of Lactic can read.");
  return { ok: false, reason, details };
}

export async function sha256Hex(text: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
  return Array.from(digest, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Read a .lacticplugin file's text. Strict: unknown keys, a bad manifest or oversized code are refused. */
export async function parsePackage(text: string): Promise<PackageResult> {
  if (text.length > MAX_PACKAGE_BYTES) return refuse(["file: is larger than 1 MB"]);
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return refuse(["file: is not a .lacticplugin file"]);
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return refuse(["file: is not a .lacticplugin file"]);
  const o = raw as Record<string, unknown>;
  const extra = Object.keys(o).filter((k) => !["lacticplugin", "manifest", "main"].includes(k));
  if (extra.length) return refuse(extra.map((k) => `file.${k}: is not a known field`));
  if (o.lacticplugin !== PACKAGE_VERSION) return refuse([`file.lacticplugin: must be ${PACKAGE_VERSION}`]);
  if (typeof o.main !== "string" || o.main.length === 0) return refuse(["file.main: must hold the plugin's code"]);
  if (o.main.length > MAX_SOURCE_BYTES) return refuse(["file.main: the plugin's code is larger than 512 KB"]);
  const checked = typeof o.manifest === "string" ? parseManifestText(o.manifest) : validateManifest(o.manifest);
  if (!checked.ok) return refuse(checked.errors);
  // Pin what will actually run and what was approved: the checked manifest plus the exact code.
  const sha256 = await sha256Hex(JSON.stringify(checked.manifest) + "\n" + o.main);
  return { ok: true, pkg: { manifest: checked.manifest, source: o.main, sha256 } };
}

/** Build a .lacticplugin file's text (the starter's build step and tests). */
export function packagePlugin(manifest: unknown, source: string): string {
  return JSON.stringify({ lacticplugin: PACKAGE_VERSION, manifest, main: source });
}
