// Plugin cards for the Plugins tab: which cards exist on this computer, today's numbers they may read,
// and drawing one. Cards run in the plugin's own sandbox host; what comes back is checked by the
// host (validateKit, hidden text) before it reaches here. Never shown on Today.
import { createClient } from "~/db/supabase-client";
import { loadTrainingState } from "@/lib/training";
import type { KitNode } from "@shared/sdk";
import type { PluginCard } from "@/lib/sdk/plugin-screens";
import { FAILURE_WORDS, type WorkerLike } from "./host";
import { pluginHost } from "./running";
import { listPlugins, recordValues, type PluginRecord } from "./store";

export interface CardInfo extends PluginCard {
  pluginId: string;
  entry: string;
  /** Whether the plugin is on here. Off, not approved or removed cards draw a placeholder. */
  on: boolean;
}

export const cardId = (pluginId: string, widgetId: string) => `plugin.${pluginId}.${widgetId}`;

/** Every card of every added plugin, on here or not. */
export function pluginCards(plugins: PluginRecord[]): CardInfo[] {
  return plugins.flatMap((p) =>
    p.manifest.contributes.widgets.map((w) => ({ id: cardId(p.pluginId, w.id), pluginId: p.pluginId, pluginName: p.manifest.name, title: w.title, entry: w.entry, on: p.state === "on" })),
  );
}

/** Today's day numbers, all of them; the host passes on only the groups this plugin was granted. */
export async function dayMetrics(): Promise<{ day: string; metrics: Record<string, number | null> }> {
  const s = await loadTrainingState(createClient() as never);
  const r = s.recovery?.today;
  const { ftp, weightKg } = s.athlete;
  return {
    day: s.today,
    metrics: {
      "fitness.ctl": s.fitness,
      "fitness.atl": s.fatigue,
      "fitness.tsb": s.form,
      "profile.ftp": ftp,
      "profile.weight": weightKg,
      "profile.wkg": ftp && weightKg ? ftp / weightKg : null,
      "recovery.score": s.recovery?.score?.score ?? null,
      "recovery.hrv": r?.hrv ?? null,
      "recovery.resting_hr": r?.restingHeartRate ?? null,
      "recovery.sleep": r?.sleepHours ?? null,
    },
  };
}

export type CardResult = { tree: KitNode } | { failed: string };

/** Draw one card: run its entry with today's numbers. Failures come back in Lactic's own words. */
export async function drawCard(card: CardInfo, day: { day: string; metrics: Record<string, number | null> }, createWorker: () => WorkerLike): Promise<CardResult> {
  const p = (await listPlugins()).find((x) => x.pluginId === card.pluginId);
  if (!p || p.state !== "on") return { failed: FAILURE_WORDS.disabled };
  const host = await pluginHost(p, createWorker);
  if (!host) return { failed: FAILURE_WORDS["not-loaded"] };
  let r = await host.call(card.entry, day.metrics);
  for (let tries = 0; !r.ok && (r.reason === "busy" || r.reason === "not-ready") && tries < 20; tries++) {
    await new Promise((res) => setTimeout(res, 50));
    r = await host.call(card.entry, day.metrics);
  }
  if (!r.ok) return { failed: Object.hasOwn(FAILURE_WORDS, r.reason) ? FAILURE_WORDS[r.reason as keyof typeof FAILURE_WORDS] : FAILURE_WORDS.error };
  if (r.output.metrics) await recordValues(p.pluginId, r.output.metrics, { day: day.day });
  return r.output.tree ? { tree: r.output.tree } : { failed: "had nothing to show" };
}
