// Lactic's own plugins (plugins/catalog in the repo), shipped inside the app: Plugins tab →
// Browse lists them and adds them through the same permission screen as any plugin. Nothing is
// downloaded. Every version ever published is bundled, so "from Lactic" can be decided by the
// package's hash alone (isCatalogPackage), never by anything a plugin or a stored row says.
import index from "../../../plugins/catalog/index.json";
import { parsePackage, sha256Hex } from "./package";
import { compareVersions } from "./permissions";

/** Stored as a plugin's origin when it's added from the catalog. Shown as "Lactic" only for a bundled package. */
export const CATALOG_ORIGIN = "lactic:catalog";

/** Where riders can read the code. */
export const CATALOG_CODE_URL = "https://github.com/blairj09/lactic/tree/modular-ui/plugins/catalog";

export interface CatalogEntry {
  id: string;
  name: string;
  version: string;
  description: string;
  reads: string[];
  adds: { fields: string[]; analyses: string[]; widgets: string[] };
  file: string;
  sha256: string;
}

const FILES = import.meta.glob<string>("../../../plugins/catalog/dist/*.lacticplugin", { query: "?raw", import: "default" });
const fileKey = (name: string) => `../../../plugins/catalog/dist/${name}`;

/** The current version of each catalog plugin, in name order. */
export function catalogEntries(): CatalogEntry[] {
  return [...(index.plugins as CatalogEntry[])].sort((a, b) => a.name.localeCompare(b.name));
}

/** The bundled file's text for an entry, checked against the index's checksum. */
export async function catalogText(entry: CatalogEntry): Promise<string> {
  const load = FILES[fileKey(entry.file.replace(/^dist\//, ""))];
  if (!load) throw new Error(`${entry.name} isn't in this build of Lactic.`);
  const text = await load();
  if ((await sha256Hex(text)) !== entry.sha256) throw new Error(`${entry.name} doesn't match its checksum.`);
  return text;
}

let hashes: Promise<Set<string>> | null = null;

/** Package hashes (manifest + code, as stored for a plugin) of every bundled catalog version. */
export function catalogPackageHashes(): Promise<Set<string>> {
  hashes ??= (async () => {
    const out = new Set<string>();
    for (const load of Object.values(FILES)) {
      const parsed = await parsePackage(await load());
      if (parsed.ok) out.add(parsed.pkg.sha256);
    }
    return out;
  })();
  return hashes;
}

/** True only when this exact package (by hash) is one Lactic shipped. */
export async function isCatalogPackage(sha256: string): Promise<boolean> {
  return (await catalogPackageHashes()).has(sha256);
}

export type CatalogState = "add" | "added" | "update";

/** What Browse offers for an entry, given the version added on this computer (if any). */
export function catalogState(entry: CatalogEntry, installedVersion: string | null): CatalogState {
  if (installedVersion === null) return "add";
  return compareVersions(entry.version, installedVersion) > 0 ? "update" : "added";
}
