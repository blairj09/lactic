// Preferences the screens keep in localStorage that should follow the rider between their computer
// and a paired iPhone: units, the ride page's habits (auto-start, sprint grade, how Extend works),
// the workout editor's % / watts choice, and what they dismissed (a skipped post-ride survey, the
// week review, today's skipped morning steps), so the phone doesn't ask again.
//
// Each write to one of these keys is copied into app_settings as `pref.<key>`, which syncs like
// every other setting (last writer wins on updated_at). When synced rows arrive, they are copied
// back into localStorage. Left per device on purpose: theme (a phone often follows the system),
// paired gear and the power source, the ride overlay's size and whether it opens, the activity log.

import { UNITS_EVENT, UNITS_KEY } from "@/lib/units";
import { isPhone } from "~/platform/native";
import { getSetting, setSetting } from "./store";

export const SHARED_PREFS = [
  UNITS_KEY,
  "ride.editorUnit",
  "ride.sprintGrade",
  "ride.autoStart",
  "ride.extendKind",
  "ride.extendBlock",
  "survey.skipped",
  "review.hidden",
  "morning.skips",
] as const;

const SHARED = new Set<string>(SHARED_PREFS);
const PREFIX = "pref.";
/** A copied value: the string localStorage held, or null when it was removed. */
type Copy = { v: string | null };

let applying = false;
let installed = false;

/** Copies writes to the shared keys into app_settings. Safe to call more than once. */
export function installSharedPrefs(store: Storage = localStorage) {
  if (installed) return;
  installed = true;
  const proto = Object.getPrototypeOf(store) as Storage;
  const setItem = proto.setItem;
  const removeItem = proto.removeItem;
  proto.setItem = function (key: string, value: string) {
    setItem.call(this, key, value);
    if (this === store && !applying && SHARED.has(key)) void setSetting(PREFIX + key, { v: String(value) } satisfies Copy).catch(() => {});
  };
  proto.removeItem = function (key: string) {
    removeItem.call(this, key);
    if (this === store && !applying && SHARED.has(key)) void setSetting(PREFIX + key, { v: null } satisfies Copy).catch(() => {});
  };
}

/**
 * Brings localStorage in line with app_settings (after a sync brought rows). On the computer, a
 * preference saved before this existed is copied up first, so the phone gets it; a phone takes the
 * computer's, which is the source of truth. Returns the keys that changed here.
 */
export async function applySharedPrefs(store: Storage = localStorage, seed = !isPhone()): Promise<string[]> {
  const changed: string[] = [];
  for (const key of SHARED_PREFS) {
    const copy = await getSetting<Copy | null>(PREFIX + key, null);
    const here = store.getItem(key);
    if (!copy || typeof copy !== "object" || !("v" in copy)) {
      if (seed && here !== null) await setSetting(PREFIX + key, { v: here } satisfies Copy);
      continue;
    }
    if (copy.v === here) continue;
    applying = true;
    try {
      if (copy.v === null) store.removeItem(key);
      else store.setItem(key, copy.v);
    } finally {
      applying = false;
    }
    changed.push(key);
  }
  if (changed.includes(UNITS_KEY)) window.dispatchEvent(new CustomEvent(UNITS_EVENT));
  return changed;
}
