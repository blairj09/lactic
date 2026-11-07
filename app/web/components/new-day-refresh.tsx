"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { dayKey, msUntilNextDay, newDayRefreshHeld, onNewDayHoldsReleased } from "@/lib/new-day";

/**
 * Keeps a long-open window on the current day: when the local date changes (at midnight, or when
 * the Mac wakes / the window comes back), it refetches the page's server data. It's a soft
 * refresh, so Bluetooth connections, drafts and open drawers survive, and it waits while a ride
 * holds it off (see holdNewDayRefresh).
 */
export default function NewDayRefresh() {
  const router = useRouter();
  useEffect(() => {
    let day = dayKey(new Date());
    let timer: number | undefined;

    const check = () => {
      const today = dayKey(new Date());
      if (today !== day && !newDayRefreshHeld()) {
        day = today;
        router.refresh();
      }
      schedule();
    };
    // Timers stop while the Mac sleeps, so the minute check and focus/visibility catch up after wake.
    const schedule = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(check, Math.min(msUntilNextDay(new Date()), 60_000));
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") check();
    };

    schedule();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", check);
    window.addEventListener("pageshow", check);
    const stop = onNewDayHoldsReleased(check);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", check);
      window.removeEventListener("pageshow", check);
      stop();
    };
  }, [router]);
  return null;
}
