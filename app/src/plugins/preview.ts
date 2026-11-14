// A plugin preview: before a rider adds a plugin, Lactic runs it once on a made-up rider and ride
// (preview-sample.ts) so the add screen can show what it actually draws. It runs in its own sandbox
// host like any plugin (same worker, limits and output checks), is never handed the rider's data, a
// GPS route or a database, and is stopped when the screen closes. Nothing it publishes is kept.
// Failures come back in Lactic's own words.
import { fieldFromKit, PLUGIN_FIELD_WORDS, type PluginFieldValue } from "@/lib/sdk/plugin-fields";
import type { KitNode } from "@shared/sdk";
import { isRiding } from "@/lib/live-ride";
import { FAILURE_WORDS, PluginHost, type TickResult, type WorkerLike } from "./host";
import type { PluginManifest } from "./manifest";
import { FIELDS_UNTIL, SAMPLE_DAY, sampleLiveNumbers, sampleRide, sampleRideInput } from "./preview-sample";

export type PreviewKind = "field" | "analysis" | "card";

export interface PreviewPart {
  kind: PreviewKind;
  id: string;
  title: string;
  /** A ride field's number, line and chart. */
  field?: PluginFieldValue;
  /** A ride page section's or card's checked tree. */
  tree?: KitNode;
  /** Why there's nothing to show, in Lactic's words. */
  failed?: string;
}

export interface PreviewState {
  parts: PreviewPart[];
  /** Sample ride seconds played so far, and in all. */
  at: number;
  of: number;
  done: boolean;
  /** Set when the plugin couldn't run at all, or a ride started. */
  failed?: string;
  /** The preview ran out of time: what's shown is as far as it got. */
  cut?: boolean;
  /** Parts past the caps, not previewed. */
  more: number;
}

/**
 * A preview runs code the rider hasn't approved yet, so it gets a fixed allowance: at most this many
 * of each kind of part, and this long in all (wall clock) before it stops and shows what it has.
 */
export const PREVIEW_LIMITS = { fields: 6, analyses: 3, cards: 3, ms: 12_000 };

export const PREVIEW_WORDS = { cut: "Preview cut short", riding: "No preview during a ride.", skipped: "wasn't previewed" } as const;

/** Ride seconds between preview ticks. One, like a real ride: plugins keep their own per-tick history ("last 5 minutes" = 300 ticks). */
export const PREVIEW_STEP = 1;

const words = (r: Extract<TickResult, { ok: false }>) => (Object.hasOwn(FAILURE_WORDS, r.reason) ? FAILURE_WORDS[r.reason] : FAILURE_WORDS.error);

/** The parts a preview will draw, before anything has run. */
export function previewParts(m: PluginManifest): PreviewPart[] {
  const L = PREVIEW_LIMITS;
  return [
    ...m.contributes.fields.slice(0, L.fields).map((c) => ({
      kind: "field" as const,
      id: c.id,
      title: c.title,
    })),
    ...(m.contributes.analyses ?? []).slice(0, L.analyses).map((c) => ({
      kind: "analysis" as const,
      id: c.id,
      title: c.title,
    })),
    ...m.contributes.widgets.slice(0, L.cards).map((c) => ({
      kind: "card" as const,
      id: c.id,
      title: c.title,
    })),
  ];
}

/** How many of a manifest's parts the caps leave out. */
export const previewMore = (m: PluginManifest) => m.contributes.fields.length + (m.contributes.analyses ?? []).length + m.contributes.widgets.length - previewParts(m).length;

/**
 * Run a plugin on the sample ride: its ride fields tick through the ride (reporting as they go),
 * then its ride analyses run on the finished ride and its cards on the sample day. `onUpdate` gets
 * each new state; `signal` stops it (the worker is ended either way). Never stores anything. It
 * stops after PREVIEW_LIMITS.ms, and gives up at once if a ride is under way or starts.
 */
export async function runPreview(
  manifest: PluginManifest,
  source: string,
  createWorker: () => WorkerLike,
  onUpdate: (s: PreviewState) => void,
  signal: AbortSignal,
  {
    step = PREVIEW_STEP,
    every = 30,
    startedAt = Date.UTC(2026, 0, 4, 8) / 1000,
    budgetMs = PREVIEW_LIMITS.ms,
    riding = isRiding,
    clock = () => Date.now(),
  }: { step?: number; every?: number; startedAt?: number; budgetMs?: number; riding?: () => boolean; clock?: () => number } = {},
): Promise<PreviewState> {
  const ride = sampleRide();
  const parts = previewParts(manifest);
  const until = Math.min(ride.seconds, FIELDS_UNTIL);
  const state: PreviewState = { parts, at: 0, of: until, done: false, more: previewMore(manifest) };
  const deadline = clock() + budgetMs;
  const emit = () => !signal.aborted && onUpdate({ ...state, parts: parts.map((p) => ({ ...p })) });
  // No location for previews: the sample ride has no route, so the manifest is cut to the rest.
  const shown: PluginManifest = {
    ...manifest,
    permissions: {
      read: manifest.permissions.read.filter((g) => g !== "location"),
    },
  };
  const host = new PluginHost(shown, source, createWorker, {
    policy: { maxCrashes: 1, maxConsecutiveOverruns: 3 },
  });
  const stop = () => host.stop("preview closed");
  signal.addEventListener("abort", stop);
  // A ride is under way: say so and stop, so the ride's main thread never shares time with a preview.
  const rideStarted = () => {
    if (!riding()) return false;
    state.failed = PREVIEW_WORDS.riding;
    state.done = true;
    emit();
    return true;
  };
  try {
    if (rideStarted()) return state;
    if (!(await host.start())) {
      state.failed = `It ${host.disabledReason ?? FAILURE_WORDS["not-loaded"]}.`;
      state.done = true;
      emit();
      return state;
    }
    const fields = parts.filter((p) => p.kind === "field");
    const entry = (p: PreviewPart) =>
      (p.kind === "field" ? manifest.contributes.fields : p.kind === "analysis" ? (manifest.contributes.analyses ?? []) : manifest.contributes.widgets).find((c) => c.id === p.id)!.entry;

    if (fields.length) {
      for (let t = 0; t < until && !signal.aborted; t += step) {
        if (rideStarted()) return state;
        if (clock() > deadline) {
          state.cut = true;
          break;
        }
        const metrics = sampleLiveNumbers(t);
        for (const p of fields) {
          if (p.failed) continue;
          const r = await host.call(entry(p), metrics, startedAt + t);
          if (signal.aborted) break;
          if (!r.ok) {
            p.failed = r.reason === "disabled" ? PLUGIN_FIELD_WORDS.failed : words(r);
            continue;
          }
          const v = r.output.tree ? fieldFromKit(r.output.tree) : null;
          if (v) p.field = v;
        }
        state.at = Math.min(until, t + step);
        if ((t / step) % every === 0) emit();
      }
      for (const p of fields) if (!p.field && !p.failed) p.failed = PLUGIN_FIELD_WORDS.nothing;
    }
    if (signal.aborted) return state;
    if (!state.cut) state.at = until;
    for (const p of parts.filter((x) => x.kind !== "field")) {
      if (signal.aborted) break;
      if (rideStarted()) return state;
      if (clock() > deadline) {
        state.cut = true;
        p.failed = PREVIEW_WORDS.skipped;
        continue;
      }
      const r =
        p.kind === "analysis" ? await host.analyze(entry(p), sampleRideInput(startedAt), SAMPLE_DAY, startedAt + ride.seconds) : await host.call(entry(p), SAMPLE_DAY, startedAt + ride.seconds);
      if (r.ok && r.output.tree) p.tree = r.output.tree;
      else p.failed = r.ok ? "had nothing to show" : words(r);
    }
    if (signal.aborted) return state;
    state.done = true;
    emit();
    return state;
  } finally {
    signal.removeEventListener("abort", stop);
    stop();
  }
}
