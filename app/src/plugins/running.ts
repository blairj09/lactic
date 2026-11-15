// The plugins running on this device: one sandboxed PluginHost each, started only for plugins that
// are approved here and switched on, with the manifest cut to the groups granted here, so the host
// trims what goes in to exactly that. When the host switches a plugin off (crashes, running late),
// the reason is saved and the plugin stays off until the rider turns it on again.
import { PluginHost, type WorkerLike } from "./host";
import { grantedManifest } from "./permissions";
import { listPlugins, markSwitchedOff, type PluginRecord } from "./store";

const hosts = new Map<string, { sha256: string; host: PluginHost }>();

/** Start or reuse the host for one plugin; null when it may not run here. */
export async function pluginHost(p: PluginRecord, createWorker: () => WorkerLike): Promise<PluginHost | null> {
  if (p.state !== "on" || !p.grant) {
    stopPlugin(p.pluginId);
    return null;
  }
  const have = hosts.get(p.pluginId);
  if (have && have.sha256 === p.sha256) {
    // Lactic switched it off (crashes, running late, or it couldn't start): it stays off, with no
    // fresh worker each ride second, until the rider turns it back on (syncRunning drops the entry
    // once the saved state is off) or a new package arrives.
    return have.host.status === "disabled" ? null : have.host;
  }
  stopPlugin(p.pluginId);
  const host = new PluginHost(grantedManifest(p.manifest, p.grant.read), p.source, createWorker, {
    onStatus: (status, reason) => {
      if (status === "disabled" && reason && reason !== "switched off") void markSwitchedOff(p.pluginId, reason);
    },
  });
  hosts.set(p.pluginId, { sha256: p.sha256, host });
  return (await host.start()) ? host : null;
}

export function stopPlugin(pluginId: string) {
  hosts.get(pluginId)?.host.stop();
  hosts.delete(pluginId);
}

/** Stop hosts for plugins that were removed, switched off or changed since they started. */
export async function syncRunning() {
  const current = new Map((await listPlugins()).map((p) => [p.pluginId, p]));
  for (const [id, h] of hosts) {
    const p = current.get(id);
    if (!p || p.state !== "on" || p.sha256 !== h.sha256) stopPlugin(id);
  }
}

if (typeof window !== "undefined") window.addEventListener("lactic:plugins", () => void syncRunning());
