"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Result, button, input } from "@/components/ui";
import type { ActionResult } from "../../../actions";
import { updateForecast, applyCourseDuration, saveRaceTarget, setHomeElevation, measureDrag } from "../../course-actions";
import { openExternal } from "~/platform/native";

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

/** Where the rider lives and trains, for the altitude's cost to power. */
export function HomeElevationForm({ imperial, current }: { imperial: boolean; current: number | null }) {
  const { pending, result, run } = useRun();
  const [value, setValue] = useState(current === null ? "" : String(Math.round(imperial ? current * 3.28084 : current)));
  return (
    <form
      className="flex flex-wrap items-end gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        const n = Number(value.replace(/,/g, ""));
        run(() => setHomeElevation(imperial ? n / 3.28084 : n));
      }}
    >
      <label className="grid gap-1 text-sm">
        <span className="text-muted">Where you live and train ({imperial ? "ft" : "m"} above sea level)</span>
        <input className={`${input} w-36`} value={value} onChange={(e) => setValue(e.target.value)} inputMode="numeric" placeholder={imperial ? "4500" : "1400"} />
      </label>
      <button type="submit" className={button.secondary} disabled={pending || !value.trim()}>
        {pending ? "Saving…" : "Save"}
      </button>
      {result && <Result ok={result.ok}>{result.message}</Result>}
    </form>
  );
}

/** The science page on lactic.fit. */
export function ScienceLink() {
  return (
    <button type="button" className="text-xs text-muted underline-offset-4 hover:text-ink hover:underline" onClick={() => void openExternal("https://lactic.fit/science")}>
      How these numbers are worked out
    </button>
  );
}

/** Measures the rider's drag from their outdoor rides (it downloads a few files, so it takes a moment). */
export function MeasureDrag({ again }: { again: boolean }) {
  const { pending, result, run } = useRun();
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <button type="button" className={button.secondary} disabled={pending} onClick={() => run(() => measureDrag())}>
        {pending ? "Reading your rides…" : again ? "Measure again" : "Measure from my rides"}
      </button>
      {result && <Result ok={result.ok}>{result.message}</Result>}
    </span>
  );
}
