// The built-in coach's plugin drafts (Lactic Modular). The coach sends a manifest and plain JavaScript;
// here Lactic packs them into an ordinary .lacticplugin file, checks it like any file a rider picks,
// and runs it on the sample ride in the sandbox (preview.ts). Only a draft that runs becomes a card in
// the chat, and that card opens the usual add or update screen. Nothing is saved or switched on here,
// and the coach can only replace a plugin it drafted itself.
import { checkDraftArgs } from "@/lib/coach/plugin-draft";
import type { Proposal } from "@/lib/coach/changes";
import { catalogEntries, COACH_ORIGIN } from "./catalog";
import type { WorkerLike } from "./host";
import { parsePackage, packagePlugin } from "./package";
import { compareVersions, GROUP_WORDS } from "./permissions";
import { runPreview, type PreviewState } from "./preview";
import { getPlugin } from "./store";

export { COACH_ORIGIN };

export interface DraftOutcome {
  /** For the coach: what ran and what it showed, or why it was refused. */
  content: string;
  proposal?: Proposal;
}

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;

/** "adds 1 ride field, 1 ride page section · reads live ride, profile" */
export function draftSummary(m: { permissions: { read: string[] }; contributes: { fields: unknown[]; widgets: unknown[]; analyses?: unknown[] } }): string {
  const c = m.contributes;
  const adds = [c.fields.length && plural(c.fields.length, "ride field"), c.analyses?.length && plural(c.analyses.length, "ride page section"), c.widgets.length && plural(c.widgets.length, "Plugins tab card")].filter(Boolean);
  const reads = m.permissions.read.map((g) => (g in GROUP_WORDS ? GROUP_WORDS[g as keyof typeof GROUP_WORDS].name.split(",")[0].toLowerCase() : g));
  return [adds.length && `adds ${adds.join(", ")}`, reads.length ? `reads ${reads.join(", ")}` : "reads nothing of yours"].filter(Boolean).join(" · ");
}

/** What the sample run showed, for the coach, or the failures it has to fix. */
function report(state: PreviewState): { ok: boolean; lines: string[] } {
  if (state.failed) return { ok: false, lines: [`The plugin didn't start: ${state.failed}`] };
  const lines: string[] = [];
  let ok = true;
  for (const p of state.parts) {
    const where = p.kind === "field" ? "ride field" : p.kind === "analysis" ? "ride page section" : "card";
    if (p.failed) {
      ok = false;
      lines.push(`${where} "${p.id}": ${p.failed}${p.kind === "field" ? " (a ride field needs a field or stat node with a short value and unit, see plugin_guide)" : ""}`);
    } else if (p.field) lines.push(`${where} "${p.id}" at the end of the sample ride: ${[p.field.value, p.field.unit, p.field.sub && `(${p.field.sub})`].filter(Boolean).join(" ")}`);
    else lines.push(`${where} "${p.id}" drew ${p.tree?.type ?? "nothing"}`);
  }
  return { ok, lines };
}

/**
 * draft_plugin: check the coach's draft and run it once on the sample ride. Throws a reason the coach
 * can act on; a draft that runs comes back as an add (or update) card for the rider.
 */
export async function draftPlugin(args: Record<string, unknown>, createWorker: () => WorkerLike, signal: AbortSignal = new AbortController().signal): Promise<DraftOutcome> {
  const draft = checkDraftArgs(args);
  const file = packagePlugin(draft.manifest, draft.code);
  const parsed = await parsePackage(file);
  if (!parsed.ok) throw new Error(`Lactic refused the plugin: ${parsed.details.join("; ")}`);
  const m = parsed.pkg.manifest;

  if (catalogEntries().some((e) => e.id === m.id)) throw new Error(`"${m.id}" is one of Lactic's own plugins: choose another id`);
  const current = await getPlugin(m.id);
  if (current && current.origin !== COACH_ORIGIN) throw new Error(`The rider already has a plugin with the id "${m.id}" that you didn't write: choose another id`);
  if (current && compareVersions(m.version, current.manifest.version) <= 0) throw new Error(`"${m.id}" is at ${current.manifest.version} already: give the change a higher version`);

  const ran = report(await runPreview(m, parsed.pkg.source, createWorker, () => {}, signal, { every: 1e9 }));
  if (!ran.ok) throw new Error(`On the sample ride: ${ran.lines.join("; ")}. Fix it and call draft_plugin again.`);

  const summary = `${current ? `Update ${m.name} to ${m.version}` : m.name}: ${draftSummary(m)}`;
  const proposal: Proposal = {
    change: { kind: "app", setting: { setting: "plugin_draft", file, name: m.name, version: m.version, update: Boolean(current), summary } },
    summary,
    reason: draft.reason,
    status: "pending",
  };
  return {
    content: JSON.stringify({
      drafted: summary,
      sampleRide: ran.lines,
      note: "Shown to the rider with Review and add. They see the code, its permissions and this preview before adding it. Nothing is added until they do.",
    }),
    proposal,
  };
}
