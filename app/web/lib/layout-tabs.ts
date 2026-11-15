// The tab bar's order and which tabs are hidden (the layout's `tabs`), kept here so the nav can
// draw them without waiting. The shell loads the saved layout at start; saving one updates it.

import { defaultLayout, type TabEntry } from "./sdk/layout";

export const TABS_EVENT = "lactic:tabs";

let current: TabEntry[] = defaultLayout().tabs;

export function currentTabs(): TabEntry[] {
  return current;
}

export function setCurrentTabs(tabs: TabEntry[]) {
  current = tabs;
  globalThis.dispatchEvent?.(new Event(TABS_EVENT));
}
