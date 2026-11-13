// Installed plugins in SQLite: the plugins table (manifest + code, pinned by SHA-256), this device's
// approvals (plugin_grants) and the numbers plugins publish (plugin_values). Every manifest read
// back is checked again, so a row edited by hand, by sync or by a restored backup can't skip the gate.
import { sql, type Row } from "~/db/sql";
import type { MetricGroup } from "@shared/sdk";
import { validateManifest, type PluginManifest } from "./manifest";
import { deviceId } from "./device";
import { CATALOG_ORIGIN, isCatalogPackage } from "./catalog";
import { parsePackage, sha256Hex, type PluginPackage } from "./package";
import { grantedGroups, pluginState, updateChanges, updatedGrant, type Grant, type InstallChoices, type PluginState, type UpdateChanges } from "./permissions";

/** Values kept per plugin; the oldest go first (review S10). */
export const MAX_VALUES_PER_PLUGIN = 20_000;

export interface PluginRecord {
  pluginId: string;
  manifest: PluginManifest;
  source: string;
  sha256: string;
  installedAt: string;
  /** "github:owner/repo" when added from GitHub. */
  origin: string | null;
  /** This device's approval, if any. */
  grant: Grant | null;
  state: PluginState;
}

export type Prepared =
  | { kind: "new"; pkg: PluginPackage }
  | { kind: "update"; pkg: PluginPackage; current: PluginRecord; changes: UpdateChanges }
  /** The same file is already installed. */
  | { kind: "same"; current: PluginRecord }
  | { kind: "refused"; reason: string; details: string[] };

const json = <T>(v: unknown, fallback: T): T => {
  if (typeof v !== "string") return fallback;
  try {
    return JSON.parse(v) as T;
  } catch {
    return fallback;
  }
};

const GROUPS: readonly MetricGroup[] = ["live", "rides", "fitness", "profile", "recovery", "location"];

function toGrant(r: Row | undefined): Grant | null {
  if (!r) return null;
  const read = json<unknown[]>(r.read, []).filter((g): g is MetricGroup => GROUPS.includes(g as MetricGroup));
  return { sha256: String(r.sha256), read, enabled: Boolean(Number(r.enabled)), coachVisible: Boolean(Number(r.coach_visible)), switchedOff: r.switched_off ? String(r.switched_off) : null };
}

// The hash of what will actually run, computed here rather than trusted from the row: a synced or
// restored row with new code under the old hash must not run on the old approval (review S6, S7).
const hashes = new Map<string, string>();
async function packageHash(manifest: PluginManifest, source: string): Promise<string> {
  const text = JSON.stringify(manifest) + "\n" + source;
  let h = hashes.get(text);
  if (!h) {
    h = await sha256Hex(text);
    if (hashes.size > 50) hashes.clear();
    hashes.set(text, h);
  }
  return h;
}

/** Every installed plugin with this device's approval. Rows whose manifest no longer checks out are left out. */
export async function listPlugins(): Promise<PluginRecord[]> {
  const device = deviceId();
  const rows = await sql().select(`SELECT plugin_id, manifest, source, origin, installed_at FROM plugins ORDER BY installed_at`);
  const grants = await sql().select(`SELECT * FROM plugin_grants WHERE device = ?`, [device]);
  const out: PluginRecord[] = [];
  for (const r of rows) {
    const checked = validateManifest(json(r.manifest, null));
    if (!checked.ok || checked.manifest.id !== r.plugin_id) continue;
    const grant = toGrant(grants.find((g) => g.plugin_id === r.plugin_id));
    const source = String(r.source);
    const sha256 = await packageHash(checked.manifest, source);
    let origin = typeof r.origin === "string" && r.origin ? r.origin : null;
    // "From Lactic" is only ever shown for a package Lactic shipped; a row (from sync, a backup or
    // an edit) can't claim it.
    if (origin === CATALOG_ORIGIN && !(await isCatalogPackage(sha256))) origin = null;
    out.push({ pluginId: String(r.plugin_id), manifest: checked.manifest, source, sha256, installedAt: String(r.installed_at), origin, grant, state: pluginState(sha256, grant) });
  }
  return out;
}

export async function getPlugin(pluginId: string): Promise<PluginRecord | null> {
  return (await listPlugins()).find((p) => p.pluginId === pluginId) ?? null;
}

/** Read a chosen file and say what adding it would do: a new plugin, an update, the same file, or a refusal. Nothing is saved. */
export async function preparePackage(text: string): Promise<Prepared> {
  const parsed = await parsePackage(text);
  if (!parsed.ok) return { kind: "refused", reason: parsed.reason, details: parsed.details };
  const current = await getPlugin(parsed.pkg.manifest.id);
  if (!current) return { kind: "new", pkg: parsed.pkg };
  if (current.sha256 === parsed.pkg.sha256) return { kind: "same", current };
  return { kind: "update", pkg: parsed.pkg, current, changes: updateChanges(current.manifest, parsed.pkg.manifest) };
}

async function saveGrant(pluginId: string, g: Grant) {
  const now = new Date().toISOString();
  await sql().execute(
    `INSERT INTO plugin_grants (id, plugin_id, device, sha256, read, enabled, coach_visible, switched_off, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (plugin_id, device) DO UPDATE SET sha256 = excluded.sha256, read = excluded.read, enabled = excluded.enabled,
       coach_visible = excluded.coach_visible, switched_off = excluded.switched_off, updated_at = excluded.updated_at`,
    [crypto.randomUUID(), pluginId, deviceId(), g.sha256, JSON.stringify(g.read), g.enabled ? 1 : 0, g.coachVisible ? 1 : 0, g.switchedOff ?? null, now, now],
  );
}

/** `origin` is where this exact file came from (null for a chosen file), so the source line never claims a repo the code didn't come from. */
async function savePackage(pkg: PluginPackage, origin: string | null) {
  if (origin === CATALOG_ORIGIN && !(await isCatalogPackage(pkg.sha256))) throw new Error("That isn't one of Lactic's plugins.");
  const now = new Date().toISOString();
  const m = pkg.manifest;
  await sql().execute(
    `INSERT INTO plugins (id, plugin_id, name, version, manifest, source, sha256, origin, installed_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (plugin_id) DO UPDATE SET name = excluded.name, version = excluded.version, manifest = excluded.manifest,
       source = excluded.source, sha256 = excluded.sha256, origin = excluded.origin, updated_at = excluded.updated_at`,
    [crypto.randomUUID(), m.id, m.name, m.version, JSON.stringify(m), pkg.source, pkg.sha256, origin, now, now],
  );
  notify();
}

/** Add a new plugin, approved and switched on for this device with the rider's choices. */
export async function installPlugin(pkg: PluginPackage, choices: InstallChoices = {}, origin: string | null = null) {
  if (await getPlugin(pkg.manifest.id)) throw new Error(`${pkg.manifest.name} is already added; add it as an update instead`);
  await savePackage(pkg, origin);
  await saveGrant(pkg.manifest.id, { sha256: pkg.sha256, read: grantedGroups(pkg.manifest, choices), enabled: true, coachVisible: choices.coachVisible === true, switchedOff: null });
  notify();
}

/**
 * Replace an installed plugin with a file the rider approved on the update screen. Groups new to
 * this version are approved by that tap (the screen marks them); location still needs its own tick.
 * With no approval on this device yet, the screen shows the full permission list instead.
 */
export async function updatePlugin(pkg: PluginPackage, choices: InstallChoices = {}, origin: string | null = null) {
  const current = await getPlugin(pkg.manifest.id);
  if (!current) throw new Error("That plugin isn't added");
  await savePackage(pkg, origin);
  await saveGrant(pkg.manifest.id, updatedGrant(current.grant, pkg.manifest, pkg.sha256, choices));
  notify();
}

/** Approve a plugin on this device: one that came by sync or a backup, or a changed package. Same screen as install. */
export async function approvePlugin(pluginId: string, choices: InstallChoices = {}) {
  const p = await getPlugin(pluginId);
  if (!p) throw new Error("That plugin isn't added");
  await saveGrant(pluginId, { sha256: p.sha256, read: grantedGroups(p.manifest, choices), enabled: true, coachVisible: choices.coachVisible === true, switchedOff: null });
  notify();
}

/** Switch on or off on this device. Switching on needs this exact package approved here first. */
export async function setPluginEnabled(pluginId: string, enabled: boolean) {
  const p = await getPlugin(pluginId);
  if (!p?.grant || p.grant.sha256 !== p.sha256) throw new Error("Approve this plugin on this device first");
  await saveGrant(pluginId, { ...p.grant, enabled, switchedOff: null });
  notify();
}

export async function setCoachVisible(pluginId: string, coachVisible: boolean) {
  const p = await getPlugin(pluginId);
  if (!p?.grant) throw new Error("Approve this plugin on this device first");
  await saveGrant(pluginId, { ...p.grant, coachVisible });
  notify();
}

/** Lactic switched the plugin off (crashes, running late). It stays off until the rider turns it on again. */
export async function markSwitchedOff(pluginId: string, reason: string) {
  const p = await getPlugin(pluginId);
  if (!p?.grant) return;
  await saveGrant(pluginId, { ...p.grant, enabled: false, switchedOff: reason.slice(0, 200) });
  notify();
}

/** Remove a plugin and everything it published, on every device. Its cards become placeholders (review U12). */
export async function removePlugin(pluginId: string) {
  await sql().batch([
    { sql: `DELETE FROM plugin_values WHERE plugin_id = ?`, params: [pluginId] },
    { sql: `DELETE FROM plugin_analyses WHERE plugin_id = ?`, params: [pluginId] },
    { sql: `DELETE FROM plugin_grants WHERE plugin_id = ?`, params: [pluginId] },
    { sql: `DELETE FROM plugins WHERE plugin_id = ?`, params: [pluginId] },
  ]);
  notify();
}

/**
 * Store numbers a plugin published, for a day and optionally a ride. Only metrics its manifest
 * declares, as finite numbers or its fixed choices; anything else is dropped. Live values should be
 * stored as ride summaries, not every tick (review S10); the per-plugin cap keeps it bounded anyway.
 */
export async function recordValues(pluginId: string, values: Record<string, number | string | null>, at: { day: string; activityId?: string }) {
  const p = await getPlugin(pluginId);
  if (!p || p.state !== "on" || !/^\d{4}-\d\d-\d\d$/.test(at.day)) return 0;
  const now = new Date().toISOString();
  const statements: { sql: string; params: (string | number | null)[] }[] = [];
  for (const [metric, v] of Object.entries(values)) {
    const def = p.manifest.publishes.find((m) => `plugin.${pluginId}.${m.id}` === metric);
    if (!def || v === null) continue;
    const num = def.kind === "number" && typeof v === "number" && Number.isFinite(v) ? v : null;
    const choice = def.kind === "choice" && typeof v === "string" && def.choices.includes(v) ? v : null;
    if (num === null && choice === null) continue;
    if (at.activityId) statements.push({ sql: `DELETE FROM plugin_values WHERE metric = ? AND activity_id = ?`, params: [metric, at.activityId] });
    statements.push({
      sql: `INSERT INTO plugin_values (id, plugin_id, metric, day, activity_id, value, choice, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      params: [crypto.randomUUID(), pluginId, metric, at.day, at.activityId ?? null, num, choice, now, now],
    });
  }
  if (!statements.length) return 0;
  statements.push({
    sql: `DELETE FROM plugin_values WHERE plugin_id = ? AND id NOT IN (SELECT id FROM plugin_values WHERE plugin_id = ? ORDER BY created_at DESC LIMIT ?)`,
    params: [pluginId, pluginId, MAX_VALUES_PER_PLUGIN],
  });
  await sql().batch(statements);
  return statements.length;
}

/** A metric's stored values between two days, inclusive, oldest first. */
export async function readValues(metric: string, from: string, to: string): Promise<{ date: string; rideId?: string; value: number | string }[]> {
  const rows = await sql().select(`SELECT day, activity_id, value, choice FROM plugin_values WHERE metric = ? AND day >= ? AND day <= ? ORDER BY day, created_at`, [metric, from, to]);
  return rows.map((r) => ({ date: String(r.day), ...(r.activity_id ? { rideId: String(r.activity_id) } : {}), value: r.choice !== null && r.choice !== undefined ? String(r.choice) : Number(r.value) }));
}

/** Screens listen for "lactic:plugins" to refresh. */
function notify() {
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("lactic:plugins"));
}
