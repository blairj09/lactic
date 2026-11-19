// The iPhone's real safe area for full-screen layouts. WKWebView keeps env(safe-area-inset-*) at
// the portrait values after the phone turns sideways (WebKit bug 191363): no inset on the left or
// right, so the ride screen sat under the Dynamic Island, and too much at the top and bottom. While
// on, this asks the app for the window's safe area on every rotation and sets --safe-top, --safe-right,
// --safe-bottom and --safe-left on <html>. Layouts read them with env() as the fallback, e.g.
// var(--safe-left, env(safe-area-inset-left)), so a browser (or a failed ask) keeps env().

import { useEffect } from "react";
import { invoke, isDesktop, isPhone } from "./native";

interface SafeArea {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

const SIDES = ["top", "right", "bottom", "left"] as const;

function set(area: SafeArea | null) {
  const style = document.documentElement.style;
  for (const side of SIDES) {
    const v = area?.[side];
    if (typeof v === "number" && Number.isFinite(v) && v >= 0 && v < 200) style.setProperty(`--safe-${side}`, `${Math.round(v)}px`);
    else style.removeProperty(`--safe-${side}`);
  }
}

/** Keeps --safe-* current while `on` (the phone app only); clears them when off or unmounted. */
export function useSafeArea(on: boolean) {
  useEffect(() => {
    if (!on || !isDesktop || !isPhone()) return;
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const ask = () =>
      void invoke<SafeArea>("plugin:lactic-phone|safe_area").then(
        (a) => live && set(a),
        () => {},
      );
    // Right away, and again once the rotation has settled.
    const update = () => {
      ask();
      clearTimeout(timer);
      timer = setTimeout(ask, 350);
    };
    update();
    window.addEventListener("resize", update);
    window.addEventListener("orientationchange", update);
    return () => {
      live = false;
      clearTimeout(timer);
      window.removeEventListener("resize", update);
      window.removeEventListener("orientationchange", update);
      set(null);
    };
  }, [on]);
}
