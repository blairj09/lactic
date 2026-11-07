"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { setOutdoor, type ActionResult } from "@/app/actions";
import { Result, button } from "./ui";

/** Rides a plan day outside or back indoors. Outside, the day's workout goes to the Karoo through intervals.icu. */
export default function OutdoorToggle({ day, outside, compact = false }: { day: string; outside: boolean; compact?: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [result, setResult] = useState<ActionResult | null>(null);
  const toggle = () =>
    start(async () => {
      const r = await setOutdoor(day, !outside);
      setResult(r);
      if (r.ok) router.refresh();
    });
  if (compact) {
    return (
      <button
        type="button"
        onClick={toggle}
        disabled={pending}
        title={outside ? "Riding outside: on your bike computer. Click to ride indoors." : "Ride this outside and send it to your bike computer through intervals.icu"}
        className="text-xs text-muted underline-offset-4 hover:text-ink hover:underline disabled:opacity-50"
      >
        {pending ? "Sending…" : outside ? "Ride indoors" : "Ride outside"}
      </button>
    );
  }
  return (
    <span className="flex flex-wrap items-center gap-3">
      <button type="button" className={button.secondary} onClick={toggle} disabled={pending}>
        {pending ? "Sending…" : outside ? "Ride indoors instead" : "Ride outside"}
      </button>
      {result && <Result ok={result.ok}>{result.message}</Result>}
    </span>
  );
}
