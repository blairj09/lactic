"use client";

// Today, for riders whose history hasn't come in: the offer to bring past rides, and while the
// intervals.icu history is still arriving, a line that says so.

import { useState } from "react";
import { button } from "@/components/ui";
import { BringRidesButton } from "~/setup/bring-rides";
import { setSetting } from "~/settings/store";

/** Set when the rider says "Not now" to bringing in past rides. */
export const HISTORY_OFFER_DISMISSED = "history.offer.dismissed";

export function HistoryOffer() {
  const [gone, setGone] = useState(false);
  if (gone) return null;
  return (
    <section aria-label="Your past rides" className="space-y-2 rounded-lg border border-line bg-surface p-4">
      <h2 className="font-medium">Rides before Lactic?</h2>
      <p className="text-sm text-muted">
        Bring your past rides in and your fitness, FTP and plan start from where you are. Zwift, Garmin, Wahoo, Strava and intervals.icu all work.
      </p>
      <div className="flex flex-wrap items-center gap-4">
        <BringRidesButton />
        <button
          type="button"
          className={button.ghost}
          onClick={() => {
            setGone(true);
            void setSetting(HISTORY_OFFER_DISMISSED, true);
          }}
        >
          Not now
        </button>
      </div>
    </section>
  );
}

export function HistoryImporting({ rides }: { rides: number }) {
  return (
    <p role="status" className="rounded-lg bg-accent-soft px-4 py-2.5 text-sm">
      <span className="font-medium">Bringing in your history from intervals.icu</span>
      <span className="text-muted">
        {" "}
        · <span className="num">{rides}</span> ride{rides === 1 ? "" : "s"} so far. Your fitness and plan update as they land.
      </span>
    </p>
  );
}
