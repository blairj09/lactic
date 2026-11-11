// The iPhone's home and lock screen widgets (src-tauri/ios/widgets): after Health reads, syncs and
// anything else that changes the data, the app words today's recovery and ride (widget-snapshot.ts)
// and hands it to the widgets through the App Group they share.

import { exertionTodayFor } from "@/lib/today-options";
import { loadTrainingState } from "@/lib/training";
import { widgetSnapshot } from "@/lib/widget-snapshot";
import { createClient } from "~/db/supabase-client";
import { loadFeatures } from "~/settings/features";
import { setSetting } from "~/settings/store";
import { logEvent } from "~/support/log";
import { saveWidget } from "./plugin";

/** When the widgets last got a snapshot, or why they didn't (device-local: "phone." never syncs). */
export const WIDGET_STATUS = "phone.widget.status";
export interface WidgetStatus {
  at: string;
  error: string | null;
}

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
        const [state, features] = await Promise.all([loadTrainingState(createClient() as never), loadFeatures()]);
        await saveWidget(widgetSnapshot(state, exertionTodayFor(state), new Date(), features.recovery));
      } while (again);
      await setSetting(WIDGET_STATUS, { at: new Date().toISOString(), error: null });
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      logEvent("health", "warn", `Widget not updated: ${error}`);
      await setSetting(WIDGET_STATUS, { at: new Date().toISOString(), error }).catch(() => {});
    } finally {
      running = null;
    }
  })();
  return running;
}
