"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Result, button } from "@/components/ui";
import type { ActionResult } from "../../../actions";
import { updateForecast, applyCourseDuration } from "../../course-actions";

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
