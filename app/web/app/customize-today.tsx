"use client";

// Customize Today (review U1, U5, U9): Today's cards shrink to short tiles that can be dragged,
// sized and removed in place, with an "Add a card" panel for the ones taken off. Undo, Cancel and
// Done sit in a bar along the top; Reset puts Lactic's default back and keeps the rider's layout as
// a copy. Every move also works from the keyboard: the ⋯ menu, and ⌥↑ / ⌥↓ on a card's grip.
//
// On the iPhone (reached by holding a card, hold-to-customize.tsx) it's laid out for touch: a "–"
// hides a card, the size chip steps through its sizes, tapping a card opens its menu (Move up and
// down for VoiceOver), Undo and Reset sit under ⋯ in the bar, and Add a card is a sheet.

import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import { useRouter } from "next/navigation";
import { button } from "@/components/ui";
import { cardRows, type Layout } from "@/lib/sdk/layout";
import { addCard, hiddenCards, moveCard, nudgeCard, removeCard, rowColumns, sameLayout, shownCards, sizeCard } from "@/lib/sdk/layout-editor";
import { SIZE_LABELS, todayCard } from "@/lib/sdk/builtin-widgets";
import type { CardSize } from "@/lib/sdk/widgets";
import { isPhone } from "~/platform/native";
import { resetLayoutAction, saveLayoutAction } from "./layout-actions";

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");
const SIZES: CardSize[] = ["small", "medium", "large"];
const SHORT: Record<CardSize, string> = { small: "S", medium: "M", large: "L" };

interface Drag {
  widget: string;
  /** Where it would land among the shown cards. */
  index: number;
  x: number;
  y: number;
}

export default function CustomizeToday({ layout: initial, phone = isPhone() }: { layout: Layout; phone?: boolean }) {
  const router = useRouter();
  const [barMenu, setBarMenu] = useState(false);
  const [adding, setAdding] = useState(false);
  const [history, setHistory] = useState<Layout[]>([initial]);
  const layout = history[history.length - 1];
  const [drag, setDrag] = useState<Drag | null>(null);
  const [menu, setMenu] = useState<string | null>(null);
  const [removed, setRemoved] = useState<string | null>(null);
  const [focus, setFocus] = useState<string | null>(null);
  const [said, setSaid] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const tiles = useRef(new Map<string, HTMLElement>());

  const change = (next: Layout, announce?: string) => {
    if (next === layout) return;
    setHistory((h) => [...h, next]);
    if (announce) setSaid(announce);
  };
  const undo = () => {
    setHistory((h) => (h.length > 1 ? h.slice(0, -1) : h));
    setRemoved(null);
    setSaid("Undone");
  };

  // ⌘Z / Ctrl+Z undoes until Done; Escape closes an open menu.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === "z" && !(e.target instanceof HTMLInputElement)) {
        e.preventDefault();
        undo();
      }
      if (e.key === "Escape") {
        setMenu(null);
        setBarMenu(false);
        setAdding(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // The Undo note after a removal goes after a few seconds (Undo in the bar still works).
  useEffect(() => {
    if (!removed) return;
    const t = setTimeout(() => setRemoved(null), 6000);
    return () => clearTimeout(t);
  }, [removed]);

  // A card moved with the keyboard keeps focus on its grip, though it may now sit in another row.
  useEffect(() => {
    if (!focus) return;
    tiles.current.get(focus)?.querySelector<HTMLElement>("[data-grip]")?.focus();
    setFocus(null);
  }, [focus, layout]);

  const preview = drag ? moveCard(layout, drag.widget, drag.index) : layout;
  const shown = shownCards(preview);
  const rows = cardRows(shown, () => true);
  const hidden = hiddenCards(layout);
  const position = (w: string) => shownCards(layout).findIndex((c) => c.widget === w);

  const nudge = (widget: string, by: -1 | 1) => {
    const next = nudgeCard(layout, widget, by);
    if (next === layout) return;
    change(next, `${todayCard(widget).name} moved to ${shownCards(next).findIndex((c) => c.widget === widget) + 1} of ${shownCards(next).length}`);
    setFocus(widget);
  };
  const toTop = (widget: string) => {
    change(moveCard(layout, widget, 0), `${todayCard(widget).name} moved to the top`);
    setFocus(widget);
  };
  const remove = (widget: string) => {
    change(removeCard(layout, widget), `${todayCard(widget).name} removed`);
    setRemoved(widget);
  };
  const resize = (widget: string, size: CardSize) => change(sizeCard(layout, widget, size), `${todayCard(widget).name} ${SIZE_LABELS[size].toLowerCase()}`);

  // Dragging by the grip, with pointer events (HTML drag and drop is unreliable in the app's web view).
  // The card lands before the first other card the pointer is above, or left of in the same row.
  const landing = (widget: string, x: number, y: number) => {
    const others = shownCards(drag ? moveCard(layout, widget, drag.index) : layout).filter((c) => c.widget !== widget);
    for (let i = 0; i < others.length; i++) {
      const r = tiles.current.get(others[i].widget)?.getBoundingClientRect();
      if (!r) continue;
      if (y < r.top || (y <= r.bottom && x < r.left + r.width / 2)) return i;
    }
    return others.length;
  };
  const onDown = (widget: string) => (e: ReactPointerEvent<HTMLElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    setMenu(null);
    setDrag({ widget, index: position(widget), x: e.clientX, y: e.clientY });
  };
  // The grip turns into the drop placeholder once a drag starts, so the drag follows the window.
  const dragRef = useRef<Drag | null>(null);
  dragRef.current = drag;
  const landingRef = useRef(landing);
  landingRef.current = landing;
  const dropRef = useRef<() => void>(() => {});
  dropRef.current = () => {
    const d = dragRef.current;
    if (!d) return;
    const next = moveCard(layout, d.widget, d.index);
    setDrag(null);
    change(next, `${todayCard(d.widget).name} moved to ${d.index + 1} of ${shownCards(next).length}`);
  };
  const dragging = drag !== null;
  useEffect(() => {
    if (!dragging) return;
    const move = (e: PointerEvent) => {
      const d = dragRef.current;
      if (d) setDrag({ ...d, x: e.clientX, y: e.clientY, index: landingRef.current(d.widget, e.clientX, e.clientY) });
    };
    const up = () => dropRef.current();
    const cancel = () => setDrag(null);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancel);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
    };
  }, [dragging]);
  const onGripKey = (widget: string) => (e: ReactKeyboardEvent) => {
    if (!e.altKey || (e.key !== "ArrowUp" && e.key !== "ArrowDown")) return;
    e.preventDefault();
    nudge(widget, e.key === "ArrowUp" ? -1 : 1);
  };

  const leave = () => router.replace("/");
  const done = async () => {
    if (sameLayout(layout, initial)) return leave();
    setBusy(true);
    setError(null);
    try {
      await saveLayoutAction(layout);
      leave();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };
  const reset = async () => {
    setBusy(true);
    try {
      await resetLayoutAction();
      leave();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
      setConfirmReset(false);
    }
  };

  const dragged = drag ? todayCard(drag.widget) : null;

  return (
    <div
      onClick={() => {
        setMenu(null);
        setBarMenu(false);
      }}
    >
      {phone ? (
        <div className="sticky top-12 z-20 -mx-4 mb-4 flex items-center gap-2 border-b border-line bg-surface px-4 py-2">
          <button type="button" className="h-9 text-sm text-accent" onClick={leave} disabled={busy}>
            Cancel
          </button>
          <span className="flex-1 text-center font-medium">Today</span>
          <div className="relative" onClick={(e) => e.stopPropagation()}>
            <button type="button" aria-label="More" aria-haspopup="menu" aria-expanded={barMenu} className="flex size-9 items-center justify-center text-lg text-accent" onClick={() => setBarMenu(!barMenu)}>
              ⋯
            </button>
            {barMenu && (
              <div role="menu" className="absolute top-full right-0 z-50 mt-1 w-44 rounded-lg border border-line bg-surface p-1 shadow-xl">
                <button
                  type="button"
                  role="menuitem"
                  className="w-full rounded-md px-3 py-2.5 text-left text-sm disabled:text-faint"
                  disabled={history.length < 2 || busy}
                  onClick={() => {
                    setBarMenu(false);
                    undo();
                  }}
                >
                  Undo
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className="w-full rounded-md px-3 py-2.5 text-left text-sm"
                  disabled={busy}
                  onClick={() => {
                    setBarMenu(false);
                    setConfirmReset(true);
                  }}
                >
                  Reset…
                </button>
              </div>
            )}
          </div>
          <button type="button" className={button.smallPrimary} onClick={done} disabled={busy}>
            Done
          </button>
        </div>
      ) : (
        <div className="sticky top-12 z-20 -mx-4 mb-5 flex flex-wrap items-center gap-x-3 gap-y-2 border-y border-accent/25 bg-accent-soft px-4 py-2.5 sm:-mx-6 sm:px-6">
          <span className="font-medium">Customizing Today</span>
          <span className="hidden text-sm text-muted sm:inline">Drag cards, or use ⋯ to move them.</span>
          <div className="ml-auto flex items-center gap-1.5">
            <button type="button" className={button.ghost} onClick={undo} disabled={history.length < 2 || busy}>
              ↶ Undo
            </button>
            <button type="button" className={cx(button.ghost, "ml-2")} onClick={() => setConfirmReset(true)} disabled={busy}>
              Reset…
            </button>
            <button type="button" className={cx(button.small, "ml-2")} onClick={leave} disabled={busy}>
              Cancel
            </button>
            <button type="button" className={button.smallPrimary} onClick={done} disabled={busy}>
              Done
            </button>
          </div>
        </div>
      )}
      {error && <p className="mb-4 text-sm text-negative">Couldn&apos;t save: {error}</p>}

      <div className="grid grid-cols-[minmax(0,1fr)] gap-5 lg:grid-cols-[minmax(0,1fr)_280px] lg:items-start">
        <div className="space-y-3" aria-label="Today's cards" role="list">
          {rows.map((row) => (
            <div
              key={row.widgets.join(" ")}
              className={cx(
                "grid grid-cols-1 gap-3",
                rowColumns(row) === 2 && (phone && row.size === "small" ? "grid-cols-2" : "sm:grid-cols-2"),
                rowColumns(row) === 3 && (phone ? "grid-cols-2" : "sm:grid-cols-2 lg:grid-cols-3"),
              )}
            >
              {row.widgets.map((w) => {
                const card = todayCard(w);
                const entry = shown.find((c) => c.widget === w)!;
                const at = position(w);
                const placeholder = drag?.widget === w;
                return (
                  <div
                    key={w}
                    role="listitem"
                    aria-label={card.name}
                    ref={(el) => {
                      if (el) tiles.current.set(w, el);
                      else tiles.current.delete(w);
                    }}
                    className={cx(
                      "relative flex min-h-[72px] min-w-0 items-center gap-3 rounded-lg border-[1.5px] px-3 py-2.5",
                      placeholder ? "border-dashed border-accent bg-accent/5" : "border-dashed border-control bg-surface",
                      menu === w && "border-solid border-accent",
                    )}
                  >
                    {placeholder ? (
                      <span className="w-full text-center text-sm text-accent">Drop {card.name} here</span>
                    ) : (
                      <>
                        {phone ? (
                          <>
                            {!card.required && (
                              <button
                                type="button"
                                aria-label={`Remove ${card.name}`}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  remove(w);
                                }}
                                className="absolute -top-2 -left-2 z-10 flex size-6 items-center justify-center rounded-full bg-muted text-base leading-none font-bold text-surface"
                              >
                                –
                              </button>
                            )}
                            <button
                              type="button"
                              aria-label={`${card.name}: move or resize`}
                              aria-haspopup="menu"
                              aria-expanded={menu === w}
                              className="min-w-0 flex-1 text-left"
                              onClick={(e) => {
                                e.stopPropagation();
                                setMenu(menu === w ? null : w);
                              }}
                            >
                              <div className="truncate font-medium">{card.name}</div>
                              {!(entry.size === "small" && row.widgets.length > 1) && <div className="truncate text-sm text-muted">{card.description}</div>}
                            </button>
                            {card.sizes.length > 1 && (
                              <button
                                type="button"
                                aria-label={`${card.name} size: ${SIZE_LABELS[entry.size]}. Tap for the next size.`}
                                className="flex h-7 min-w-7 shrink-0 items-center justify-center rounded-md bg-raised px-1.5 text-xs font-semibold text-muted"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  const fits = SIZES.filter((s) => card.sizes.includes(s));
                                  resize(w, fits[(fits.indexOf(entry.size) + 1) % fits.length]);
                                }}
                              >
                                {SHORT[entry.size]}
                              </button>
                            )}
                            <button
                              type="button"
                              data-grip
                              aria-label={`Move ${card.name}`}
                              className="flex h-10 w-7 shrink-0 touch-none items-center justify-center rounded text-faint"
                              onPointerDown={onDown(w)}
                            >
                              <Grip />
                            </button>
                          </>
                        ) : (
                          <>
                            <button
                              type="button"
                              data-grip
                              aria-label={`Move ${card.name}. Option and the arrow keys move it up or down.`}
                              className="flex h-9 w-6 shrink-0 cursor-grab touch-none items-center justify-center rounded text-faint hover:text-ink active:cursor-grabbing"
                              onPointerDown={onDown(w)}
                              onKeyDown={onGripKey(w)}
                            >
                              <Grip />
                            </button>
                            <div className="min-w-0 flex-1">
                              <div className="truncate font-medium">{card.name}</div>
                              <div className={cx("truncate text-sm text-muted", entry.size === "small" && row.widgets.length > 1 && "hidden xl:block")}>
                                {entry.size !== "large" && row.widgets.length === 1 ? `Full width until another ${SIZE_LABELS[entry.size]} card sits next to it` : card.description}
                              </div>
                            </div>
                            <div className="flex shrink-0 items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                              <div role="radiogroup" aria-label={`${card.name} size`} className="inline-flex rounded-md bg-raised p-0.5">
                                {SIZES.map((s) => {
                                  const ok = card.sizes.includes(s);
                                  return (
                                    <button
                                      key={s}
                                      type="button"
                                      role="radio"
                                      aria-checked={entry.size === s}
                                      aria-label={SIZE_LABELS[s]}
                                      title={ok ? SIZE_LABELS[s] : `${card.name} can't be ${SIZE_LABELS[s].toLowerCase()}`}
                                      disabled={!ok}
                                      onClick={() => resize(w, s)}
                                      className="h-6 w-6 rounded text-xs font-semibold text-muted hover:text-ink disabled:text-control disabled:hover:text-control aria-checked:bg-surface aria-checked:text-ink aria-checked:shadow-[0_0_0_1px_var(--line)]"
                                    >
                                      {SHORT[s]}
                                    </button>
                                  );
                                })}
                              </div>
                              <button
                                type="button"
                                aria-label={`More for ${card.name}`}
                                aria-haspopup="menu"
                                aria-expanded={menu === w}
                                onClick={() => setMenu(menu === w ? null : w)}
                                className={cx("flex size-7 items-center justify-center rounded-md border bg-surface text-muted hover:text-ink", menu === w ? "border-accent text-accent" : "border-line")}
                              >
                                ⋯
                              </button>
                            </div>
                          </>
                        )}
                        {menu === w && (
                          <CardMenu
                            name={card.name}
                            size={entry.size}
                            sizes={card.sizes}
                            first={at === 0}
                            last={at === shownCards(layout).length - 1}
                            removable={!card.required}
                            keys={!phone}
                            onPick={(pick) => {
                              setMenu(null);
                              if (pick === "up") nudge(w, -1);
                              else if (pick === "down") nudge(w, 1);
                              else if (pick === "top") toTop(w);
                              else if (pick === "remove") remove(w);
                              else resize(w, pick);
                            }}
                          />
                        )}
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
          {shown.length === 0 && <p className="rounded-lg border border-dashed border-control p-6 text-center text-sm text-muted">Today is empty. Add a card from the list.</p>}
        </div>

        {phone ? (
          <button
            type="button"
            className="w-full rounded-lg border-[1.5px] border-dashed border-control py-3 text-sm font-medium text-accent"
            onClick={(e) => {
              e.stopPropagation();
              setAdding(true);
            }}
          >
            + Add a card
          </button>
        ) : (
          <aside className="rounded-lg border border-line bg-surface p-4" aria-label="Add a card">
            <h2 className="font-medium">Add a card</h2>
            <p className="mt-0.5 text-sm text-muted">{hidden.length ? "Cards you took off Today wait here." : "Cards you take off Today wait here."}</p>
            <div className="mt-3 space-y-2">
              {hidden.map((c) => {
                const card = todayCard(c.widget);
                return (
                  <div key={c.widget} className="flex items-center gap-3 rounded-md border border-line px-3 py-2">
                    <div className="min-w-0 flex-1">
                      <div className="text-sm">{card.name}</div>
                      <div className="text-xs text-muted">{card.description}</div>
                    </div>
                    <button
                      type="button"
                      aria-label={`Add ${card.name}`}
                      onClick={() => {
                        change(addCard(layout, c.widget), `${card.name} added at the bottom`);
                        if (removed === c.widget) setRemoved(null);
                      }}
                      className="flex size-7 shrink-0 items-center justify-center rounded-md bg-raised font-medium hover:bg-active"
                    >
                      +
                    </button>
                  </div>
                );
              })}
            </div>
          </aside>
        )}
      </div>

      {dragged && drag && (
        <div className="pointer-events-none fixed z-50 -translate-x-6 -translate-y-1/2 rotate-[-0.6deg] rounded-lg border-2 border-accent bg-surface px-4 py-3 shadow-xl" style={{ left: drag.x, top: drag.y }}>
          <div className="font-medium">{dragged.name}</div>
          <div className="text-sm text-muted">{dragged.description}</div>
        </div>
      )}

      {removed && (
        <div role="status" className="fixed bottom-20 left-1/2 z-40 flex -translate-x-1/2 items-center gap-4 rounded-lg bg-primary py-2.5 pr-3 pl-4 text-sm text-on-primary shadow-xl md:bottom-6">
          {todayCard(removed).name} removed
          <button type="button" className="font-medium underline-offset-4 hover:underline" onClick={undo}>
            Undo
          </button>
        </div>
      )}

      <p aria-live="polite" className="sr-only">
        {said}
      </p>

      {phone && adding && (
        <div className="fixed inset-0 z-50 flex items-end bg-black/35" onClick={() => setAdding(false)}>
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="add-card-title"
            className="max-h-[70vh] w-full overflow-y-auto rounded-t-2xl bg-surface px-4 pt-2 pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mx-auto mb-3 h-1.5 w-9 rounded-full bg-control" />
            <h2 id="add-card-title" className="font-medium">
              Add a card
            </h2>
            {hidden.length === 0 && <p className="mt-1 text-sm text-muted">Cards you take off Today wait here.</p>}
            <div className="mt-3 space-y-2">
              {hidden.map((c) => {
                const card = todayCard(c.widget);
                return (
                  <div key={c.widget} className="flex items-center gap-3 rounded-md border border-line px-3 py-2">
                    <div className="min-w-0 flex-1">
                      <div className="text-sm">{card.name}</div>
                      <div className="text-xs text-muted">{card.description}</div>
                    </div>
                    <button
                      type="button"
                      aria-label={`Add ${card.name}`}
                      onClick={() => {
                        change(addCard(layout, c.widget), `${card.name} added at the bottom`);
                        setAdding(false);
                        if (removed === c.widget) setRemoved(null);
                      }}
                      className="flex size-7 shrink-0 items-center justify-center rounded-md bg-raised font-medium hover:bg-active"
                    >
                      +
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {confirmReset && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 p-4" role="dialog" aria-modal="true" aria-labelledby="reset-title">
          <div className="w-full max-w-md rounded-xl bg-surface p-6 shadow-2xl">
            <h2 id="reset-title" className="text-lg font-medium">
              Reset to Lactic&apos;s default?
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-muted">
              Today and the tabs go back to how Lactic ships. Your layout is kept as a copy in Settings → Layout, so you can restore it any time.
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" className={button.small} onClick={() => setConfirmReset(false)} disabled={busy}>
                Cancel
              </button>
              <button type="button" className={button.smallPrimary} onClick={reset} disabled={busy} autoFocus>
                Reset
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

type Pick = "up" | "down" | "top" | "remove" | CardSize;

function CardMenu({
  name,
  size,
  sizes,
  first,
  last,
  removable,
  keys = true,
  onPick,
}: {
  name: string;
  size: CardSize;
  sizes: CardSize[];
  first: boolean;
  last: boolean;
  removable: boolean;
  /** Show the ⌥↑ / ⌥↓ shortcuts (not on a phone). */
  keys?: boolean;
  onPick: (p: Pick) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => ref.current?.querySelector<HTMLElement>("button:not(:disabled)")?.focus(), []);
  const items = useMemo(
    () =>
      [
        { pick: "up" as Pick, label: "Move up", key: keys ? "⌥↑" : undefined, off: first },
        { pick: "down" as Pick, label: "Move down", key: keys ? "⌥↓" : undefined, off: last },
        { pick: "top" as Pick, label: "Move to top", off: first },
        null,
        ...SIZES.filter((s) => sizes.includes(s)).map((s) => ({ pick: s as Pick, label: `${SIZE_LABELS[s]}${s === size ? " ✓" : ""}`, off: s === size })),
        ...(removable ? [null, { pick: "remove" as Pick, label: "Remove from Today", danger: true }] : []),
      ] as ({ pick: Pick; label: string; key?: string; off?: boolean; danger?: boolean } | null)[],
    [first, last, size, sizes, removable, keys],
  );
  // Up and down arrows step through the menu, as in a native one.
  const onKey = (e: ReactKeyboardEvent) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const all = [...(ref.current?.querySelectorAll<HTMLElement>("button:not(:disabled)") ?? [])];
    const i = all.indexOf(document.activeElement as HTMLElement);
    all[(i + (e.key === "ArrowDown" ? 1 : -1) + all.length) % all.length]?.focus();
  };
  return (
    <div
      ref={ref}
      role="menu"
      aria-label={name}
      onKeyDown={onKey}
      onClick={(e) => e.stopPropagation()}
      className="absolute top-full right-2 z-50 mt-1 w-52 rounded-lg border border-line bg-surface p-1 shadow-xl"
    >
      {items.map((it, i) =>
        it === null ? (
          <hr key={i} className="my-1 border-rule" />
        ) : (
          <button
            key={it.label}
            type="button"
            role="menuitem"
            disabled={it.off}
            onClick={() => onPick(it.pick)}
            className={cx(
              "flex w-full items-center justify-between rounded-md px-2.5 py-1.5 text-left text-sm hover:bg-raised focus:bg-accent-soft focus:outline-none disabled:text-faint disabled:hover:bg-transparent",
              it.danger && "text-negative",
            )}
          >
            {it.label}
            {it.key && <span className="text-xs text-faint">{it.key}</span>}
          </button>
        ),
      )}
    </div>
  );
}

function Grip() {
  return (
    <svg width="10" height="16" viewBox="0 0 10 16" fill="currentColor" aria-hidden>
      {[2, 8, 14].flatMap((y) => [<circle key={`a${y}`} cx="2.5" cy={y} r="1.4" />, <circle key={`b${y}`} cx="7.5" cy={y} r="1.4" />])}
    </svg>
  );
}
