// Start with Zwift (desktop): with it on, Lactic stays in the menu bar and, when Zwift, Rouvy or
// MyWhoosh opens, gets a free ride ready on the Ride page with that app on the trainer. Pedaling
// starts it and the overlay opens, as for any ride. Lactic only reads running program names (apps.rs).

import { useEffect, useRef, useState } from "react";
import { AppWatch } from "@/lib/ride/app-watch";
import { isRiding } from "@/lib/live-ride";
import { invoke, isDesktop, isPhone } from "~/platform/native";

export const APP_START_PREF = "ride.startWithApp";
/** Sent to the Ride page when it's already open: get a free ride ready if no ride is under way. */
export const APP_START_EVENT = "lactic:app-start";
const LOOK_EVERY_MS = 10_000;

/** Only the Lactic app on a computer can see other apps. */
export const canWatchApps = () => isDesktop && !isPhone();

export function appStartOn(): boolean {
  try {
    return localStorage.getItem(APP_START_PREF) === "1";
  } catch {
    return false;
  }
}

export async function setAppStart(on: boolean) {
  try {
    localStorage.setItem(APP_START_PREF, on ? "1" : "0");
  } catch {}
  window.dispatchEvent(new CustomEvent(APP_START_PREF));
  await invoke("menu_bar_set", { on }).catch(() => undefined);
}

/** The switch's state, kept in step across the app. */
export function useAppStart(): [boolean, (on: boolean) => void] {
  const [on, setOn] = useState(false);
  useEffect(() => {
    setOn(appStartOn());
    const changed = () => setOn(appStartOn());
    window.addEventListener(APP_START_PREF, changed);
    return () => window.removeEventListener(APP_START_PREF, changed);
  }, []);
  return [on, (next) => void setAppStart(next)];
}

/**
 * Watches for a training app while the switch is on, in the main window. `go` opens the Ride page
 * on a free ride with that app on the trainer (it's only called when no ride is under way).
 */
export function useAppStartWatch(go: () => void) {
  const [on] = useAppStart();
  // Read through a ref, so moving between pages doesn't restart the watch (and count Zwift as just opened).
  const goRef = useRef(go);
  goRef.current = go;
  useEffect(() => {
    if (!canWatchApps() || location.hash.startsWith("#/overlay")) return;
    void invoke("menu_bar_set", { on }).catch(() => undefined);
    if (!on) return;
    const watch = new AppWatch();
    let stopped = false;
    const look = async () => {
      const app = await invoke<string | null>("training_app_open").catch(() => null);
      if (!stopped && watch.update(app, isRiding())) goRef.current();
    };
    void look();
    const id = window.setInterval(() => void look(), LOOK_EVERY_MS);
    return () => {
      stopped = true;
      window.clearInterval(id);
    };
  }, [on]);
}

/** The training app open on the computer now (Zwift, Rouvy, MyWhoosh), looked for while `on`. */
export function useTrainingApp(on: boolean): string | null {
  const [app, setApp] = useState<string | null>(null);
  useEffect(() => {
    if (!on || !canWatchApps()) return setApp(null);
    let stopped = false;
    const look = async () => {
      const open = await invoke<string | null>("training_app_open").catch(() => null);
      if (!stopped) setApp(open);
    };
    void look();
    const id = window.setInterval(() => void look(), LOOK_EVERY_MS);
    return () => {
      stopped = true;
      window.clearInterval(id);
    };
  }, [on]);
  return app;
}
