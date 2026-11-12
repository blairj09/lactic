// Keeps the screen from sleeping while a ride is showing. On the iPhone that's the app's idle timer
// (Swift, isIdleTimerDisabled), which the web view's wake lock doesn't reliably reach; elsewhere the
// browser's screen wake lock. Several screens can hold it at once (the phone's own ride, the remote
// for the computer's ride); the screen may sleep again once none do. Off while the app is in the
// background, back on when it returns.

import { useEffect } from "react";
import { invoke, isDesktop, isPhone } from "./native";

let holders = 0;
let lock: WakeLockSentinel | null = null;
let asking = false;
let applied = false;

function apply() {
  const want = holders > 0 && typeof document !== "undefined" && !document.hidden;
  if (isDesktop && isPhone()) {
    if (want === applied) return;
    applied = want;
    void invoke("plugin:lactic-phone|keep_awake", { on: want }).catch(() => {});
    return;
  }
  if (typeof navigator === "undefined" || !("wakeLock" in navigator)) return;
  if (want && !lock && !asking) {
    asking = true;
    navigator.wakeLock.request("screen").then(
      (l) => {
        asking = false;
        lock = l;
        l.addEventListener("release", () => {
          if (lock === l) lock = null;
        });
        apply();
      },
      () => (asking = false),
    );
  } else if (!want && lock) {
    const l = lock;
    lock = null;
    void l.release().catch(() => {});
  }
}

if (typeof document !== "undefined") document.addEventListener("visibilitychange", apply);

/** Keeps the screen awake while `on`; lets it sleep again when off or unmounted. */
export function useKeepAwake(on: boolean) {
  useEffect(() => {
    if (!on) return;
    holders++;
    apply();
    return () => {
      holders--;
      apply();
    };
  }, [on]);
}
