"use client";

import { useState, useTransition } from "react";
import { Panel, Result, button, input } from "@/components/ui";
import { addDays } from "@/lib/engine/pmc";
import type { Workout } from "@/lib/engine/workout";
import { sendOutdoorWorkout, type ActionResult } from "../actions";

const DAYS_OFFERED = 7;

/**
 * Sends the loaded workout (with any edits and intensity) to a day as an outdoor ride. It goes to the
 * intervals.icu calendar in place of that day's planned workout, and the Karoo picks it up from there.
 */
export default function SendToKaroo({ workout, today }: { workout: Workout; today: string }) {
  const [day, setDay] = useState(today);
  const [pending, start] = useTransition();
  const [result, setResult] = useState<ActionResult | null>(null);
  const days = Array.from({ length: DAYS_OFFERED }, (_, i) => addDays(today, i));
  return (
    <Panel title="Ride it outside">
      <div className="space-y-3">
        <p className="text-sm text-muted">
          Sends this workout to your Karoo through intervals.icu, in place of the day&apos;s planned one. Targets go as ranges and ramps as steps, since outside
          you hold power by feel.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <select value={day} onChange={(e) => setDay(e.target.value)} aria-label="Day" className={input}>
            {days.map((d, i) => (
              <option key={d} value={d}>
                {i === 0 ? "Today" : i === 1 ? "Tomorrow" : dayLabel(d)}
              </option>
            ))}
          </select>
          <button className={button.secondary} disabled={pending} onClick={() => start(async () => setResult(await sendOutdoorWorkout(day, workout)))}>
            {pending ? "Sending…" : "Send to Karoo"}
          </button>
        </div>
        {result && <Result ok={result.ok}>{result.message}</Result>}
      </div>
    </Panel>
  );
}

const dayLabel = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric", timeZone: "UTC" });
