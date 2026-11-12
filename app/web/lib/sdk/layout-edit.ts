// Changes a rider makes in Customize Today and Settings → Layout, as pure functions over a Layout
// (layout.ts). Each returns a new layout and leaves the old one alone, so the editor can keep a
// list of them for Undo and Cancel. Plain data, no browser APIs.

import { FIXED_TABS, type Layout, type TabId } from "./layout";
import type { CardSize } from "./widgets";
import { todayCard } from "./today-cards";

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

function move<T>(list: readonly T[], from: number, to: number): T[] {
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(clamp(to, 0, next.length), 0, item);
  return next;
}

/** The cards Today shows while editing: every card not hidden, in order. */
export function shownCards(layout: Layout) {
  return layout.today.filter((c) => !c.hidden);
}

/** Cards waiting in "Add a card": hidden ones, in layout order. */
export function hiddenCards(layout: Layout) {
  return layout.today.filter((c) => c.hidden);
}

/**
 * Moves a shown card to `index` among the shown cards (0 = top). Hidden cards keep their place in
 * the stored list, so moving never reorders cards the rider can't see.
 */
export function moveCard(layout: Layout, widget: string, index: number): Layout {
  const shown = shownCards(layout);
  const from = shown.findIndex((c) => c.widget === widget);
  if (from < 0) return layout;
  const to = clamp(index, 0, shown.length - 1);
  if (to === from) return layout;
  const order = move(shown, from, to);
  let i = 0;
  return { ...layout, today: layout.today.map((c) => (c.hidden ? c : order[i++])) };
}

/** Moves a shown card one place up (-1) or down (+1). */
export function nudgeCard(layout: Layout, widget: string, by: -1 | 1): Layout {
  const at = shownCards(layout).findIndex((c) => c.widget === widget);
  return at < 0 ? layout : moveCard(layout, widget, at + by);
}

/** Sets a card's size, if the card can be drawn at it. */
export function sizeCard(layout: Layout, widget: string, size: CardSize): Layout {
  if (!todayCard(widget).sizes.includes(size)) return layout;
  return { ...layout, today: layout.today.map((c) => (c.widget === widget ? { ...c, size } : c)) };
}

/** Takes a card off Today. It stays in the layout as hidden, so it waits in "Add a card" and doesn't come back on its own. */
export function removeCard(layout: Layout, widget: string): Layout {
  if (todayCard(widget).required) return layout;
  return { ...layout, today: layout.today.map((c) => (c.widget === widget ? { ...c, hidden: true } : c)) };
}

/** Puts a hidden card back, at the bottom of Today (where the rider will see it arrive). */
export function addCard(layout: Layout, widget: string): Layout {
  const card = layout.today.find((c) => c.widget === widget);
  if (!card || !card.hidden) return layout;
  return { ...layout, today: [...layout.today.filter((c) => c !== card), { ...card, hidden: false }] };
}

/** Moves a tab to `index` in the bar (0 = first). */
export function moveTab(layout: Layout, id: TabId, index: number): Layout {
  const from = layout.tabs.findIndex((t) => t.id === id);
  if (from < 0 || clamp(index, 0, layout.tabs.length - 1) === from) return layout;
  return { ...layout, tabs: move(layout.tabs, from, index) };
}

/** Shows or hides a tab. Today and Ride always show. */
export function setTabHidden(layout: Layout, id: TabId, hidden: boolean): Layout {
  if (hidden && FIXED_TABS.includes(id)) return layout;
  return { ...layout, tabs: layout.tabs.map((t) => (t.id === id ? { ...t, hidden } : t)) };
}

/** Whether two layouts would look the same (Done with no change saves nothing). */
export function sameLayout(a: Layout, b: Layout): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** How a layout differs from another, in a few words, for a saved copy's name ("Health hidden, brief moved"). */
export function layoutChanges(layout: Layout, from: Layout): string[] {
  const out: string[] = [];
  const name = (w: string) => todayCard(w).name;
  for (const t of layout.tabs) if (t.hidden && !from.tabs.find((x) => x.id === t.id)?.hidden) out.push(`${TAB_LABELS[t.id]} tab hidden`);
  if (layout.tabs.map((t) => t.id).join() !== from.tabs.map((t) => t.id).join()) out.push("tabs reordered");
  for (const c of layout.today) {
    const was = from.today.find((x) => x.widget === c.widget);
    if (c.hidden && !was?.hidden) out.push(`${name(c.widget)} removed`);
    else if (!c.hidden && was && c.size !== was.size) out.push(`${name(c.widget)} made ${c.size}`);
  }
  // Order among the cards shown in both, so a removed or added card doesn't count as a move.
  const inBoth = (w: string) => !layout.today.find((c) => c.widget === w)?.hidden && from.today.some((c) => c.widget === w && !c.hidden);
  const order = (l: Layout) => shownCards(l).map((c) => c.widget).filter(inBoth).join();
  if (order(layout) !== order(from)) out.push("cards moved");
  return out;
}

export const TAB_LABELS: Record<TabId, string> = { today: "Today", plan: "Plan", ride: "Ride", progress: "Progress", health: "Health" };

/** The layout in short, for feedback reports (review U10): tab order with hidden ones marked, and Today's cards. */
export function layoutSummary(layout: Layout) {
  return {
    tabs: layout.tabs.map((t) => (t.hidden ? `${t.id} (hidden)` : t.id)),
    today: layout.today.map((c) => `${c.widget} ${c.size}${c.hidden ? " (hidden)" : ""}`),
  };
}
