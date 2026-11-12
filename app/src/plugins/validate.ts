// Check what a plugin hands back before Lactic touches it, and trim what goes in to what the rider
// approved. Everything a plugin returns is untrusted: one bad key, one string where a number belongs,
// or one oversize tree and the whole tick is refused.
import { hasHiddenText, MetricRegistry, validateKit, type KitNode } from "@shared/sdk";
import { publishedMetricId, type PluginManifest } from "./manifest";

/** What one tick produced, after checking. Metric keys are full ids ("plugin.<id>.<name>"). */
export interface PluginOutput {
  tree?: KitNode;
  /** Published metrics: finite numbers, or one of the manifest's fixed choices. Never free text. */
  metrics?: Record<string, number | string | null>;
}

export type OutputCheck = { ok: true; output: PluginOutput } | { ok: false; error: string };

/** Numbers handed to plugins: the metric's value, or null when there's nothing. Never text. */
export type PluginInputMetrics = Record<string, number | null>;


function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;
}

function anyHiddenText(v: unknown, depth = 0): boolean {
  if (depth > 20) return true;
  if (typeof v === "string") return hasHiddenText(v, { emoji: true });
  if (Array.isArray(v)) return v.some((x) => anyHiddenText(x, depth + 1));
  if (isPlainObject(v)) return Object.values(v).some((x) => anyHiddenText(x, depth + 1));
  return false;
}

/** Validate the JSON a plugin handler returned. `json` is the raw text from the sandbox. */
export function checkOutput(json: string, manifest: PluginManifest, maxBytes: number): OutputCheck {
  if (json.length > maxBytes) return { ok: false, error: `output is larger than ${maxBytes} bytes` };
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return { ok: false, error: "output is not valid JSON" };
  }
  if (raw === null) return { ok: true, output: {} };
  if (!isPlainObject(raw)) return { ok: false, error: "output must be an object" };
  for (const k of Object.keys(raw)) if (k !== "tree" && k !== "metrics") return { ok: false, error: `output.${k} is not allowed` };
  if (anyHiddenText(raw)) return { ok: false, error: "output contains hidden characters" };

  const out: PluginOutput = {};
  if (raw.tree !== undefined) {
    // The SDK's gate: known kit parts only, rebuilt from known fields, capped, and plugin buttons can
    // only open the plugin's own detail view.
    const kit = validateKit(raw.tree, { fromPlugin: true });
    if (!kit.ok) return { ok: false, error: `output.tree: ${kit.error}` };
    out.tree = kit.node;
  }
  if (raw.metrics !== undefined) {
    if (!isPlainObject(raw.metrics)) return { ok: false, error: "output.metrics must be an object" };
    const metrics: Record<string, number | string | null> = {};
    for (const [name, v] of Object.entries(raw.metrics)) {
      const def = manifest.publishes.find((m) => m.id === name);
      if (!def) return { ok: false, error: `output.metrics.${name} is not declared in the manifest` };
      const id = publishedMetricId(manifest, name);
      if (v === null) metrics[id] = null;
      else if (def.kind === "number" && typeof v === "number" && Number.isFinite(v)) metrics[id] = v;
      else if (def.kind === "choice" && typeof v === "string" && def.choices.includes(v)) metrics[id] = v;
      else return { ok: false, error: `output.metrics.${name} must be ${def.kind === "number" ? "a finite number" : "one of the manifest's choices"}` };
    }
    out.metrics = metrics;
  }
  return { ok: true, output: out };
}

const registry = new MetricRegistry();

/** Only Lactic metrics in groups the rider approved, as numbers or null. Other plugins' metrics and
 *  anything unregistered never go in. */
export function approvedInput(manifest: PluginManifest, metrics: Record<string, number | null | { value: number | null }>): PluginInputMetrics {
  const allowed = new Set(manifest.permissions.read);
  const out: PluginInputMetrics = {};
  for (const [id, v] of Object.entries(metrics)) {
    const def = registry.get(id);
    if (!def || !allowed.has(def.group)) continue;
    const n = typeof v === "object" && v !== null ? v.value : v;
    out[id] = typeof n === "number" && Number.isFinite(n) ? n : null;
  }
  return out;
}
