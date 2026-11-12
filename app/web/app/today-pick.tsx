"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import Select from "@/components/select";
import WorkoutProfile from "@/components/workout-profile";
import { Panel, Pill, Result, button, input } from "@/components/ui";
import type { OptionId } from "@/lib/engine/checkin";
import type { ExertionToday } from "@/lib/engine/recovery-glance";
import { chooseOption } from "./plan/actions";
import { SessionLine } from "./checkin";
import { ExertionBar } from "./last-night";
import type { TodayChoice } from "./morning";

/** The Ride page's own pickers, for a workout that isn't one of today's options. */
const ELSEWHERE = [
  { value: "library", label: "From the library…" },
  { value: "custom", label: "My workouts…" },
  { value: "erg", label: "Free ride" },
] as const;

/**
 * Beside today's plan on Today: the suggested option (the brief's pick, else the engine's) ready to
 * ride, and "Something else…" for the other options, the library, your own workouts or a free ride.
 * On a day the plan already fits, it's just the menu. Every option and number comes from the engine.
 */
export default function TodayPick({
  today,
  pick,
  day,
  outside,
  ftp,
  exertion,
  eased,
}: {
  today: TodayChoice;
  /** The coach's pick in today's brief, when there is one. */
  pick: OptionId | null;
  day: string;
  /** Riding outside today: the choice locks in rather than starting a ride here. */
  outside: boolean;
  ftp: number | null;
  /** Where each option would land today's exertion. */
  exertion: Partial<Record<OptionId, ExertionToday | null>>;
  /** The plan eased today on purpose, so the exertion line doesn't call it "under target". */
  eased: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<OptionId | null>(null);
  const { options } = today;
  const suggested = pick && options.options.some((o) => o.id === pick) ? pick : options.recommended;
  const shownId = selected ?? (suggested !== today.plain ? suggested : null);
  const shown = options.options.find((o) => o.id === shownId) ?? null;

  const choose = (id: OptionId, ride: boolean) =>
    start(async () => {
      setError(null);
      const result = await chooseOption(id);
      if (!result.ok) return setError(result.message);
      if (ride) router.push(`/ride?day=${day}`);
      else router.refresh();
    });

  // Today's other options (the plan has its own card), then the Ride page's pickers.
  const others = options.options.filter((o) => o.id !== shownId && o.id !== "asPlanned");
  const menu = (
    <Select
      value=""
      aria-label="Ride something else"
      className={`${input} w-full min-w-0 flex-1 sm:w-auto`}
      disabled={pending}
      onChange={(v) => {
        if (ELSEWHERE.some((e) => e.value === v)) router.push(`/ride?day=${day}&source=${v}`);
        else setSelected(v as OptionId);
      }}
    >
      <option value="" disabled>
        {shown ? "Something else…" : "Shorter, easier, library, my workouts…"}
      </option>
      {others.length > 0 && (
        <optgroup label="Today's options">
          {others.map((o) => (
            <option key={o.id} value={o.id}>
              {o.session ? `${o.label} · ${Math.round(o.session.duration / 60)} min · ${Math.round(o.session.stress)} TSS` : o.label}
            </option>
          ))}
        </optgroup>
      )}
      <optgroup label="Or pick your own">
        {ELSEWHERE.map((e) => (
          <option key={e.value} value={e.value}>
            {e.label}
          </option>
        ))}
      </optgroup>
    </Select>
  );

  if (!shown) {
    return (
      <Panel title="Something else?" className="self-start">
        <p className="-mt-3 mb-4 text-sm text-muted">The plan fits today. Ride a different one if you&apos;d like.</p>
        <div className="flex">{menu}</div>
        {error && <Result ok={false}>{error}</Result>}
      </Panel>
    );
  }

  const isSuggestion = shown.id === suggested;
  const landing = exertion[shown.id] ?? null;
  return (
    <Panel
      title={
        <span className="flex flex-col gap-1">
          <span>{isSuggestion ? <Pill tone="positive">Suggested</Pill> : <Pill>Your pick</Pill>}</span>
          <span className="text-xl font-semibold tracking-tight">{shown.label}</span>
        </span>
      }
      meta={isSuggestion && options.reasons[0] ? options.reasons[0] : undefined}
      className="flex flex-col border-accent/40"
    >
      <div className="flex flex-1 flex-col gap-3">
        <SessionLine session={shown.session} />
        {shown.session && <WorkoutProfile workout={shown.session.workout} height={88} details ftp={ftp} fit />}
        {landing && (landing.soFar !== null || landing.target) && <ExertionBar exertion={landing} eased={eased} compact />}
        <div className="mt-auto flex flex-wrap items-center gap-3 pt-1">
          {shown.session ? (
            <button type="button" className={button.primary} disabled={pending} onClick={() => choose(shown.id, !outside)}>
              {outside ? "Ride this outside" : "Start ride"}
            </button>
          ) : (
            <button type="button" className={button.primary} disabled={pending} onClick={() => choose(shown.id, false)}>
              Take the day off
            </button>
          )}
          {menu}
        </div>
        {error && <Result ok={false}>{error}</Result>}
      </div>
    </Panel>
  );
}
