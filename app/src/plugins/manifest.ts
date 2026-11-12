// Parse and validate a plugin's manifest.json. Strict: unknown keys anywhere are refused, every
// string is length-limited, and anything v1 doesn't allow (internet, secrets, writes) is refused
// with a plain reason. Names and labels come only from here, are shown to the rider at install, and
// reach the coach (if ever) marked untrusted; plugin code itself can only publish numbers.
import { isMetricId, pluginMetricId, type MetricGroup } from "@shared/sdk";

/** Groups a plugin can ask to read (the SDK's MetricGroup). Race report data has no group, so it is
 *  never offered to plugins (review S5). */
export const METRIC_GROUPS: readonly MetricGroup[] = ["live", "rides", "fitness", "profile", "recovery", "location"];

export const PLUGIN_API_VERSION = 1;

export type PublishedMetric =
  | { id: string; label: string; unit?: string; kind: "number" }
  | { id: string; label: string; kind: "choice"; choices: string[] };

export interface Contribution {
  id: string;
  title: string;
  /** Name of the handler the plugin passes to `lactic.register`. */
  entry: string;
}

/** The ids the rest of Lactic sees for a manifest's published metrics. */
export function publishedMetricId(m: Pick<PluginManifest, "id">, name: string): string {
  return pluginMetricId(m.id, name);
}

export interface PluginManifest {
  apiVersion: 1;
  id: string;
  name: string;
  version: string;
  description: string;
  author?: string;
  homepage?: string;
  main: string;
  permissions: { read: MetricGroup[] };
  publishes: PublishedMetric[];
  contributes: { widgets: Contribution[]; fields: Contribution[] };
}

export type ManifestResult = { ok: true; manifest: PluginManifest } | { ok: false; errors: string[] };

const ID_RE = /^[a-z0-9][a-z0-9-]{1,39}$/;
const SEMVER_RE = /^\d{1,4}\.\d{1,4}\.\d{1,4}(?:-[0-9A-Za-z.-]{1,20})?$/;
const MAIN_RE = /^[A-Za-z0-9_-]{1,40}\.js$/;
// A published metric's name; Lactic files it under "plugin.<plugin id>.<name>" (SDK pluginMetricId).
const METRIC_NAME_RE = /^[a-z0-9_]{1,24}(?:\.[a-z0-9_-]{1,24}){0,2}$/;
const ENTRY_RE = /^[A-Za-z_$][A-Za-z0-9_$]{0,39}$/;
const CHOICE_RE = /^[a-z0-9][a-z0-9-]{0,23}$/;
// Control characters and invisible direction/format marks that could disguise a name.
const HIDDEN_CHARS = /[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁠-⁤⁦-⁩﻿]/;

/** Internet, secrets and writes are not part of v1; say so rather than "unknown key". */
const NOT_IN_V1: Record<string, string> = {
  network: "Plugins can't use the internet in this version of Lactic.",
  internet: "Plugins can't use the internet in this version of Lactic.",
  sites: "Plugins can't use the internet in this version of Lactic.",
  secrets: "Plugins can't use API keys or secrets in this version of Lactic.",
  write: "Plugins can't change your data in this version of Lactic.",
  propose: "Plugins can't propose changes in this version of Lactic.",
  trainer: "Plugins can never control the trainer.",
};

class Checker {
  errors: string[] = [];
  fail(path: string, msg: string) {
    this.errors.push(`${path}: ${msg}`);
  }
  obj(v: unknown, path: string, allowed: string[], required: string[]): Record<string, unknown> | null {
    if (typeof v !== "object" || v === null || Array.isArray(v)) {
      this.fail(path, "must be an object");
      return null;
    }
    const o = v as Record<string, unknown>;
    for (const k of Object.keys(o)) {
      if (k in NOT_IN_V1) this.fail(`${path}.${k}`, NOT_IN_V1[k]);
      else if (!allowed.includes(k)) this.fail(`${path}.${k}`, "is not a known manifest field");
    }
    for (const k of required) if (!(k in o)) this.fail(`${path}.${k}`, "is required");
    return o;
  }
  str(v: unknown, path: string, max: number, re?: RegExp): string | undefined {
    if (typeof v !== "string") {
      this.fail(path, "must be text");
      return undefined;
    }
    if (v.length === 0 || v.length > max) this.fail(path, `must be 1 to ${max} characters`);
    else if (HIDDEN_CHARS.test(v)) this.fail(path, "contains hidden characters");
    else if (re && !re.test(v)) this.fail(path, "has an invalid format");
    return v;
  }
  arr(v: unknown, path: string, max: number): unknown[] {
    if (!Array.isArray(v)) {
      this.fail(path, "must be a list");
      return [];
    }
    if (v.length > max) this.fail(path, `can have at most ${max} entries`);
    return v.slice(0, max);
  }
}

/** True when a name could pass for Lactic's own ("Lactic Official", "LACT1C", "Lаctic" in Cyrillic). */
export function looksLikeLactic(name: string): boolean {
  const confusables: Record<string, string> = { "0": "o", "1": "l", "!": "i", "|": "l", "3": "e", "4": "a", "5": "s", "7": "t", "а": "a", "с": "c", "і": "i", "к": "k", "т": "t", "ӏ": "l" };
  const flatten = (s: string) =>
    s
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .split("")
      .map((ch) => confusables[ch] ?? ch)
      .join("");
  const flat = flatten(name);
  // "L a c t i c", "Lactic-Pro": the name with everything but letters taken out contains it.
  if (flat.replace(/[^a-z]/g, "").includes("lactic")) return true;
  // "Laktic", "Lactlc": a word one letter away.
  return flat.split(/[^a-z]+/).some((word) => word.length >= 5 && word.length <= 7 && editDistance(word, "lactic") <= 1);
}

function editDistance(a: string, b: string): number {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...new Array<number>(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return dp[a.length][b.length];
}

/** Validate a parsed manifest.json value. Pass the raw text through `parseManifestText` first. */
export function validateManifest(raw: unknown): ManifestResult {
  const c = new Checker();
  const top = c.obj(
    raw,
    "manifest",
    ["apiVersion", "id", "name", "version", "description", "author", "homepage", "main", "permissions", "publishes", "contributes"],
    ["apiVersion", "id", "name", "version", "description", "main", "permissions", "contributes"],
  );
  if (!top) return { ok: false, errors: c.errors };

  if (top.apiVersion !== PLUGIN_API_VERSION) c.fail("manifest.apiVersion", `must be ${PLUGIN_API_VERSION}`);
  const id = c.str(top.id, "manifest.id", 40, ID_RE);
  if (id && /lactic|laktic/.test(id.replace(/-/g, ""))) c.fail("manifest.id", "can't use the Lactic name");
  const name = c.str(top.name, "manifest.name", 40);
  if (name && looksLikeLactic(name)) c.fail("manifest.name", "can't look like Lactic's own name");
  const version = c.str(top.version, "manifest.version", 32, SEMVER_RE);
  const description = c.str(top.description, "manifest.description", 200);
  const author = top.author === undefined ? undefined : c.str(top.author, "manifest.author", 60);
  let homepage: string | undefined;
  if (top.homepage !== undefined) {
    homepage = c.str(top.homepage, "manifest.homepage", 200);
    if (homepage && !/^https:\/\/[^\s/]+\/\S*$/.test(homepage)) c.fail("manifest.homepage", "must be an https link");
  }
  const main = c.str(top.main, "manifest.main", 43, MAIN_RE);

  const read: MetricGroup[] = [];
  const perms = c.obj(top.permissions, "manifest.permissions", ["read"], ["read"]);
  if (perms) {
    c.arr(perms.read, "manifest.permissions.read", METRIC_GROUPS.length).forEach((g, i) => {
      if (typeof g !== "string" || !(METRIC_GROUPS as readonly string[]).includes(g)) c.fail(`manifest.permissions.read[${i}]`, `must be one of ${METRIC_GROUPS.join(", ")}`);
      else if (read.includes(g as MetricGroup)) c.fail(`manifest.permissions.read[${i}]`, "is listed twice");
      else read.push(g as MetricGroup);
    });
  }

  const publishes: PublishedMetric[] = [];
  const metricIds = new Set<string>();
  c.arr(top.publishes ?? [], "manifest.publishes", 32).forEach((m, i) => {
    const p = `manifest.publishes[${i}]`;
    const o = c.obj(m, p, ["id", "label", "unit", "kind", "choices"], ["id", "label", "kind"]);
    if (!o) return;
    const mid = c.str(o.id, `${p}.id`, 40, METRIC_NAME_RE);
    if (mid && id && !isMetricId(pluginMetricId(id, mid))) c.fail(`${p}.id`, "has an invalid format");
    const label = c.str(o.label, `${p}.label`, 40);
    if (mid && metricIds.has(mid)) c.fail(`${p}.id`, "is listed twice");
    if (mid) metricIds.add(mid);
    if (o.kind === "number") {
      if (o.choices !== undefined) c.fail(`${p}.choices`, "only applies to choice metrics");
      const unit = o.unit === undefined ? undefined : c.str(o.unit, `${p}.unit`, 12);
      if (mid && label) publishes.push(unit ? { id: mid, label, unit, kind: "number" } : { id: mid, label, kind: "number" });
    } else if (o.kind === "choice") {
      if (o.unit !== undefined) c.fail(`${p}.unit`, "only applies to number metrics");
      const choices = c.arr(o.choices, `${p}.choices`, 12).map((ch, j) => c.str(ch, `${p}.choices[${j}]`, 24, CHOICE_RE));
      if (choices.length === 0) c.fail(`${p}.choices`, "needs at least one choice");
      if (mid && label && choices.every((x): x is string => !!x)) publishes.push({ id: mid, label, kind: "choice", choices });
    } else c.fail(`${p}.kind`, 'must be "number" or "choice"');
  });

  const contributions = (key: "widgets" | "fields", v: unknown): Contribution[] => {
    const out: Contribution[] = [];
    const ids = new Set<string>();
    c.arr(v ?? [], `manifest.contributes.${key}`, key === "widgets" ? 16 : 32).forEach((w, i) => {
      const p = `manifest.contributes.${key}[${i}]`;
      const o = c.obj(w, p, ["id", "title", "entry"], ["id", "title", "entry"]);
      if (!o) return;
      const wid = c.str(o.id, `${p}.id`, 40, ID_RE);
      const title = c.str(o.title, `${p}.title`, 40);
      const entry = c.str(o.entry, `${p}.entry`, 40, ENTRY_RE);
      if (wid && ids.has(wid)) c.fail(`${p}.id`, "is listed twice");
      if (wid) ids.add(wid);
      if (wid && title && entry) out.push({ id: wid, title, entry });
    });
    return out;
  };
  let widgets: Contribution[] = [];
  let fields: Contribution[] = [];
  const contributes = c.obj(top.contributes, "manifest.contributes", ["widgets", "fields"], []);
  if (contributes) {
    widgets = contributions("widgets", contributes.widgets);
    fields = contributions("fields", contributes.fields);
    if (widgets.length + fields.length === 0 && c.errors.length === 0) c.fail("manifest.contributes", "must add at least one widget or field");
  }

  if (c.errors.length || !id || !name || !version || !description || !main) return { ok: false, errors: c.errors.length ? c.errors : ["manifest: invalid"] };
  return {
    ok: true,
    manifest: {
      apiVersion: 1,
      id,
      name,
      version,
      description,
      ...(author ? { author } : {}),
      ...(homepage ? { homepage } : {}),
      main,
      permissions: { read },
      publishes,
      contributes: { widgets, fields },
    },
  };
}

export const MAX_MANIFEST_BYTES = 16 * 1024;

/** Parse manifest.json text (size-limited) and validate it. */
export function parseManifestText(text: string): ManifestResult {
  if (text.length > MAX_MANIFEST_BYTES) return { ok: false, errors: ["manifest: is too large"] };
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, errors: ["manifest: is not valid JSON"] };
  }
  return validateManifest(raw);
}

/** Every handler name the manifest points at; the sandbox refuses calls to anything else. */
export function manifestEntries(m: PluginManifest): string[] {
  return [...new Set([...m.contributes.widgets, ...m.contributes.fields].map((c) => c.entry))];
}
