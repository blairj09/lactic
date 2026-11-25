// Settings → Your data → App history: every change to the plan, settings, workouts and plugins,
// who made it, what it changed, and Undo.

import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation } from "react-router";
import { button, Result } from "@/components/ui";
import { HISTORY_EVENT } from "./changes";
import type { ChangeLine } from "./describe";
import { getEntry, listEntries, planUndo, undoEntry, type Entry, type HistoryFilter, type UndoPlan } from "./store";
import { afterUndo } from "./refresh";
import { byLineText } from "./words";

const FILTERS: [HistoryFilter, string][] = [
  ["all", "All"],
  ["you", "You"],
  ["coach", "Coach"],
  ["plugins", "Plugins"],
  ["sync", "Lactic"],
];

const PAGE = 30;

export function AppHistory() {
  const { hash } = useLocation();
  const [filter, setFilter] = useState<HistoryFilter>(hash === "#app-history-plugins" ? "plugins" : "all");
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [more, setMore] = useState(false);
  const [open, setOpen] = useState<string | null>(null);

  const load = useCallback(async () => {
    const list = await listEntries({ filter, limit: PAGE });
    setEntries(list);
    setMore(list.length === PAGE);
  }, [filter]);

  useEffect(() => {
    void load();
    window.addEventListener(HISTORY_EVENT, load);
    return () => window.removeEventListener(HISTORY_EVENT, load);
  }, [load]);

  async function older() {
    if (!entries?.length) return;
    const list = await listEntries({ filter, limit: PAGE, before: entries[entries.length - 1].at });
    setEntries([...entries, ...list]);
    setMore(list.length === PAGE);
  }

  return (
    <div id="app-history-plugins" className="space-y-4 sm:col-span-2">
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Show changes by">
        {FILTERS.map(([id, label]) => (
          <button
            key={id}
            type="button"
            aria-pressed={filter === id}
            onClick={() => setFilter(id)}
            className={`h-8 rounded-full border px-3 text-sm transition-colors ${filter === id ? "border-primary bg-primary text-on-primary" : "border-line text-muted hover:text-ink"}`}
          >
            {label}
          </button>
        ))}
      </div>
      {entries === null ? null : entries.length === 0 ? (
        <p className="text-sm text-muted">{filter === "all" ? "No changes yet. Changes to your plan, settings, workouts and plugins show up here." : "None yet."}</p>
      ) : (
        <div className="space-y-4">
          {byDay(entries).map(([label, list]) => (
            <div key={label} className="space-y-1.5">
              <p className="text-xs font-semibold tracking-wide text-faint uppercase">{label}</p>
              <ul className="divide-y divide-line rounded-lg border border-line">
                {list.map((e) => (
                  <EntryRow key={e.id} entry={e} onOpen={() => setOpen(e.id)} />
                ))}
              </ul>
            </div>
          ))}
          {more && (
            <button type="button" className={button.ghost} onClick={() => void older()}>
              Show older
            </button>
          )}
        </div>
      )}
      {open && <ChangeDialog id={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

function byDay(entries: Entry[]): [string, Entry[]][] {
  const out: [string, Entry[]][] = [];
  for (const e of entries) {
    const label = dayLabel(e.at);
    const last = out[out.length - 1];
    if (last && last[0] === label) last[1].push(e);
    else out.push([label, [e]]);
  }
  return out;
}

function dayLabel(at: string): string {
  const d = new Date(at);
  const today = new Date();
  const yesterday = new Date(today.getTime() - 86_400_000);
  if (d.toDateString() === today.toDateString()) return "Today";
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
  return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", ...(d.getFullYear() !== today.getFullYear() ? { year: "numeric" } : {}) });
}

const time = (at: string) => new Date(at).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

const byLine = byLineText;

function Avatar({ entry }: { entry: Entry }) {
  const coach = entry.author === "coach" || entry.author === "ai_app";
  const tone = entry.pluginId ? "bg-plugin-soft text-plugin" : coach ? "bg-accent-soft text-accent" : "bg-raised text-muted";
  const letter = entry.pluginId ? "P" : byLine(entry).charAt(0).toUpperCase();
  return (
    <span aria-hidden className={`grid size-7 shrink-0 place-items-center rounded-full text-xs font-semibold ${tone}`}>
      {letter}
    </span>
  );
}

function EntryRow({ entry, onOpen }: { entry: Entry; onOpen: () => void }) {
  return (
    <li>
      <button type="button" onClick={onOpen} className="flex w-full items-start gap-3 px-3 py-2.5 text-left transition-colors hover:bg-raised">
        <Avatar entry={entry} />
        <span className={`min-w-0 flex-1 ${entry.undoneAt ? "opacity-55" : ""}`}>
          <span className="block text-sm font-medium">
            {entry.title}
            {entry.undoneAt && <span className="ml-2 rounded border border-line px-1.5 py-px text-xs font-normal text-faint">Undone</span>}
          </span>
          <span className="block text-sm text-muted">{byLine(entry)}</span>
        </span>
        <span className="shrink-0 text-right text-xs text-faint">
          {time(entry.at)}
          <span className="mt-0.5 block text-sm text-accent">See changes</span>
        </span>
      </button>
    </li>
  );
}

function Lines({ lines }: { lines: ChangeLine[] }) {
  const sections = [...new Set(lines.map((l) => l.section))];
  return (
    <div className="space-y-3">
      {sections.map((s) => (
        <div key={s}>
          <p className="mb-1 text-xs font-semibold tracking-wide text-faint uppercase">{s}</p>
          <ul className="divide-y divide-line border-y border-line">
            {lines
              .filter((l) => l.section === s)
              .map((l, i) => (
                <li key={i} className="grid grid-cols-[minmax(6rem,auto)_1fr] gap-3 py-2 text-sm">
                  <span className="text-muted">{l.label}</span>
                  <span>
                    {l.was === null ? (
                      <span className="text-positive">Added</span>
                    ) : (
                      <span className="text-faint line-through decoration-1">{l.was}</span>
                    )}
                    <span className="mx-1.5 text-faint">→</span>
                    {l.now === null ? <span className="text-negative">Removed</span> : <span className="font-medium">{l.now}</span>}
                  </span>
                </li>
              ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

function ChangeDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const panel = useRef<HTMLDivElement>(null);
  const [entry, setEntry] = useState<Entry | null>(null);
  const [plan, setPlan] = useState<UndoPlan | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    void (async () => {
      setEntry(await getEntry(id));
      setPlan(await planUndo(id));
    })();
  }, [id]);

  useEffect(() => {
    panel.current?.focus();
    const close = (e: KeyboardEvent) => e.key === "Escape" && !busy && onClose();
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [busy, onClose]);

  async function undo() {
    setBusy(true);
    setResult(null);
    try {
      const done = await undoEntry(id);
      await afterUndo(plan?.steps.map((s) => s.change.table) ?? []);
      setEntry(await getEntry(id));
      setResult({ ok: true, text: done.kept.length ? `Undone. ${keptText(done.kept)} stayed as ${done.kept.length === 1 ? "it is" : "they are"} now.` : "Undone." });
    } catch (e) {
      setResult({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  }

  // Everything it touched: what Undo puts back, then what changed again since.
  const lines = plan ? [...plan.lines, ...plan.kept] : [];
  const canUndo = Boolean(entry && !entry.undoneAt && plan?.steps.length);

  return (
    <div className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-black/50 px-2 pt-[calc(1rem+env(safe-area-inset-top))] pb-[calc(1rem+env(safe-area-inset-bottom))] sm:px-6 sm:pt-16 sm:pb-16" onClick={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div ref={panel} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="change-title" className="relative w-full max-w-lg space-y-4 rounded-xl border border-line bg-ground p-5 text-sm shadow-2xl outline-none sm:p-6">
        {entry && (
          <div>
            <h2 id="change-title" className="text-lg font-semibold">
              {entry.title}
            </h2>
            <p className="text-muted">
              {byLine(entry)} · {dayLabel(entry.at)}, {time(entry.at)}
            </p>
          </div>
        )}
        {plan && <Lines lines={lines} />}
        {entry && !entry.undoneAt && plan && plan.kept.length > 0 && (
          <p className="rounded-md bg-raised px-3 py-2.5 text-muted">
            {plan.steps.length ? `${keptText(plan.kept)} changed again since. Undo leaves ${plan.kept.length === 1 ? "it" : "them"} as ${plan.kept.length === 1 ? "it is" : "they are"} now.` : "Everything it changed has changed again since."}
          </p>
        )}
        {result && <Result ok={result.ok}>{result.text}</Result>}
        <div className="flex justify-end gap-2">
          <button type="button" className={button.secondary} disabled={busy} onClick={onClose}>
            Close
          </button>
          {entry && !entry.undoneAt && (
            <button type="button" className={button.primary} disabled={!canUndo || busy} onClick={() => void undo()}>
              {busy ? "Undoing…" : "Undo this change"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function keptText(kept: ChangeLine[]): string {
  const names = [...new Set(kept.map((l) => l.label))];
  return names.length <= 2 ? names.join(" and ") : `${names.length} things`;
}
