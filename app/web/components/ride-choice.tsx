"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { setOutdoor, type ActionResult } from "@/app/actions";
import { Result, Segmented, button } from "./ui";

/**
 * Indoors or outside for a day's workout, and the one action that goes with it: indoors, Start ride;
 * outside, the workout is on the bike computer (sent through intervals.icu).
 */
export default function RideChoice({
  day,
  outside,
  href = "/ride",
  outsideNote = "On your bike computer, with power ranges to hold by feel.",
}: {
  day: string;
  outside: boolean;
  href?: string;
  outsideNote?: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [result, setResult] = useState<ActionResult | null>(null);
  const pick = (where: "indoors" | "outside") => {
    if ((where === "outside") === outside) return;
    start(async () => {
      const r = await setOutdoor(day, where === "outside");
      setResult(r.ok ? null : r);
      if (r.ok) router.refresh();
    });
  };
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-3">
        <Segmented
          label="Where you're riding"
          value={outside ? "outside" : "indoors"}
          onChange={pick}
          disabled={pending}
          options={[
            { value: "indoors", label: "Indoors" },
            { value: "outside", label: "Outside" },
          ]}
        />
        {pending ? (
          <span className="text-sm text-muted">{outside ? "Moving it indoors…" : "Sending to your bike computer…"}</span>
        ) : outside ? (
          <span className="text-sm text-muted">{outsideNote}</span>
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
