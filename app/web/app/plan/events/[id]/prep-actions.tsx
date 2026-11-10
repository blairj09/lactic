"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Result, button, input } from "@/components/ui";
import type { ActionResult } from "../../../actions";
import { updateForecast, applyCourseDuration, saveRaceTarget } from "../../course-actions";

function useRun() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [result, setResult] = useState<ActionResult | null>(null);
  const run = (work: () => Promise<ActionResult>) =>
    start(async () => {
      const r = await work();
      setResult(r);
      if (r.ok) router.refresh();
    });
  return { pending, result, run };
}

export function RefreshForecast({ goalId }: { goalId: string }) {
  const { pending, result, run } = useRun();
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <button type="button" className="text-sm text-muted underline-offset-4 hover:text-ink hover:underline" disabled={pending} onClick={() => run(() => updateForecast(goalId))}>
        {pending ? "Updating…" : "Update now"}
      </button>
      {result && !result.ok && <Result ok={false}>{result.message}</Result>}
    </span>
  );
}

export function UseCourseDuration({ goalId, minutes, label }: { goalId: string; minutes: number; label: string }) {
  const { pending, result, run } = useRun();
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <button type="button" className={button.secondary} disabled={pending} onClick={() => run(() => applyCourseDuration(goalId, minutes))}>
        {pending ? "Saving…" : `Use ${label}`}
      </button>
      {result && <Result ok={result.ok}>{result.message}</Result>}
    </span>
  );
}

const PACK_OPTIONS = [
  { value: "solo", label: "Solo" },
  { value: "group", label: "Small group (2 to 15)" },
  { value: "bunch", label: "Bunch (a peloton)" },
];

/** The event's target finish time and how it's ridden. */
export function RaceTargetForm({ goalId, target, pack, usualPack, soloOnly }: { goalId: string; target: string; pack: string; usualPack: string; soloOnly: boolean }) {
  const { pending, result, run } = useRun();
  const [time, setTime] = useState(target);
  const [how, setHow] = useState(pack);
  const usual = { solo: "solo", group: "small group", bunch: "bunch" }[usualPack] ?? "solo";
  return (
    <form
      className="flex flex-wrap items-end gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        run(() => saveRaceTarget(goalId, time, how));
      }}
    >
      <label className="grid gap-1 text-sm">
        <span className="text-muted">Target time</span>
        <input className={`${input} w-28`} value={time} onChange={(e) => setTime(e.target.value)} placeholder="4:30" inputMode="numeric" aria-label="Target finish time, hours and minutes" />
      </label>
      {!soloOnly && (
        <label className="grid gap-1 text-sm">
          <span className="text-muted">How you&apos;ll ride it</span>
          <select className={input} value={how} onChange={(e) => setHow(e.target.value)}>
            <option value="">Usual for the event ({usual})</option>
            {PACK_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
      )}
      <button type="submit" className={button.secondary} disabled={pending}>
        {pending ? "Saving…" : "Save"}
      </button>
      {result && <Result ok={result.ok}>{result.message}</Result>}
    </form>
  );
}
