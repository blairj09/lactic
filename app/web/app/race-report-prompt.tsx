"use client";

import Link from "next/link";
import { useState } from "react";
import { button } from "@/components/ui";
import { ExperimentalTag } from "@/components/experimental-tag";
import { GOAL_KIND_LABELS } from "@/lib/engine/plan";
import type { RaceFollowUp } from "@/lib/engine/race/followup";
import { RACE_PROMPTS_SETTING } from "@/lib/race-glance";
import { getSetting, setSetting } from "~/settings/store";

/**
 * On Today in the week after an event, once its ride is in: a pointer to the race's report, which
 * opens with the event and ride filled in and the automatic comparisons ready. Gone once the report
 * is opened, or after Not now.
 */
export default function RaceReportPrompt({ followUp }: { followUp: RaceFollowUp & { rideName: string | null } }) {
  const [hidden, setHidden] = useState(false);
  if (hidden) return null;
  const { goal, rideId, daysAgo } = followUp;
  const when = daysAgo === 0 ? "today" : daysAgo === 1 ? "yesterday" : `${daysAgo} days ago`;
  const dismiss = async () => {
    setHidden(true);
    try {
      const saved = await getSetting<{ dismissed?: string[] }>(RACE_PROMPTS_SETTING, {});
      await setSetting(RACE_PROMPTS_SETTING, { ...saved, dismissed: [...(saved.dismissed ?? []), rideId].slice(-50) });
    } catch (e) {
      console.error(e);
    }
  };

  return (
    <section aria-label="Race report" className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 rounded-lg border border-accent/40 bg-accent/5 p-4 sm:p-5">
      <div className="min-w-0 space-y-1">
        <h2 className="flex flex-wrap items-center gap-2 text-base font-medium">
          How did {goal.name} go?
          <ExperimentalTag />
        </h2>
        <p className="text-sm text-muted">
          Your {GOAL_KIND_LABELS[goal.kind].toLowerCase()} {when} is in. Its race report already has your peak power against your bests, your earlier rides of the course and, once you add the results, where you placed.
        </p>
      </div>
      <div className="flex flex-none items-center gap-3">
        <button type="button" className={button.ghost} onClick={dismiss}>
          Not now
        </button>
        <Link href={`/rides/${rideId}/race`} className={button.primary}>
          Open the race report
        </Link>
      </div>
    </section>
  );
}
