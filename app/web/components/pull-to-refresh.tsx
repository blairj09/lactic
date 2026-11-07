"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { newDayRefreshHeld } from "@/lib/new-day";
import { PULL_THRESHOLD, pullArmed, pullDistance } from "@/lib/pull-refresh";

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
 * Pull down at the top of a page on the phone to refetch its data. It's a soft refresh
 * (router.refresh), like the new-day refresh, so drafts and connections survive, and it's off while
 * a ride holds refreshes (see holdNewDayRefresh).
 */
export default function PullToRefresh() {
  const router = useRouter();
  const [enabled, setEnabled] = useState(false);
  const [pull, setPull] = useState(0);
  const [refreshing, startTransition] = useTransition();
  const refreshingRef = useRef(false);
  refreshingRef.current = refreshing;

  useEffect(() => {
    setEnabled(isStandalone() && window.matchMedia("(pointer: coarse)").matches);
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
      // Hold the page still (no rubber band) while the indicator follows the finger.
      if (e.cancelable) e.preventDefault();
      distance = pullDistance(dy);
      setPull(distance);
    };
    const onEnd = () => {
      if (!start) return;
      const go = decided && pullArmed(distance);
      reset();
      if (go) startTransition(() => router.refresh());
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
  }, [enabled, router]);

  if (!enabled || (pull === 0 && !refreshing)) return null;
  const offset = refreshing ? PULL_THRESHOLD * 0.75 : pull * 0.75;
  const progress = Math.min(pull / PULL_THRESHOLD, 1);
  return (
    <div
      className="pointer-events-none fixed inset-x-0 top-0 z-50 flex justify-center"
      style={{
        transform: `translateY(calc(env(safe-area-inset-top) + ${offset - 40}px))`,
        transition: pull === 0 ? "transform 200ms ease-out" : undefined,
      }}
      role="status"
      aria-label={refreshing ? "Refreshing" : "Pull to refresh"}
    >
      <div className="flex size-10 items-center justify-center rounded-full border border-line bg-surface shadow-md">
        <svg
          viewBox="0 0 24 24"
          className={`size-5 text-ink ${refreshing ? "animate-spin" : ""}`}
          style={refreshing ? undefined : { transform: `rotate(${progress * 270}deg)`, opacity: 0.35 + progress * 0.65 }}
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <path d="M21 12a9 9 0 1 1-2.64-6.36" />
          <path d="M21 3v6h-6" />
        </svg>
      </div>
    </div>
  );
}
