// Checking GitHub for newer releases of plugins added from GitHub, when Settings → Plugins opens.
// Only ever an offer: the update screen still has to be tapped. Checked at most once an hour.
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
