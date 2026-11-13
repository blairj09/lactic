// Plugin ride fields while riding: once a ride second, each plugin field on the rider's pages runs in
// its plugin's sandbox host with the live numbers it was granted. Calls never queue and the ride never
// waits: a field that hasn't answered shows "–" with Lactic's words, and the host switches off a plugin
// that keeps running late or crashing. What a plugin returns has been checked by the host; only its
// number, line and tone are used, under the manifest's title.
import { useEffect, useRef, useState } from "react";
import { PLUGIN_FIELD_WORDS, fieldFromKit, parsePluginFieldId, pluginFieldId, type PluginFieldOption } from "@/lib/sdk/plugin-fields";
import type { FieldShown } from "@/lib/ride/fields";
import { pluginHost } from "./running";
import { createPluginWorker } from "./spawn";
import { listPlugins, type PluginRecord } from "./store";
import { pluginsAllowed } from "./use-plugin-tab";

/** Every field of every added plugin, for the picker. */
export function pluginFieldOptions(plugins: readonly PluginRecord[]): PluginFieldOption[] {
  return plugins.flatMap((p) => p.manifest.contributes.fields.map((f) => ({ id: pluginFieldId(p.pluginId, f.id), title: f.title, pluginName: p.manifest.name, on: p.state === "on" })));
}

/** The added plugins, kept up to date as they're added, switched or removed. Empty where plugins aren't allowed. */
export function usePlugins(): PluginRecord[] {
  const [plugins, setPlugins] = useState<PluginRecord[]>([]);
  useEffect(() => {
    if (!pluginsAllowed) return;
    let live = true;
    const load = () =>
      void listPlugins()
        .then((ps) => live && setPlugins(ps))
        .catch(() => undefined);
    load();
    window.addEventListener("lactic:plugins", load);
    return () => {
      live = false;
      window.removeEventListener("lactic:plugins", load);
    };
  }, []);
  return plugins;
}

const empty = (label: string, reason: string): FieldShown => ({ label, value: null, unit: "", ...(reason ? { reason, sub: reason } : {}), plugin: true });

function failureWords(reason: string): string {
  if (reason === "busy" || reason === "timeout") return PLUGIN_FIELD_WORDS.late;
  if (reason === "not-ready") return PLUGIN_FIELD_WORDS.starting;
  if (reason === "disabled") return PLUGIN_FIELD_WORDS.off;
  return PLUGIN_FIELD_WORDS.failed;
}

/**
 * The plugin fields among `ids`, as shown now. `tick` changes once a ride second (the elapsed
 * seconds); each change runs every field once with `numbers` (lib/ride/fields.ts liveNumbers).
 * Nothing runs while `running` is false; the last answer stays on screen.
 */
export function usePluginFields(plugins: readonly PluginRecord[], ids: readonly string[], numbers: Record<string, number | null>, tick: number, running: boolean): Record<string, FieldShown> {
  const [shown, setShown] = useState<Record<string, FieldShown>>({});
  const latest = useRef(numbers);
  latest.current = numbers;
  const key = [...new Set(ids.filter((id) => parsePluginFieldId(id)))].join(",");
  const find = (id: string) => {
    const ref = parsePluginFieldId(id)!;
    const p = plugins.find((x) => x.pluginId === ref.pluginId);
    return { p, field: p?.manifest.contributes.fields.find((f) => f.id === ref.fieldId) };
  };

  useEffect(() => {
    if (!key || !running) return;
    const metrics = latest.current;
    let live = true;
    const set = (id: string, f: FieldShown) => live && setShown((s) => ({ ...s, [id]: f }));
    for (const id of key.split(",")) {
      const { p, field } = find(id);
      if (!p || !field || p.state !== "on") continue;
      void (async () => {
        const host = await pluginHost(p, createPluginWorker);
        if (!host) return set(id, empty(field.title, PLUGIN_FIELD_WORDS.off));
        const r = await host.call(field.entry, metrics);
        if (!r.ok) return set(id, empty(field.title, failureWords(r.reason)));
        const v = r.output.tree ? fieldFromKit(r.output.tree) : null;
        set(id, v ? { label: field.title, value: v.value, unit: v.unit, ...(v.sub ? { sub: v.sub } : {}), ...(v.tone ? { tone: v.tone } : {}), plugin: true } : empty(field.title, PLUGIN_FIELD_WORDS.nothing));
      })().catch(() => set(id, empty(field.title, PLUGIN_FIELD_WORDS.failed)));
    }
    return () => {
      live = false;
    };
    // `find` only reads `plugins`, which is listed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, plugins, tick, running]);

  const out: Record<string, FieldShown> = {};
  for (const id of key ? key.split(",") : []) {
    const { p, field } = find(id);
    if (!p || !field) out[id] = empty("Plugin field", PLUGIN_FIELD_WORDS.removed);
    else if (p.state !== "on") out[id] = empty(field.title, PLUGIN_FIELD_WORDS.off);
    else out[id] = shown[id] ?? empty(field.title, running ? PLUGIN_FIELD_WORDS.starting : "");
  }
  return out;
}
