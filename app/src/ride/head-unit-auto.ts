// Head unit with Zwift (Lactic Modular, desktop): with it on, Lactic stays in the menu bar and, when
// Zwift, Rouvy or MyWhoosh opens, gets the head unit ready on the Ride page. Pedaling starts it and
// the overlay opens, as for any ride. Lactic only reads running program names (apps.rs).

import { useEffect, useRef, useState } from "react";
import { AppWatch } from "@/lib/ride/app-watch";
import { isRiding } from "@/lib/live-ride";
import { invoke, isDesktop, isPhone } from "~/platform/native";

export const HEAD_UNIT_AUTO_PREF = "ride.headUnitWithApp";
/** Sent to the Ride page when it's already open: switch to the head unit if no ride is under way. */
export const HEAD_UNIT_EVENT = "lactic:head-unit";
const LOOK_EVERY_MS = 10_000;

/** Only the Lactic app on a computer can see other apps. */
export const canWatchApps = () => isDesktop && !isPhone();

export function headUnitAutoOn(): boolean {
  try {
    return localStorage.getItem(HEAD_UNIT_AUTO_PREF) === "1";
  } catch {
    return false;
  }
}

export async function setHeadUnitAuto(on: boolean) {
  try {
    localStorage.setItem(HEAD_UNIT_AUTO_PREF, on ? "1" : "0");
  } catch {}
  window.dispatchEvent(new CustomEvent(HEAD_UNIT_AUTO_PREF));
  await invoke("menu_bar_set", { on }).catch(() => undefined);
}

/** The switch's state, kept in step across the app. */
export function useHeadUnitAuto(): [boolean, (on: boolean) => void] {
  const [on, setOn] = useState(false);
  useEffect(() => {
    setOn(headUnitAutoOn());
    const changed = () => setOn(headUnitAutoOn());
    window.addEventListener(HEAD_UNIT_AUTO_PREF, changed);
    return () => window.removeEventListener(HEAD_UNIT_AUTO_PREF, changed);
  }, []);
  return [on, (next) => void setHeadUnitAuto(next)];
}

/**
 * Watches for a training app while the switch is on, in the main window. `go` opens the Ride page
 * on the head unit (it's only called when no ride is under way).
 */
export function useHeadUnitWatch(go: () => void) {
  const [on] = useHeadUnitAuto();
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

/** Head unit: the training app open on the computer now (Zwift, Rouvy, MyWhoosh), looked for while `on`. */
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
