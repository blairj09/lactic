// Keeps your place as you move around the window (see place.ts): remembers the place open in each
// screen and how far down it's scrolled, and on Back, or on coming back to a screen through its
// tab, scrolls to where you were once the page has loaded. Anything else opens at the top.

import { useEffect, useLayoutEffect, useRef } from "react";
import { useLocation, useNavigationType } from "react-router";
import { URL_REPLACED } from "@/lib/replace-search";
import { currentUrl, places, placesChanged } from "./place";

/** Navigation state a tab link carries so the page it returns to comes back scrolled where it was. */
export const RESTORE = { restorePlace: true };

export function PlaceKeeper() {
  const location = useLocation();
  const type = useNavigationType();
  // While a page loads and grows back to its old height, scroll events aren't the rider's.
  const restoring = useRef<(() => void) | null>(null);

  useEffect(() => {
    if ("scrollRestoration" in window.history) window.history.scrollRestoration = "manual";
    let frame = 0;
    const onScroll = () => {
      if (restoring.current || frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        places.saveScroll(currentUrl(), window.scrollY);
      });
    };
    // A query changed in place (Progress's range) is part of the place.
    const onReplace = () => {
      places.visit(currentUrl());
      placesChanged();
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener(URL_REPLACED, onReplace);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener(URL_REPLACED, onReplace);
    };
  }, []);

  useLayoutEffect(() => {
    restoring.current?.();
    restoring.current = null;
    const url = currentUrl();
    places.visit(url);
    placesChanged();
    const restore = type === "POP" || (location.state as typeof RESTORE | null)?.restorePlace === true;
    const y = restore ? places.scrollFor(url) : 0;
    if (y <= 0) {
      window.scrollTo(0, 0);
      return;
    }
    // The page shows a skeleton while its data loads: keep scrolling toward the old spot until the
    // page is tall enough to reach it, for a few seconds at most, or until the rider scrolls.
    let frame = 0;
    const started = performance.now();
    const stop = () => {
      cancelAnimationFrame(frame);
      for (const e of ["wheel", "touchstart", "keydown", "mousedown"]) window.removeEventListener(e, stop);
      if (restoring.current === stop) restoring.current = null;
    };
    const step = () => {
      const max = document.documentElement.scrollHeight - window.innerHeight;
      window.scrollTo(0, Math.min(y, Math.max(0, max)));
      if (max >= y || performance.now() - started > 3000) return stop();
      frame = requestAnimationFrame(step);
    };
    for (const e of ["wheel", "touchstart", "keydown", "mousedown"]) window.addEventListener(e, stop, { passive: true });
    restoring.current = stop;
    step();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.key]);

  return null;
}
