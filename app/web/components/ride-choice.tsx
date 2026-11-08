"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { setOutdoor, type ActionResult } from "@/app/actions";
import { Result, Segmented, button } from "./ui";

/**
 * Indoors or outside for a day's workout, and the one action that goes with it: indoors, Start ride;
 * outside, the workout goes to the bike computer through the intervals.icu calendar. Without
 * intervals.icu there's no way to the bike computer, so Outside asks to connect it instead of saving.
 */
export default function RideChoice({
  day,
  outside,
  connected,
  href = "/ride",
  outsideNote,
}: {
  day: string;
  outside: boolean;
  /** intervals.icu is connected. */
  connected: boolean;
  href?: string;
  /** Added to the outside line, e.g. "in place of the plan's workout". */
  outsideNote?: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [result, setResult] = useState<ActionResult | null>(null);
  const [needsIntervals, setNeedsIntervals] = useState(false);
  // Shown once, right after a send went through.
  const [justSent, setJustSent] = useState(false);

  const pick = (where: "indoors" | "outside") => {
    setResult(null);
    setJustSent(false);
    if (where === "outside" && !outside && !connected) return setNeedsIntervals(true);
    setNeedsIntervals(false);
    if ((where === "outside") === outside) return;
    start(async () => {
      const r = await setOutdoor(day, where === "outside");
      if (!r.ok) setResult(r);
      else if (where === "outside") setJustSent(true);
      if (r.ok) router.refresh();
    });
  };

  const showOutside = outside || needsIntervals;
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-3">
        <Segmented
          label="Where you're riding"
          value={showOutside ? "outside" : "indoors"}
          onChange={pick}
          disabled={pending}
          options={[
            { value: "indoors", label: "Indoors" },
            { value: "outside", label: "Outside" },
          ]}
        />
        {pending ? (
          <span className="text-sm text-muted">{outside ? "Moving it indoors…" : "Sending to intervals.icu…"}</span>
        ) : needsIntervals ? (
          <span className="text-sm text-muted">
            Riding outside sends the workout to your bike computer through intervals.icu.{" "}
            <Link href="/settings#connections" className="text-ink underline underline-offset-4">
              Connect intervals.icu
            </Link>
          </span>
        ) : outside ? (
          <span className="flex items-center gap-1.5 text-sm text-muted">
            {connected && (
              <svg viewBox="0 0 16 16" className="size-4 shrink-0 text-positive" aria-hidden>
                <path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            )}
            <span>
              {connected
                ? `${justSent ? "Sent to" : "On"} your intervals.icu calendar${outsideNote ? `, ${outsideNote}` : ""}. Your bike computer gets it on its next sync.`
                : "Connect intervals.icu in Settings to send it to your bike computer."}
            </span>
          </span>
        ) : (
          <Link href={href} className={button.primary}>
            Start ride
          </Link>
        )}
      </div>
      {result && <Result ok={false}>{result.message}</Result>}
    </div>
  );
}
