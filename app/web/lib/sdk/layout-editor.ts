// What Customize Today and Settings → Layout do, on top of the coach's edits (layout-edit.ts), so
// the rider and the coach change a layout the same way. The editor works in positions ("put it
// third") and never fails: an edit that can't be made leaves the layout as it was (the same
// object), which the editor reads as "nothing changed". Plain data, no browser APIs.

import { FIXED_TABS, type Layout, type TabId } from "./layout";
import { applyLayoutChange, TAB_NAMES, type LayoutChange, type LayoutContext } from "./layout-edit";
import { BUILTIN_TODAY_WIDGETS, todayCard } from "./builtin-widgets";
import { MetricRegistry } from "./metrics";
import type { CardSize } from "./widgets";

/** Lactic's own cards and metrics; plugin cards join when plugins can be installed. */
const BUILTIN: LayoutContext = { widgets: BUILTIN_TODAY_WIDGETS, metrics: new MetricRegistry() };

function edit(layout: Layout, change: LayoutChange, ctx: LayoutContext = BUILTIN): Layout {
  try {
    return applyLayoutChange(layout, change, ctx);
  } catch {
    return layout;
  }
}

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

/** The cards Today shows while editing: every card not hidden, in order. */
export function shownCards(layout: Layout) {
  return layout.today.filter((c) => !c.hidden);
}

/** Cards waiting in "Add a card": hidden ones, in layout order. */
export function hiddenCards(layout: Layout) {
  return layout.today.filter((c) => c.hidden);
}

/** Moves a shown card to `index` among the shown cards (0 = top), after the shown card before it. */
export function moveCard(layout: Layout, widget: string, index: number): Layout {
  const shown = shownCards(layout);
  const from = shown.findIndex((c) => c.widget === widget);
  if (from < 0) return layout;
  const to = clamp(index, 0, shown.length - 1);
  if (to === from) return layout;
  const others = shown.filter((c) => c.widget !== widget);
  return edit(layout, { action: "move_card", widget, after: to === 0 ? null : others[to - 1].widget });
}

/** Moves a shown card one place up (-1) or down (+1). */
export function nudgeCard(layout: Layout, widget: string, by: -1 | 1): Layout {
  const at = shownCards(layout).findIndex((c) => c.widget === widget);
  return at < 0 ? layout : moveCard(layout, widget, at + by);
}

/** Sets a card's size, if the card can be drawn at it. */
export function sizeCard(layout: Layout, widget: string, size: CardSize): Layout {
  return layout.today.find((c) => c.widget === widget)?.size === size ? layout : edit(layout, { action: "resize_card", widget, size });
}

/** Takes a card off Today. It stays in the layout as hidden, so it waits in "Add a card" and doesn't come back on its own. */
export function removeCard(layout: Layout, widget: string): Layout {
  return edit(layout, { action: "hide_card", widget });
}

/** Puts a hidden card back at its size, at the bottom of Today (where the rider sees it arrive). */
export function addCard(layout: Layout, widget: string): Layout {
  const card = layout.today.find((c) => c.widget === widget);
  if (!card?.hidden) return layout;
  return edit(layout, { action: "add_card", widget, size: card.size, after: shownCards(layout).at(-1)?.widget ?? null });
}

/** Moves a tab to `index` in the bar (0 = first). */
export function moveTab(layout: Layout, id: TabId, index: number): Layout {
  const from = layout.tabs.findIndex((t) => t.id === id);
  const to = clamp(index, 0, layout.tabs.length - 1);
  if (from < 0 || to === from) return layout;
  const others = layout.tabs.filter((t) => t.id !== id);
  return edit(layout, { action: "move_tab", tab: id, after: to === 0 ? null : others[to - 1].id });
}

/** Shows or hides a tab. Today and Ride always show. */
export function setTabHidden(layout: Layout, id: TabId, hidden: boolean): Layout {
  if (hidden && FIXED_TABS.includes(id)) return layout;
  return edit(layout, { action: hidden ? "hide_tab" : "show_tab", tab: id });
}

/** Whether two layouts would look the same (Done with no change saves nothing). */
export function sameLayout(a: Layout, b: Layout): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** How a layout differs from another, in a few words, for a saved copy ("Health tab hidden, cards moved"). */
export function layoutChanges(layout: Layout, from: Layout): string[] {
  const out: string[] = [];
  const name = (w: string) => todayCard(w).name;
  for (const t of layout.tabs) if (t.hidden && !from.tabs.find((x) => x.id === t.id)?.hidden) out.push(`${TAB_NAMES[t.id]} tab hidden`);
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

/** The layout in short, for feedback reports (review U10): tab order with hidden ones marked, and Today's cards. */
export function layoutSummary(layout: Layout) {
  return {
    tabs: layout.tabs.map((t) => (t.hidden ? `${t.id} (hidden)` : t.id)),
    today: layout.today.map((c) => `${c.widget} ${c.size}${c.hidden ? " (hidden)" : ""}`),
  };
}

/**
 * How many columns a row of Today cards takes on a computer: two Mediums or three Smalls share a
 * row, and a row with fewer cards than that (a lone Medium, say, because its neighbour isn't
 * showing today) spreads them across the width rather than leaving a hole.
 */
export function rowColumns(row: { size: CardSize; widgets: readonly string[] }): 1 | 2 | 3 {
  const most = row.size === "small" ? 3 : row.size === "medium" ? 2 : 1;
  return Math.max(1, Math.min(most, row.widgets.length)) as 1 | 2 | 3;
}
