"use client";

import { useSyncExternalStore } from "react";
import { currentTabs, TABS_EVENT } from "./layout-tabs";
import type { TabEntry } from "./sdk/layout";

function subscribe(onChange: () => void) {
  window.addEventListener(TABS_EVENT, onChange);
  return () => window.removeEventListener(TABS_EVENT, onChange);
}

/** The tabs in the rider's order, following changes from Customize and Settings → Layout. */
export function useTabs(): TabEntry[] {
  return useSyncExternalStore(subscribe, currentTabs, currentTabs);
}
