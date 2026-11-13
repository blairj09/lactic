// Checking GitHub for newer releases of plugins added from GitHub, when Settings → Plugins opens,
// and this build of Lactic for newer versions of its own catalog plugins (no network for those).
// Only ever an offer: the update screen still has to be tapped. GitHub is checked at most once an hour.
import { CATALOG_ORIGIN, catalogEntries, catalogState, catalogText } from "./catalog";
import { fetchFromGitHub, parseOrigin, type Fetch } from "./github";
import { preparePackage, type PluginRecord, type Prepared } from "./store";

export type Offer = Extract<Prepared, { kind: "update" }> & { origin: string };

const HOUR = 60 * 60 * 1000;
const checked = new Map<string, { at: number; sha: string; offer: Offer | null }>();

/** Newer versions on GitHub, by plugin id. Failures are quiet: no offer. */
export async function checkForUpdates(plugins: PluginRecord[], fetchFn?: Fetch, now = Date.now()): Promise<Map<string, Offer>> {
  const out = new Map<string, Offer>();
  await Promise.all(
    plugins.map(async (p) => {
      if (p.origin === CATALOG_ORIGIN) {
        const offer = await catalogOffer(p).catch(() => null);
        if (offer) out.set(p.pluginId, offer);
        return;
      }
      const repo = parseOrigin(p.origin);
      if (!repo || !p.origin) return;
      const last = checked.get(p.pluginId);
      if (last && last.sha === p.sha256 && now - last.at < HOUR) {
        if (last.offer) out.set(p.pluginId, last.offer);
        return;
      }
      let offer: Offer | null = null;
      try {
        const { text } = await fetchFromGitHub(repo, fetchFn);
        const prepared = await preparePackage(text);
        if (prepared.kind === "update" && prepared.current.pluginId === p.pluginId && prepared.changes.direction === "newer") offer = { ...prepared, origin: p.origin };
      } catch {
        offer = null;
      }
      checked.set(p.pluginId, { at: now, sha: p.sha256, offer });
      if (offer) out.set(p.pluginId, offer);
    }),
  );
  return out;
}

export function forgetUpdateChecks() {
  checked.clear();
}

/** A newer version of a catalog plugin bundled with this build, as an update offer. */
async function catalogOffer(p: PluginRecord): Promise<Offer | null> {
  const entry = catalogEntries().find((e) => e.id === p.pluginId);
  if (!entry || catalogState(entry, p.manifest.version) !== "update") return null;
  const prepared = await preparePackage(await catalogText(entry));
  return prepared.kind === "update" && prepared.changes.direction === "newer" ? { ...prepared, origin: CATALOG_ORIGIN } : null;
}
