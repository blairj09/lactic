// Ride analyses: plugins that look at one saved ride and draw on its ride page (a table of
// intervals, a profile with marked stretches). They run once per ride and plugin version, never
// during a ride, in the plugin's own sandbox worker with the analysis budget (2 s, 128 KB).
// What they draw is checked by validateKit; the numbers they publish are stored per ride.
import { sql } from "~/db/sql";
import { createClient } from "~/db/supabase-client";
import { loadAthlete, loadRide, loadStream } from "@/lib/activities";
import { localDate } from "@/lib/engine/activity";
import { validateKit, type KitNode } from "@shared/sdk";
import { FAILURE_WORDS, type TickFailure, type WorkerLike } from "./host";
import { anyHiddenText } from "./validate";
import { rideInput } from "./ride-input";
import { pluginHost } from "./running";
import { listPlugins, recordValues, type PluginRecord } from "./store";

export interface AnalysisResult {
  pluginId: string;
  pluginName: string;
  version: string;
  analysis: string;
  title: string;
  tree: KitNode | null;
  /** Why there's nothing to show, in Lactic's own words. */
  failed: string | null;
}

/** What's stored in `failed`: a failure kind or "empty", never the plugin's words. Read back through this list. */
const FAILED_WORDS: Record<string, string> = { ...FAILURE_WORDS, timeout: "took longer than 2 seconds", empty: "had nothing to show" };
const failedWords = (code: unknown) => (typeof code === "string" && Object.hasOwn(FAILED_WORDS, code) ? FAILED_WORDS[code] : FAILED_WORDS.empty);

/** Plugins that are on here, have analyses, and were granted rides. */
function analyzers(all: PluginRecord[]): PluginRecord[] {
  return all.filter((p) => p.state === "on" && (p.manifest.contributes.analyses ?? []).length > 0 && p.grant?.read.includes("rides"));
}

/** Stored results for a ride, from plugins still on here and only for their current package. */
export async function rideAnalyses(activityId: string): Promise<AnalysisResult[]> {
  const plugins = analyzers(await listPlugins());
  if (!plugins.length) return [];
  const rows = await sql().select(`SELECT plugin_id, analysis, sha256, tree, failed FROM plugin_analyses WHERE activity_id = ?`, [activityId]);
  const out: AnalysisResult[] = [];
  for (const p of plugins) {
    for (const a of p.manifest.contributes.analyses ?? []) {
      const r = rows.find((x) => x.plugin_id === p.pluginId && x.analysis === a.id && x.sha256 === p.sha256);
      if (!r) continue;
      // Checked again on the way out: the row could have come by sync or a restore.
      let tree: KitNode | null = null;
      if (typeof r.tree === "string") {
        try {
          const raw = JSON.parse(r.tree);
          const kit = anyHiddenText(raw) ? null : validateKit(raw, { fromPlugin: true });
          tree = kit?.ok ? kit.node : null;
        } catch {
          tree = null;
        }
      }
      out.push({ pluginId: p.pluginId, pluginName: p.manifest.name, version: p.manifest.version, analysis: a.id, title: a.title, tree, failed: tree ? null : failedWords(r.failed) });
    }
  }
  return out;
}

async function save(p: PluginRecord, analysis: string, activityId: string, tree: KitNode | null, failed: string | null) {
  const now = new Date().toISOString();
  await sql().execute(
    `INSERT INTO plugin_analyses (id, plugin_id, analysis, activity_id, sha256, tree, failed, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (plugin_id, analysis, activity_id) DO UPDATE SET sha256 = excluded.sha256, tree = excluded.tree, failed = excluded.failed, updated_at = excluded.updated_at`,
    [crypto.randomUUID(), p.pluginId, analysis, activityId, p.sha256, tree ? JSON.stringify(tree) : null, failed, now, now],
  );
}

/**
 * Run every analysis that hasn't run on this ride with the current plugin package. Call it after a
 * ride is saved or when its page opens, never while riding. Returns how many ran.
 */
export async function analyzeRide(activityId: string, createWorker: () => WorkerLike, { force = false }: { force?: boolean } = {}): Promise<number> {
  const plugins = analyzers(await listPlugins());
  if (!plugins.length) return 0;
  const supabase = createClient();
  const [ride, stream, athlete] = await Promise.all([loadRide(supabase as never, activityId), loadStream(supabase as never, activityId), loadAthlete(supabase as never)]);
  if (!ride) return 0;
  const done = force ? [] : await sql().select(`SELECT plugin_id, analysis, sha256 FROM plugin_analyses WHERE activity_id = ?`, [activityId]);
  const metrics = {
    "profile.ftp": athlete.ftp,
    "profile.weight": athlete.weightKg,
    "profile.wkg": athlete.ftp && athlete.weightKg ? athlete.ftp / athlete.weightKg : null,
    "ride.np": ride.normalizedPower,
    "ride.tss": ride.trainingStress,
    "ride.duration": ride.durationSeconds,
    "ride.avg_hr": ride.averageHr,
  };
  const day = localDate(ride.startedAt, athlete.timezone);
  let ran = 0;
  for (const p of plugins) {
    const todo = (p.manifest.contributes.analyses ?? []).filter((a) => !done.some((d) => d.plugin_id === p.pluginId && d.analysis === a.id && d.sha256 === p.sha256));
    if (!todo.length) continue;
    const input = rideInput(ride, stream as never, p.grant!.read);
    if (!input) continue;
    const host = await pluginHost(p, createWorker);
    if (!host) continue;
    for (const a of todo) {
      // A ride field may be mid-tick on the same host; wait it out rather than queue.
      let r = await host.analyze(a.entry, input, metrics, Date.now() / 1000);
      for (let tries = 0; !r.ok && r.reason === "busy" && tries < 20; tries++) {
        await new Promise((res) => setTimeout(res, 50));
        r = await host.analyze(a.entry, input, metrics, Date.now() / 1000);
      }
      ran++;
      if (r.ok) {
        await save(p, a.id, activityId, r.output.tree ?? null, r.output.tree ? null : "empty");
        if (r.output.metrics) await recordValues(p.pluginId, r.output.metrics, { day, activityId });
      } else await save(p, a.id, activityId, null, r.reason satisfies TickFailure);
    }
  }
  return ran;
}
