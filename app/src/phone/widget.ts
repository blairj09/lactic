// The iPhone's home and lock screen widgets (src-tauri/ios/widgets): after Health reads, syncs and
// anything else that changes the data, the app words today's recovery and ride (widget-snapshot.ts)
// and hands it to the widgets through the App Group they share.

import { exertionTodayFor } from "@/lib/today-options";
import { loadTrainingState } from "@/lib/training";
import { widgetSnapshot } from "@/lib/widget-snapshot";
import { createClient } from "~/db/supabase-client";
import { logEvent } from "~/support/log";
import { saveWidget } from "./plugin";

let running: Promise<void> | null = null;
let again = false;

/** Writes the widgets' snapshot now; a call while one is being written runs once more after it. */
export function updateWidget(): Promise<void> {
  if (running) {
    again = true;
    return running;
  }
  running = (async () => {
    try {
      do {
        again = false;
        const state = await loadTrainingState(createClient() as never);
        await saveWidget(widgetSnapshot(state, exertionTodayFor(state)));
      } while (again);
    } catch (e) {
      logEvent("health", "warn", `Widget not updated: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      running = null;
    }
  })();
  return running;
}
