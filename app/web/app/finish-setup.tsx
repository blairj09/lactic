"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Panel } from "@/components/ui";
import {
  FINISH_SETUP,
  FINISH_SETUP_DONE,
  LATER_STEPS,
  setupDone,
} from "@/lib/finish-setup";
import { getSetting, setSetting } from "~/settings/store";
import { TakeTourLink } from "~/tour/take-tour";

/**
 * On Today after the short first run: the rest of setup, a step at a time (each opens on its own
 * in /welcome and comes back here). Gone once every step is done, or after Hide.
 */
export default function FinishSetup({ hasRides }: { hasRides: boolean }) {
  const [state, setState] = useState<{ on: boolean; saved: string[] } | null>(
    null,
  );
  useEffect(() => {
    const load = () =>
      void Promise.all([
        getSetting(FINISH_SETUP, false),
        getSetting<string[]>(FINISH_SETUP_DONE, []),
      ]).then(([on, saved]) => setState({ on, saved }));
    load();
    const onSettings = (e: Event) => {
      const key = (e as CustomEvent<string>).detail;
      if (key === FINISH_SETUP || key === FINISH_SETUP_DONE) load();
    };
    window.addEventListener("lactic:settings", onSettings);
    return () => window.removeEventListener("lactic:settings", onSettings);
  }, []);
  if (!state?.on) return null;
  const done = setupDone(state.saved, { hasRides });
  if (done.size === LATER_STEPS.length) return null;

  return (
    <Panel
      title="Finish setting up"
      meta={`${done.size} of ${LATER_STEPS.length}`}
    >
      <ul className="divide-y divide-line">
        {LATER_STEPS.map((s) => (
          <li key={s.id}>
            <Link
              href={`/welcome/${s.id}`}
              className="flex items-center justify-between gap-4 py-2.5 text-[15px] hover:text-accent"
            >
              <span
                className={
                  done.has(s.id) ? "text-muted line-through" : undefined
                }
              >
                {s.label}
              </span>
              <span className="text-sm text-muted">
                {done.has(s.id) ? "Done" : s.until} ›
              </span>
            </Link>
          </li>
        ))}
      </ul>
      <div className="mt-3 flex items-center justify-between gap-4 text-sm text-muted">
        <TakeTourLink />
        <button
          type="button"
          className="hover:text-ink"
          onClick={() => void setSetting(FINISH_SETUP, false)}
        >
          Hide
        </button>
      </div>
    </Panel>
  );
}
