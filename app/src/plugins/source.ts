// Hands installed plugins to the coach's plugin tools (web/lib/coach/plugins.ts) at boot. Only what
// this device granted counts: a plugin that isn't approved and switched on here shows as off, and a
// declined group (location) isn't listed as something it reads.
import { registerPluginSource, type PluginSource } from "@/lib/coach/plugins";
import { installedPlugin } from "./coach";
import { grantedManifest } from "./permissions";
import { listPlugins, readValues } from "./store";

export const storedPluginSource: PluginSource = {
  async list() {
    return (await listPlugins()).map((p) => installedPlugin(grantedManifest(p.manifest, p.grant?.read ?? []), { enabled: p.state === "on", coachVisible: p.grant?.coachVisible === true }));
  },
  read: readValues,
};

export function installPluginSource() {
  registerPluginSource(storedPluginSource);
}
