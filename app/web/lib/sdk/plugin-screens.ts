// The Plugins tab's screens: placing new plugin cards and the editor's moves. Each function returns
// a new layout and leaves the one passed in alone. Plain data, no browser APIs.
import { MAX_PLUGIN_SCREENS, type Layout, type PluginScreen } from "./layout";
import type { CardSize } from "./widgets";

const clone = (l: Layout): Layout => structuredClone(l);
const NAME_MAX = 24;

/** A plugin card that can be placed: switched on here and declared in its manifest. */
export interface PluginCard {
  id: string;
  pluginName: string;
  title: string;
}

/**
 * New plugin cards (never placed before) go at the end of the first screen. A card the rider took
 * off every screen stays off; one whose plugin was removed stays where it was, drawn as a placeholder.
 */
export function placeNewCards(layout: Layout, available: readonly PluginCard[]): Layout {
  const fresh = available.filter((c) => !layout.plugins.placed.includes(c.id));
  if (!fresh.length) return layout;
  const l = clone(layout);
  const first = l.plugins.screens[0];
  for (const c of fresh) {
    if (!l.plugins.screens.some((s) => s.cards.some((x) => x.widget === c.id))) first.cards.push({ widget: c.id, size: "medium", hidden: false });
    l.plugins.placed.push(c.id);
  }
  return l;
}

function screen(l: Layout, i: number): PluginScreen {
  const s = l.plugins.screens[i];
  if (!s) throw new Error("No such screen");
  return s;
}

const cleanName = (name: string) => name.trim().slice(0, NAME_MAX);

/** A new screen after the others. Names default to "Screen 2", "Screen 3"… */
export function addScreen(layout: Layout, name?: string): Layout {
  if (layout.plugins.screens.length >= MAX_PLUGIN_SCREENS) throw new Error(`Up to ${MAX_PLUGIN_SCREENS} screens`);
  const l = clone(layout);
  let n = l.plugins.screens.length + 1;
  while (l.plugins.screens.some((s) => s.name === `Screen ${n}`)) n++;
  l.plugins.screens.push({ name: cleanName(name ?? "") || `Screen ${n}`, cards: [] });
  return l;
}

export function renameScreen(layout: Layout, i: number, name: string): Layout {
  const clean = cleanName(name);
  if (!clean) return layout;
  const l = clone(layout);
  screen(l, i).name = clean;
  return l;
}

/** Move a screen one place left (-1) or right (+1). */
export function moveScreen(layout: Layout, i: number, by: -1 | 1): Layout {
  const j = i + by;
  if (j < 0 || j >= layout.plugins.screens.length) return layout;
  const l = clone(layout);
  const s = l.plugins.screens;
  [s[i], s[j]] = [s[j], s[i]];
  return l;
}

/** Delete a screen; the last one can't go (an empty screen is fine). */
export function deleteScreen(layout: Layout, i: number): Layout {
  if (layout.plugins.screens.length <= 1) return layout;
  const l = clone(layout);
  screen(l, i);
  l.plugins.screens.splice(i, 1);
  return l;
}

export function addCard(layout: Layout, i: number, card: string, size: CardSize = "medium"): Layout {
  const l = clone(layout);
  const s = screen(l, i);
  if (s.cards.some((c) => c.widget === card)) return layout;
  s.cards.push({ widget: card, size, hidden: false });
  if (!l.plugins.placed.includes(card)) l.plugins.placed.push(card);
  return l;
}

export function removeCard(layout: Layout, i: number, card: string): Layout {
  const l = clone(layout);
  const s = screen(l, i);
  s.cards = s.cards.filter((c) => c.widget !== card);
  return l;
}

/** Move a card within its screen: up (-1), down (+1), or to the top ("top"). */
export function moveCard(layout: Layout, i: number, card: string, by: -1 | 1 | "top"): Layout {
  const l = clone(layout);
  const cards = screen(l, i).cards;
  const k = cards.findIndex((c) => c.widget === card);
  const to = by === "top" ? 0 : k + by;
  if (k < 0 || to < 0 || to >= cards.length || to === k) return layout;
  const [c] = cards.splice(k, 1);
  cards.splice(to, 0, c);
  return l;
}

export function resizeCard(layout: Layout, i: number, card: string, size: CardSize): Layout {
  const l = clone(layout);
  const c = screen(l, i).cards.find((x) => x.widget === card);
  if (!c) return layout;
  c.size = size;
  return l;
}
