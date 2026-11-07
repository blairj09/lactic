"use client";

import { useState, useTransition } from "react";
import { Result, input } from "@/components/ui";
import { saveGoalStart } from "./plan/actions";
import type { Goal } from "@/lib/engine/plan";
import { clockAt, raceDay, relativeLabel } from "@/lib/engine/raceday";

/**
 * Today on a race day: the timeline around the start (meal, arrival, warm-up, fuelling, cool-down),
 * the warm-up in detail, and fuel. Every figure comes from the engine (`raceDay`); the start time you
 * enter turns the offsets into clock times, names the pre-race meal, and is saved with the event
 * (also editable on the Plan page).
 */
export default function RaceDayPlan({ goal, ftp, weightKg, summary }: { goal: Goal; ftp: number | null; weightKg: number | null; summary: string }) {
  const goalId = goal.id;
  const [start, setStart] = useState(goal.startTime ?? "");
  const plan = raceDay({ ...goal, startTime: start || null }, ftp, weightKg);
  const [error, setError] = useState<string | null>(null);
  const [, startSaving] = useTransition();
  const save = (value: string) => {
    setStart(value);
    setError(null);
    startSaving(async () => {
      const result = await saveGoalStart(goalId, value || null);
      if (!result.ok) setError(result.message);
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
        <p className="text-[15px] text-muted">{summary}</p>
        <label className="flex items-center gap-2 text-sm">
          Start time
          <input type="time" value={start} onChange={(e) => save(e.target.value)} className={`${input} num w-32`} />
        </label>
        {error && <Result ok={false}>{error}</Result>}
      </div>

      <div className="grid grid-cols-1 gap-x-8 gap-y-6 md:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <section aria-label="Race-day timeline">
          <ol className="relative space-y-4 border-l border-line pl-5">
            {plan.timeline.map((m) => (
              <li key={`${m.offset}-${m.label}`} className="relative">
                <span
                  className={`absolute top-1.5 -left-[25px] size-2.5 rounded-full border-2 border-surface ${m.offset === 0 ? "bg-accent" : "bg-faint"}`}
                  aria-hidden
                />
                <div className="grid grid-cols-[5rem_minmax(0,1fr)] gap-x-3">
                  <span className={`num pt-px text-sm ${m.offset === 0 ? "font-medium text-ink" : "text-muted"}`}>
                    {start ? clockAt(start, m.offset) : relativeLabel(m.offset)}
                  </span>
                  <div>
                    <p className={`text-[15px] ${m.offset === 0 ? "font-semibold" : "font-medium"}`}>{m.label}</p>
                    {m.detail && <p className="mt-0.5 text-sm text-muted">{m.detail}</p>}
                  </div>
                </div>
              </li>
            ))}
          </ol>
          {!start && <p className="mt-4 text-sm text-faint">Set the start time to see clock times.</p>}
        </section>

        <section aria-label="Warm-up" className="space-y-3">
          <h3 className="text-sm font-medium">
            Warm-up <span className="num font-normal text-muted">· {plan.warmupMinutes} min, done 10 min before the start</span>
          </h3>
          <ul className="divide-y divide-rule rounded-lg border border-line">
            {plan.warmup.map((s) => (
              <li key={s.label} className="flex items-baseline gap-3 px-3 py-2.5 text-sm">
                <span className="num w-12 flex-none text-muted">{s.minutes} min</span>
                <span className="min-w-0 flex-1">{s.label}</span>
                {s.watts && (
                  <span className="num flex-none text-muted">
                    {s.watts[0]}–{s.watts[1]} W
                  </span>
                )}
              </li>
            ))}
          </ul>
          <p className="text-sm text-muted">
            {plan.carbsPerHour
              ? `Racing: ${plan.carbsPerHour} g of carbohydrate an hour and a bottle an hour.`
              : "Too short to eat while racing: the gel before the start covers it."}
          </p>
        </section>
      </div>
    </div>
  );
}
