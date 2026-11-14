"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { newDayRefreshHeld } from "@/lib/new-day";
import { barGrowth, PULL_THRESHOLD, pullArmed, pullDistance, runPullRefreshWork } from "@/lib/pull-refresh";
import { isPhone } from "~/platform/native";

/** The logo's bars (app/index.html's loader), each growing from its foot. */
const BARS = [
  { x: 2, y: 15, w: 2.8, h: 6 },
  { x: 4.5, y: 10.5, w: 2.8, h: 10.5 },
  { x: 7, y: 6.5, w: 2.8, h: 14.5 },
  { x: 9.5, y: 3, w: 2.8, h: 18 },
  { x: 12, y: 15, w: 10, h: 6 },
];
/** The loader shows at least this long, so a quick refresh still reads as one. */
const MIN_SHOW_MS = 700;

/** Home-screen web apps (iOS standalone) have no native pull-to-refresh; browsers do. */
function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  const nav = window.navigator as Navigator & { standalone?: boolean };
  return nav.standalone === true || window.matchMedia("(display-mode: standalone)").matches;
}

/**
 * A pull that starts here should scroll or drag something else: a sheet, dialog or the coach
 * drawer (all fixed), or a scroll box that isn't at its top.
 */
function startsElsewhere(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return true;
  if (target.closest("dialog, [role=dialog], [data-no-pull-refresh]")) return true;
  for (let el: Element | null = target; el && el !== document.body; el = el.parentElement) {
    if (el.scrollTop > 0) return true;
    if (getComputedStyle(el).position === "fixed") return true;
  }
  return false;
}

/**
 * Pull down at the top of a page on the phone to refresh it: the Lactic mark builds bar by bar as
 * you pull, and keeps building while the pull's work runs (on the iPhone app: read Apple Health and
 * sync with the computer, see setPullRefreshWork) and the page refetches. It's a soft refresh, so
 * drafts and connections survive, and it's off while a ride holds refreshes (see holdNewDayRefresh).
 */
export default function PullToRefresh() {
  const router = useRouter();
  const [enabled, setEnabled] = useState(false);
  const [pull, setPull] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const refreshingRef = useRef(false);
  refreshingRef.current = refreshing;
  const routerRef = useRef(router);
  routerRef.current = router;

  useEffect(() => {
    setEnabled(isPhone() || (isStandalone() && window.matchMedia("(pointer: coarse)").matches));
  }, []);

  useEffect(() => {
    if (!enabled) return;
    let start: { x: number; y: number } | null = null;
    let decided = false;
    let distance = 0;

    const reset = () => {
      start = null;
      decided = false;
      distance = 0;
      setPull(0);
    };
    const refresh = async () => {
      setRefreshing(true);
      const shown = Date.now();
      try {
        await runPullRefreshWork();
        routerRef.current.refresh();
      } finally {
        await new Promise((r) => setTimeout(r, Math.max(0, MIN_SHOW_MS - (Date.now() - shown))));
        setRefreshing(false);
      }
    };
    const onStart = (e: TouchEvent) => {
      if (e.touches.length !== 1 || window.scrollY > 0 || refreshingRef.current) return;
      if (newDayRefreshHeld() || startsElsewhere(e.target)) return;
      start = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      decided = false;
    };
    const onMove = (e: TouchEvent) => {
      if (!start) return;
      const dx = e.touches[0].clientX - start.x;
      const dy = e.touches[0].clientY - start.y;
      if (!decided) {
        if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return;
        // Sideways swipes and upward scrolls aren't pulls.
        if (dy <= 0 || Math.abs(dx) > dy || window.scrollY > 0) return reset();
        decided = true;
      }
      // Hold the page still (no rubber band) while it follows the finger.
      if (e.cancelable) e.preventDefault();
      distance = pullDistance(dy);
      setPull(distance);
    };
    const onEnd = () => {
      if (!start) return;
      const go = decided && pullArmed(distance);
      reset();
      if (go) void refresh();
    };

    window.addEventListener("touchstart", onStart, { passive: true });
    window.addEventListener("touchmove", onMove, { passive: false });
    window.addEventListener("touchend", onEnd);
    window.addEventListener("touchcancel", reset);
    return () => {
      window.removeEventListener("touchstart", onStart);
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("touchend", onEnd);
      window.removeEventListener("touchcancel", reset);
    };
  }, [enabled]);

  // The page slides down under the header to make room for the mark, and back when done.
  const offset = refreshing ? PULL_THRESHOLD : pull;
  useEffect(() => {
    if (!enabled) return;
    const main = document.querySelector("main");
    if (!main) return;
    main.style.transform = offset ? `translateY(${offset}px)` : "";
    main.style.transition = pull === 0 ? "transform 200ms ease-out" : "";
  }, [enabled, offset, pull]);

  if (!enabled || offset === 0) return null;
  const progress = Math.min(pull / PULL_THRESHOLD, 1);
  return (
    <div
      className="pointer-events-none fixed inset-x-0 z-20 flex items-center justify-center"
      style={{ top: "calc(env(safe-area-inset-top) + 3rem)", height: offset }}
      role="status"
      aria-label={refreshing ? "Refreshing" : "Pull to refresh"}
    >
      <svg viewBox="0 0 24 24" className={`lactic-pull-mark size-7 overflow-visible text-accent ${refreshing ? "lactic-pull-building" : ""}`} aria-hidden>
        {BARS.map((b, i) => (
          <rect key={i} x={b.x} y={b.y} width={b.w} height={b.h} fill="currentColor" style={refreshing ? undefined : { transform: `scaleY(${barGrowth(progress, i)})` }} />
        ))}
      </svg>
    </div>
  );
}
