"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Panel } from "@/components/ui";
import {
  FINISH_SETUP,
  FINISH_SETUP_DONE,
  laterSteps,
  setupDone,
} from "@/lib/finish-setup";
import { invoke, isDesktop, isPhone, listen } from "~/platform/native";
import { getSetting, setSetting } from "~/settings/store";
import { TakeTourLink } from "~/tour/take-tour";

/**
 * On Today after the short first run: the rest of setup, a step at a time (each opens on its own
 * in /welcome and comes back here). Gone once every step is done, or after Hide.
 */
/** The desktop app on a computer, where a phone pairs (not the phone app, not a browser). */
const computer = isDesktop && !isPhone();

export default function FinishSetup({ hasRides }: { hasRides: boolean }) {
  const [state, setState] = useState<{ on: boolean; saved: string[] } | null>(
    null,
  );
  const [phonePaired, setPhonePaired] = useState(false);
  useEffect(() => {
    if (!computer) return;
    const check = () =>
      void invoke<{ devices: unknown[] }>("phone_status")
        .then((s) => setPhonePaired(s.devices.length > 0))
        .catch(() => {});
    check();
    const stop = listen("phone:paired", check);
    return () => void stop.then((s) => s());
  }, []);
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
  const steps = laterSteps(computer);
  const done = setupDone(state.saved, { hasRides, phonePaired });
  if (steps.every((s) => done.has(s.id))) return null;
  const count = steps.filter((s) => done.has(s.id)).length;

  return (
    <Panel
      title="Finish setting up"
      meta={`${count} of ${steps.length}`}
    >
      <ul className="divide-y divide-line">
        {steps.map((s) => (
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
