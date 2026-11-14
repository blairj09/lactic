// The Plugins tab's Cards view (Lactic Modular): plugin cards on screens the rider names and switches
// between, like ride pages. Customize uses the same moves as Today's editor. Plugin cards never go on Today.
import { useCallback, useEffect, useMemo, useState } from "react";
import { button, input } from "@/components/ui";
import { cardRows, type Layout } from "@/lib/sdk/layout";
import { addCard, addScreen, deleteScreen, moveCard, moveScreen, placeNewCards, removeCard, renameScreen, resizeCard } from "@/lib/sdk/plugin-screens";
import { saveLayout } from "@/lib/layout-data";
import { rowColumns } from "@/lib/sdk/layout-editor";
import { createClient } from "~/db/supabase-client";
import { KitView, PluginFrame } from "./kit-view";
import { dayMetrics, drawCard, pluginCards, type CardInfo, type CardResult } from "./cards";
import { createPluginWorker } from "./spawn";
import { listPlugins } from "./store";

const COLS: Record<number, string> = { 1: "grid-cols-1", 2: "grid-cols-1 sm:grid-cols-2", 3: "grid-cols-2 sm:grid-cols-3" };

async function save(layout: Layout) {
  await saveLayout(createClient() as never, layout);
}

function Chips({ names, current, onPick, extra }: { names: string[]; current: number; onPick: (i: number) => void; extra?: React.ReactNode }) {
  return (
    <nav aria-label="Plugin screens" className="flex flex-wrap items-center gap-1">
      {names.map((n, i) => (
        <button
          key={`${i}:${n}`}
          type="button"
          aria-current={i === current ? "page" : undefined}
          onClick={() => onPick(i)}
          className="rounded-md px-3 py-1.5 text-sm text-muted transition-colors hover:text-ink aria-[current=page]:bg-active aria-[current=page]:text-ink"
        >
          {n}
        </button>
      ))}
      {extra}
    </nav>
  );
}

function Card({ info, day, onRemove }: { info: CardInfo | undefined; day: Awaited<ReturnType<typeof dayMetrics>> | null; onRemove: () => void }) {
  const [result, setResult] = useState<CardResult | null>(null);
  useEffect(() => {
    setResult(null);
    if (!info?.on || !day) return;
    let live = true;
    drawCard(info, day, createPluginWorker)
      .then((r) => live && setResult(r))
      .catch(() => live && setResult({ failed: "hit an error" }));
    return () => {
      live = false;
    };
  }, [info, day]);

  if (!info)
    return (
      <PluginFrame name="Plugin" label="removed" dashed>
        <div className="flex flex-wrap items-center gap-3 text-sm text-muted">
          This plugin was removed.
          <button type="button" className={button.small} onClick={onRemove}>
            Remove card
          </button>
        </div>
      </PluginFrame>
    );
  if (!info.on)
    return (
      <PluginFrame name={info.pluginName} label="off" dashed>
        <div className="flex flex-wrap items-center gap-3 text-sm text-muted">
          Off on this computer. Switch it on in Added.
        </div>
      </PluginFrame>
    );
  return (
    <PluginFrame name={info.pluginName} label={info.title}>
      {!result ? (
        <p className="text-sm text-faint">…</p>
      ) : "tree" in result ? (
        <KitView node={result.tree} />
      ) : (
        <p className="text-sm text-muted">
          {info.pluginName} {result.failed}.
        </p>
      )}
    </PluginFrame>
  );
}

function Editor({ layout, cards, start, onDone, onCancel }: { layout: Layout; cards: CardInfo[]; start: number; onDone: (l: Layout) => void; onCancel: () => void }) {
  const [history, setHistory] = useState<Layout[]>([layout]);
  const [at, setAt] = useState(Math.min(start, layout.plugins.screens.length - 1));
  const draft = history[history.length - 1];
  const screens = draft.plugins.screens;
  const s = screens[Math.min(at, screens.length - 1)];
  const i = screens.indexOf(s);
  const byId = new Map(cards.map((c) => [c.id, c]));
  const push = (next: Layout) => next !== draft && setHistory((h) => [...h, next]);
  const addable = cards.filter((c) => c.on && !s.cards.some((x) => x.widget === c.id));
  const [name, setName] = useState(s.name);
  useEffect(() => setName(s.name), [s.name, i]);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2 border-b border-line pb-3">
        <h2 className="mr-auto text-base font-semibold">Customize screens</h2>
        <button type="button" className={button.small} disabled={history.length < 2} onClick={() => setHistory((h) => h.slice(0, -1))}>
          Undo
        </button>
        <button type="button" className={button.small} onClick={onCancel}>
          Cancel
        </button>
        <button type="button" className={button.smallPrimary} onClick={() => onDone(draft)}>
          Done
        </button>
      </div>
      <div className="flex flex-col gap-6 lg:flex-row">
        <div className="min-w-0 flex-1 space-y-4">
          <Chips
            names={screens.map((x) => x.name)}
            current={i}
            onPick={setAt}
            extra={
              screens.length < 8 && (
                <button
                  type="button"
                  className="rounded-md px-3 py-1.5 text-sm text-plugin hover:underline"
                  onClick={() => {
                    push(addScreen(draft));
                    setAt(screens.length);
                  }}
                >
                  + New screen
                </button>
              )
            }
          />
          <div className="flex flex-wrap items-center gap-2">
            <input
              className={`${input} w-48`}
              aria-label="Screen name"
              value={name}
              maxLength={24}
              onChange={(e) => setName(e.target.value)}
              onBlur={() => push(renameScreen(draft, i, name))}
              onKeyDown={(e) => e.key === "Enter" && push(renameScreen(draft, i, name))}
            />
            <button type="button" className={button.ghost} disabled={i === 0} onClick={() => (push(moveScreen(draft, i, -1)), setAt(i - 1))}>
              ← Move
            </button>
            <button type="button" className={button.ghost} disabled={i === screens.length - 1} onClick={() => (push(moveScreen(draft, i, 1)), setAt(i + 1))}>
              Move →
            </button>
            {screens.length > 1 && (
              <button type="button" className={`${button.ghost} ml-auto text-negative`} onClick={() => (push(deleteScreen(draft, i)), setAt(Math.max(0, i - 1)))}>
                Delete screen
              </button>
            )}
          </div>
          {s.cards.length === 0 ? (
            <p className="text-sm text-muted">No cards on this screen.</p>
          ) : (
            <ul className="space-y-2">
              {s.cards.map((c, k) => {
                const info = byId.get(c.widget);
                return (
                  <li key={c.widget} className="flex flex-wrap items-center gap-2 rounded-lg border border-plugin-line bg-surface px-3 py-2 text-sm">
                    <span className="min-w-0 flex-1 truncate">
                      <span className="font-semibold text-plugin">{info?.pluginName ?? "Removed plugin"}</span>
                      {info && <span> · {info.title}</span>}
                    </span>
                    <span className="inline-flex overflow-hidden rounded-md border border-line" role="group" aria-label="Size">
                      {(["small", "medium", "large"] as const).map((z) => (
                        <button key={z} type="button" aria-pressed={c.size === z} onClick={() => push(resizeCard(draft, i, c.widget, z))} className="px-2 py-0.5 text-xs text-muted aria-[pressed=true]:bg-active aria-[pressed=true]:text-ink">
                          {z[0].toUpperCase()}
                        </button>
                      ))}
                    </span>
                    <button type="button" className={button.small} aria-label="Move up" disabled={k === 0} onClick={() => push(moveCard(draft, i, c.widget, -1))}>
                      ↑
                    </button>
                    <button type="button" className={button.small} aria-label="Move down" disabled={k === s.cards.length - 1} onClick={() => push(moveCard(draft, i, c.widget, 1))}>
                      ↓
                    </button>
                    <button type="button" className={button.small} onClick={() => push(removeCard(draft, i, c.widget))}>
                      Remove
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        <aside className="w-full space-y-2 self-start rounded-lg border border-line bg-surface p-4 text-sm lg:w-72">
          <h3 className="font-semibold">Add a card</h3>
          {addable.length === 0 ? (
            <p className="text-muted">Every card is on this screen.</p>
          ) : (
            <ul className="divide-y divide-line">
              {addable.map((c) => (
                <li key={c.id} className="flex items-center justify-between gap-2 py-2">
                  <span className="min-w-0 truncate">
                    <span className="font-semibold text-plugin">{c.pluginName}</span> · {c.title}
                  </span>
                  <button type="button" className={button.small} onClick={() => push(addCard(draft, i, c.id))}>
                    Add
                  </button>
                </li>
              ))}
            </ul>
          )}
          <p className="text-xs text-faint">A card can go on more than one screen.</p>
        </aside>
      </div>
    </div>
  );
}

export function CardsView({ initial, onBrowse }: { initial: Layout; onBrowse: () => void }) {
  const [layout, setLayout] = useState(initial);
  const [cards, setCards] = useState<CardInfo[] | null>(null);
  const [at, setAt] = useState(0);
  const [editing, setEditing] = useState(false);
  const [day, setDay] = useState<Awaited<ReturnType<typeof dayMetrics>> | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const list = pluginCards(await listPlugins());
    setCards(list);
    setLayout((l) => {
      const placed = placeNewCards(l, list.filter((c) => c.on));
      if (placed !== l) void save(placed).catch(() => undefined);
      return placed;
    });
  }, []);

  useEffect(() => {
    void load();
    void dayMetrics()
      .then(setDay)
      .catch(() => setDay({ day: new Date().toLocaleDateString("en-CA"), metrics: {} }));
    const refresh = () => void load();
    window.addEventListener("lactic:plugins", refresh);
    return () => window.removeEventListener("lactic:plugins", refresh);
  }, [load]);

  const screens = layout.plugins.screens;
  const current = screens[Math.min(at, screens.length - 1)];

  useEffect(() => {
    if (editing || screens.length < 2) return;
    const key = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName))) return;
      if (e.key === "ArrowRight") setAt((i) => Math.min(i + 1, screens.length - 1));
      if (e.key === "ArrowLeft") setAt((i) => Math.max(i - 1, 0));
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [editing, screens.length]);

  const byId = useMemo(() => new Map((cards ?? []).map((c) => [c.id, c])), [cards]);
  const rows = cardRows(current.cards, () => true);

  async function commit(next: Layout) {
    setError(null);
    try {
      await save(next);
      setLayout(next);
    } catch (e) {
      setError(`Couldn't save: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  if (editing && cards) return <Editor layout={layout} cards={cards} start={at} onCancel={() => setEditing(false)} onDone={(l) => void commit(l).then(() => setEditing(false))} />;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        {screens.length > 1 && <Chips names={screens.map((s) => s.name)} current={screens.indexOf(current)} onPick={setAt} />}
        <button type="button" className={`${button.ghost} ml-auto`} onClick={() => setEditing(true)} disabled={!cards}>
          Customize
        </button>
      </div>
      {error && <p className="text-sm text-negative">{error}</p>}
      {cards && current.cards.length === 0 ? (
        cards.some((c) => c.on) ? (
          <p className="text-sm text-muted">No cards on this screen. Add some with Customize.</p>
        ) : (
          <p className="text-sm text-muted">
            No plugin cards yet.{" "}
            <button type="button" className="underline" onClick={onBrowse}>
              Browse plugins with cards
            </button>
          </p>
        )
      ) : (
        <div className="space-y-4">
          {rows.map((row, r) => (
            <div key={r} className={`grid gap-4 ${COLS[rowColumns(row)] ?? COLS[1]}`}>
              {row.widgets.map((w) => (
                <Card key={w} info={cards ? byId.get(w) : undefined} day={day} onRemove={() => void commit(removeCard(layout, screens.indexOf(current), w))} />
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
