"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import WorkoutProfile from "@/components/workout-profile";
import { FEEL_LABELS, type CheckinResult, type Feel, type OptionId } from "@/lib/engine/checkin";
import { ZONE_LABELS, type Session } from "@/lib/engine/library";
import { Pill, Result, Segmented, button, input } from "@/components/ui";
import { chooseOption, saveCheckin } from "./plan/actions";
import { AutoTextarea } from "@/components/auto-textarea";

export interface CheckinAnswers {
  feel: number;
  sick: boolean;
  minutes: number | null;
  notes: string;
}

/**
 * How you feel this morning, as a step of the morning routine: saved, it rewrites the brief and
 * today's options. Once given it folds to one line you can change.
 */
export function FeelStep({ answers, plannedMinutes, coachEnabled }: { answers: CheckinAnswers | null; plannedMinutes: number | null; coachEnabled: boolean }) {
  const router = useRouter();
  const [editing, setEditing] = useState(!answers);
  const [feel, setFeel] = useState<Feel | null>((answers?.feel as Feel) ?? null);
  const [minutes, setMinutes] = useState(answers?.minutes ? String(answers.minutes) : "");
  const [sick, setSick] = useState(answers?.sick ?? false);
  const [notes, setNotes] = useState(answers?.notes ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const submit = () =>
    start(async () => {
      setError(null);
      const result = await saveCheckin({ feel: feel ?? 3, sick, minutes: minutes ? Number(minutes) : null, notes });
      if (!result.ok) return setError(result.message);
      setEditing(false);
      router.refresh();
    });

  if (answers && !editing) {
    return (
      <p>
        {summary(answers)}{" "}
        <button type="button" onClick={() => setEditing(true)} className="text-ink underline-offset-4 hover:underline">
          Change
        </button>
      </p>
    );
  }
  return (
    <div className="space-y-3">
      <Segmented fill label="How do you feel?" options={([1, 2, 3, 4, 5] as Feel[]).map((f) => ({ value: f, label: FEEL_LABELS[f] }))} value={feel} onChange={setFeel} />
      {feel !== null && (
        <>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
            <label className="flex items-center gap-2">
              Time
              <input
                type="number"
                min={20}
                max={360}
                step={5}
                placeholder={plannedMinutes ? String(plannedMinutes) : "min"}
                value={minutes}
                onChange={(e) => setMinutes(e.target.value)}
                className={`${input} num h-8 w-20`}
              />
              min
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={sick} onChange={(e) => setSick(e.target.checked)} className="size-4 accent-[var(--ink)]" />
              Feeling ill
            </label>
          </div>
          {coachEnabled && (
            <AutoTextarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              maxLength={1000}
              rows={2}
              placeholder="Anything else? Legs heavy, slept badly, big day at work..."
              className={`${input} h-auto w-full py-2`}
            />
          )}
          <div className="flex items-center gap-3">
            <button className={button.smallPrimary} disabled={pending} onClick={submit}>
              {pending ? "Saving..." : coachEnabled ? "Tell the coach" : "Save"}
            </button>
            {answers && (
              <button type="button" className="text-muted underline-offset-4 hover:text-ink hover:underline" onClick={() => setEditing(false)}>
                Cancel
              </button>
            )}
          </div>
        </>
      )}
      {error && <Result ok={false}>{error}</Result>}
    </div>
  );
}

function summary(a: CheckinAnswers) {
  const parts = [`Feeling ${FEEL_LABELS[a.feel as Feel]?.toLowerCase() ?? a.feel}`, a.sick && "ill", a.minutes && `${a.minutes} min`].filter(Boolean);
  return `${parts.join(", ")}.${a.notes ? ` "${a.notes}"` : ""}`;
}

/**
 * Today's options from the engine, with the suggested one first and the rest a click away.
 * Choosing one locks it in as today's session.
 */
export function TodayOptions({ result, pick, reasons }: { result: CheckinResult; pick: OptionId; reasons: boolean }) {
  const router = useRouter();
  const [more, setMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const suggested = result.options.find((o) => o.id === pick) ?? result.options[0];
  const others = result.options.filter((o) => o !== suggested);

  const choose = (id: OptionId) =>
    start(async () => {
      setError(null);
      const response = await chooseOption(id);
      if (!response.ok) return setError(response.message);
      router.refresh();
    });

  const row = (o: (typeof result.options)[number], main: boolean) => (
    <li key={o.id} className={`flex items-center gap-4 p-3 ${main ? "bg-raised" : ""}`}>
      <div className="min-w-0 flex-1 space-y-1.5">
        <div className="flex items-center gap-2 text-sm">
          <span className="font-medium">{o.label}</span>
          {main && <Pill tone="positive">Suggested</Pill>}
        </div>
        <SessionLine session={o.session} />
        {o.session && <WorkoutProfile workout={o.session.workout} height={24} />}
      </div>
      <button className={main ? button.smallPrimary : button.small} disabled={pending} onClick={() => choose(o.id)}>
        Choose
      </button>
    </li>
  );

  return (
    <div className="space-y-2">
      {reasons && result.reasons.length > 0 && <p className="text-sm text-muted">{result.reasons.join(" · ")}</p>}
      <ul className="divide-y divide-rule overflow-hidden rounded-lg border border-line">
        {row(suggested, true)}
        {more && others.map((o) => row(o, false))}
      </ul>
      {others.length > 0 && (
        <button type="button" className="text-sm text-muted underline-offset-4 hover:text-ink hover:underline" onClick={() => setMore(!more)}>
          {more ? "Fewer options" : `${others.length} other option${others.length === 1 ? "" : "s"}`}
        </button>
      )}
      {error && <Result ok={false}>{error}</Result>}
    </div>
  );
}

export function SessionLine({ session }: { session: Session | null }) {
  if (!session) return <p className="text-sm text-muted">Rest</p>;
  const level = session.zone === "endurance" || session.zone === "recovery" ? "" : ` · ${ZONE_LABELS[session.zone]} level ${session.level}`;
  return (
    <p className="num text-sm text-muted">
      {session.workout.name}
      {!session.workout.name.includes(`${Math.round(session.duration / 60)} min`) && ` · ${Math.round(session.duration / 60)} min`} · {Math.round(session.stress)} TSS{level}
    </p>
  );
}

/** Today's chosen session, ready to ride. */
export function ChosenSession({ session, day, ftp, action }: { session: Session | null; day: string; ftp?: number | null; action?: React.ReactNode }) {
  return (
    <div className="space-y-4">
      <SessionLine session={session} />
      {session && (
        <>
          <WorkoutProfile workout={session.workout} height={88} details ftp={ftp} />
          {action ?? (
            <Link href={`/ride?day=${day}`} className={button.primary}>
              Start ride
            </Link>
          )}
        </>
      )}
    </div>
  );
}
