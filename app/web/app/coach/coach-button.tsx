"use client";

import { modKey } from "~/platform/native";
import { openCoach } from "./open";

/**
 * Opens the coach drawer. In the top bar on every page; shown only when the layout mounted the
 * drawer (html[data-coach], see globals.css), since the top bar also renders in the browser.
 */
export default function CoachButton() {
  return (
    <button
      type="button"
      onClick={() => openCoach()}
      title={`Talk to the coach (${modKey()}K)`}
      className="coach-button h-8 items-center gap-2 rounded-md border border-control px-3 text-sm text-ink transition-colors hover:bg-raised"
    >
      Coach
      <kbd className="hidden font-sans text-xs text-faint lg:inline">{modKey()}K</kbd>
    </button>
  );
}
