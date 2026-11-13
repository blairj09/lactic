// Settings → Layout: the tabs' order and which show (review U2: reorder and hide only), the way
// into Customize Today, copies of earlier layouts kept by Reset and Restore, and Reset itself.
// Tab changes save as they're made; each can be put back the same way.

import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import Link from "next/link";
import { button } from "@/components/ui";
import { FIXED_TABS, type Layout, type TabId } from "@/lib/sdk/layout";
import { hiddenCards, moveTab, setTabHidden, shownCards } from "@/lib/sdk/layout-editor";
import { TAB_NAMES } from "@/lib/sdk/layout-edit";
import { pluginsAllowed } from "~/plugins/use-plugin-tab";
import type { SavedLayout } from "@/lib/layout-data";
import { deleteSavedLayoutAction, resetLayoutAction, restoreLayoutAction, saveLayoutAction } from "@/app/layout-actions";

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

export function LayoutSetting({ layout: saved, copies, custom }: { layout: Layout; copies: SavedLayout[]; custom: boolean }) {
  const [layout, setLayout] = useState(saved);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [drag, setDrag] = useState<{ id: TabId; index: number } | null>(null);
  const [focus, setFocus] = useState<TabId | null>(null);
  const [said, setSaid] = useState("");
  const rows = useRef(new Map<TabId, HTMLElement>());
  useEffect(() => setLayout(saved), [saved]);

  const save = async (next: Layout, announce: string) => {
    if (next === layout) return;
    const before = layout;
    setLayout(next);
    setSaid(announce);
    setError(null);
    try {
      await saveLayoutAction(next);
    } catch (e) {
      setLayout(before);
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  const nudge = (id: TabId, by: -1 | 1) => {
    const at = layout.tabs.findIndex((t) => t.id === id);
    void save(moveTab(layout, id, at + by), `${TAB_NAMES[id]} moved to ${at + by + 1} of ${layout.tabs.length}`);
    setFocus(id);
  };
  useEffect(() => {
    if (!focus) return;
    rows.current.get(focus)?.querySelector<HTMLElement>("[data-grip]")?.focus();
    setFocus(null);
  }, [focus, layout]);

  // Dragging a tab by its grip: it lands above the first other row whose middle is below the pointer.
  const dragRef = useRef(drag);
  dragRef.current = drag;
  const layoutRef = useRef(layout);
  layoutRef.current = layout;
  const saveRef = useRef(save);
  saveRef.current = save;
  const dragging = drag !== null;
  useEffect(() => {
    if (!dragging) return;
    const move = (e: PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      const others = moveTab(layoutRef.current, d.id, d.index).tabs.filter((t) => t.id !== d.id);
      const i = others.findIndex((t) => {
        const r = rows.current.get(t.id)?.getBoundingClientRect();
        return r ? e.clientY < r.top + r.height / 2 : false;
      });
      setDrag({ ...d, index: i < 0 ? others.length : i });
    };
    const up = () => {
      const d = dragRef.current;
      setDrag(null);
      if (d) void saveRef.current(moveTab(layoutRef.current, d.id, d.index), `${TAB_NAMES[d.id]} moved to ${d.index + 1}`);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
  }, [dragging]);

  const tabs = (drag ? moveTab(layout, drag.id, drag.index).tabs : layout.tabs).filter((t) => t.id !== "plugins" || pluginsAllowed);
  const onDown = (id: TabId) => (e: ReactPointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    setDrag({ id, index: layout.tabs.findIndex((t) => t.id === id) });
  };
  const onKey = (id: TabId) => (e: ReactKeyboardEvent) => {
    if (!e.altKey || (e.key !== "ArrowUp" && e.key !== "ArrowDown")) return;
    e.preventDefault();
    nudge(id, e.key === "ArrowUp" ? -1 : 1);
  };

  const act = async (work: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await work();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      setConfirmReset(false);
    }
  };

  const cards = shownCards(saved).length;
  const offCards = hiddenCards(saved).length;
  return (
    <div className="space-y-7 sm:col-span-2">
      <div>
        <h3 className="text-sm font-medium">Tabs</h3>
        <p className="mt-0.5 text-sm text-muted">Drag to change the order, or use Move up and Move down. Today and Ride always show.</p>
        <ol className="mt-3 divide-y divide-rule rounded-lg border border-line bg-surface px-3" aria-label="Tabs">
          {tabs.map((t, i) => {
            const fixed = FIXED_TABS.includes(t.id);
            const moving = drag?.id === t.id;
            return (
              <li
                key={t.id}
                ref={(el) => {
                  if (el) rows.current.set(t.id, el);
                  else rows.current.delete(t.id);
                }}
                className={cx("flex items-center gap-3 py-2", moving && "rounded-md bg-accent-soft")}
              >
                <button
                  type="button"
                  data-grip
                  aria-label={`Move ${TAB_NAMES[t.id]}. Option and the arrow keys move it up or down.`}
                  onPointerDown={onDown(t.id)}
                  onKeyDown={onKey(t.id)}
                  className="flex h-8 w-6 cursor-grab touch-none items-center justify-center text-faint hover:text-ink active:cursor-grabbing"
                >
                  <svg width="10" height="16" viewBox="0 0 10 16" fill="currentColor" aria-hidden>
                    {[2, 8, 14].flatMap((y) => [<circle key={`a${y}`} cx="2.5" cy={y} r="1.4" />, <circle key={`b${y}`} cx="7.5" cy={y} r="1.4" />])}
                  </svg>
                </button>
                <span className={cx("flex-1 text-sm", t.hidden && "text-faint")}>{TAB_NAMES[t.id]}</span>
                <span className="hidden gap-1 sm:flex">
                  <button type="button" className="h-7 rounded px-2 text-xs text-muted hover:bg-raised hover:text-ink disabled:opacity-30" disabled={i === 0 || busy} onClick={() => nudge(t.id, -1)} aria-label={`Move ${TAB_NAMES[t.id]} up`}>
                    ↑
                  </button>
                  <button type="button" className="h-7 rounded px-2 text-xs text-muted hover:bg-raised hover:text-ink disabled:opacity-30" disabled={i === tabs.length - 1 || busy} onClick={() => nudge(t.id, 1)} aria-label={`Move ${TAB_NAMES[t.id]} down`}>
                    ↓
                  </button>
                </span>
                {fixed ? (
                  <span className="w-[132px] text-right text-xs text-faint">Always shown</span>
                ) : (
                  <div role="radiogroup" aria-label={`${TAB_NAMES[t.id]} tab`} className="inline-flex w-[132px] rounded-md bg-raised p-0.5">
                    {[false, true].map((h) => (
                      <button
                        key={String(h)}
                        type="button"
                        role="radio"
                        aria-checked={t.hidden === h}
                        onClick={() => save(setTabHidden(layout, t.id, h), `${TAB_NAMES[t.id]} ${h ? "hidden" : "shown"}`)}
                        className="h-7 flex-1 rounded text-xs text-muted hover:text-ink aria-checked:bg-surface aria-checked:font-medium aria-checked:text-ink aria-checked:shadow-[0_0_0_1px_var(--line)]"
                      >
                        {h ? "Hidden" : "Shown"}
                      </button>
                    ))}
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      </div>

      <div>
        <h3 className="text-sm font-medium">Today</h3>
        <p className="mt-0.5 text-sm text-muted">
          {cards} card{cards === 1 ? "" : "s"}
          {offCards ? `, ${offCards} taken off` : ""}. Move, size and remove them on Today itself.
        </p>
        <Link href="/?customize=1" className={cx(button.small, "mt-3")}>
          Customize Today
        </Link>
      </div>

      {copies.length > 0 && (
        <div>
          <h3 className="text-sm font-medium">Saved layouts</h3>
          <p className="mt-0.5 text-sm text-muted">Kept when you reset or restore, so nothing is lost.</p>
          <ul className="mt-3 divide-y divide-rule rounded-lg border border-line bg-surface px-3">
            {copies.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5">
                <div className="min-w-0 flex-1 text-sm">
                  {c.name}
                  <span className="text-faint"> · {c.changes.slice(0, 3).join(", ")}{c.changes.length > 3 ? "…" : ""}</span>
                </div>
                <button type="button" className={button.small} disabled={busy} onClick={() => act(() => restoreLayoutAction(c.id))}>
                  Restore
                </button>
                <button type="button" className={button.ghost} disabled={busy} onClick={() => act(() => deleteSavedLayoutAction(c.id))}>
                  Delete
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div>
        <h3 className="text-sm font-medium">Start over</h3>
        <p className="mt-0.5 text-sm text-muted">Lactic&apos;s default tabs and Today. Your layout is kept as a copy above first.</p>
        {confirmReset ? (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="text-sm">Reset tabs and Today?</span>
            <button type="button" className={button.smallPrimary} disabled={busy} onClick={() => act(resetLayoutAction)}>
              Reset
            </button>
            <button type="button" className={button.small} disabled={busy} onClick={() => setConfirmReset(false)}>
              Cancel
            </button>
          </div>
        ) : (
          <button type="button" className={cx(button.small, "mt-3")} disabled={busy || !custom} onClick={() => setConfirmReset(true)}>
            Reset to Lactic&apos;s default…
          </button>
        )}
      </div>

      {error && <p className="text-sm text-negative">Couldn&apos;t save: {error}</p>}
      <p aria-live="polite" className="sr-only">
        {said}
      </p>
    </div>
  );
}
