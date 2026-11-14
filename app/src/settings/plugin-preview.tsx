// What a plugin looks like, on the add screen: Lactic runs it on a made-up ride and rider
// (plugins/preview.ts) and draws its ride fields, ride page sections and cards the way the app will.
// The plugin never sees the rider's own data here, and the run stops when the screen closes.
import { useEffect, useState } from "react";
import { Big } from "@/app/ride/field-grid";
import type { PluginManifest } from "~/plugins/manifest";
import { KitView, PluginFrame } from "~/plugins/kit-view";
import { PREVIEW_WORDS, previewMore, previewParts, runPreview, type PreviewKind, type PreviewPart, type PreviewState } from "~/plugins/preview";
import { createPluginWorker } from "~/plugins/spawn";

const WHERE: Record<PreviewKind, string> = {
  field: "Ride fields",
  analysis: "Ride page",
  card: "Plugins tab",
};

const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

// Ride fields sit in the same plugin frame as everything else a plugin draws, so nothing a plugin
// writes can pass for Lactic's own words on this screen (security review).
function Fields({ name, parts }: { name: string; parts: PreviewPart[] }) {
  return (
    <PluginFrame name={name} label={parts.length > 1 ? "ride fields" : "ride field"}>
      <div className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
        {parts.map((p) => (
          <Big
            key={p.id}
            label={p.title}
            value={p.field?.value ?? undefined}
            unit={p.field?.unit ?? ""}
            sub={p.field?.sub ?? p.failed ?? ""}
            tone={p.field?.tone}
            chart={p.field?.chart}
            size="text-3xl leading-[1.15]"
            plugin
          />
        ))}
      </div>
    </PluginFrame>
  );
}

function Framed({ name, part, running }: { name: string; part: PreviewPart; running: boolean }) {
  return (
    <PluginFrame name={name} label={part.title}>
      {part.tree ? <KitView node={part.tree} /> : <p className="text-muted">{part.failed ? `It ${part.failed}.` : running ? "…" : ""}</p>}
    </PluginFrame>
  );
}

export function PluginPreview({ manifest, source }: { manifest: PluginManifest; source: string }) {
  const [state, setState] = useState<PreviewState>(() => ({
    parts: previewParts(manifest),
    at: 0,
    of: 0,
    done: false,
    more: previewMore(manifest),
  }));
  useEffect(() => {
    const ac = new AbortController();
    void runPreview(manifest, source, createPluginWorker, setState, ac.signal).catch(() => !ac.signal.aborted && setState((s) => ({ ...s, done: true, failed: "It couldn't start." })));
    return () => ac.abort();
  }, [manifest, source]);

  if (!state.parts.length) return null;
  const running = !state.done;
  const groups = (["field", "analysis", "card"] as const).map((k) => [k, state.parts.filter((p) => p.kind === k)] as const).filter(([, ps]) => ps.length);

  return (
    <div className="space-y-3">
      <div className="flex items-baseline justify-between gap-3">
        <p className="font-medium">Preview</p>
        <p className="text-xs text-faint">
          {running && state.of ? `Sample ride · ${clock(state.at)} of ${clock(state.of)}` : state.cut ? `${PREVIEW_WORDS.cut} · sample data` : "Sample data, not yours"}
        </p>
      </div>
      {state.failed ? (
        <p className="text-muted">{state.failed === PREVIEW_WORDS.riding ? state.failed : `No preview: ${state.failed.charAt(0).toLowerCase() + state.failed.slice(1)}`}</p>
      ) : (
        groups.map(([kind, parts]) => (
          <div key={kind} className="space-y-1.5">
            <p className="text-xs text-muted">{WHERE[kind]}</p>
            {kind === "field" ? <Fields name={manifest.name} parts={parts} /> : parts.map((p) => <Framed key={p.id} name={manifest.name} part={p} running={running} />)}
          </div>
        ))
      )}
      {state.more > 0 && !state.failed && <p className="text-xs text-faint">{state.more} more not shown.</p>}
    </div>
  );
}
