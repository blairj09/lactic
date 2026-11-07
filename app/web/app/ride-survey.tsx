"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { DIFFICULTIES, DIFFICULTY_LABELS, RPE_LABELS, type Difficulty } from "@/lib/engine/feedback";
import type { Session } from "@/lib/engine/library";
import { Segmented, button, input } from "@/components/ui";
import { saveRideFeedback } from "./ride-feedback";
import { AutoTextarea } from "@/components/auto-textarea";

const SKIPPED = "survey.skipped";

function skippedRides(): string[] {
  try {
    return JSON.parse(localStorage.getItem(SKIPPED) ?? "[]");
  } catch {
    return [];
  }
}

function skipRide(id: string) {
  try {
    localStorage.setItem(SKIPPED, JSON.stringify([id, ...skippedRides()].slice(0, 30)));
  } catch {}
}

/**
 * After a ride: was it the right difficulty, how hard (RPE), and a note. Only the first answer is
 * needed; Skip hides it. Moves progression levels and the next check-in, and the coach reads it.
 */
export default function RideSurvey({
  ride,
  name,
  session,
  onDone,
}: {
  /** A stored ride's id, or the start time of a ride just saved on the Ride page. */
  ride: { id: string } | { appStartedAt: string };
  name: string;
  /** The library workout ridden, when it wasn't the plan's session. */
  session?: Pick<Session, "zone" | "level" | "duration" | "stress"> | null;
  onDone?: () => void;
}) {
  const router = useRouter();
  const key = "id" in ride ? ride.id : ride.appStartedAt;
  const [difficulty, setDifficulty] = useState<Difficulty | null>(null);
  const [rpe, setRpe] = useState<number | null>(null);
  const [note, setNote] = useState("");
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [hidden, setHidden] = useState(false);
  const [pending, start] = useTransition();

  useEffect(() => {
    if (skippedRides().includes(key)) setHidden(true);
  }, [key]);

  if (hidden) return null;
  if (result?.ok) return <p className="text-sm text-muted">{result.message}</p>;

  const submit = () =>
    start(async () => {
      if (!difficulty) return;
      const saved = await saveRideFeedback({ ...("id" in ride ? { rideId: ride.id } : { appStartedAt: ride.appStartedAt }), difficulty, rpe, note, session });
      setResult(saved);
      if (saved.ok) {
        onDone?.();
        router.refresh();
      }
    });

  const skip = () => {
    skipRide(key);
    setHidden(true);
    onDone?.();
  };

  return (
    <div className="space-y-4">
      <p className="text-sm font-medium">How was {name}?</p>
      <Segmented
        label="Difficulty"
        options={DIFFICULTIES.map((d) => ({ value: d, label: DIFFICULTY_LABELS[d] }))}
        value={difficulty}
        onChange={setDifficulty}
        disabled={pending}
        wrap
      />
      {difficulty && (
        <>
          <div className="space-y-2">
            <p className="text-sm text-muted">
              Effort, 1 to 10 (optional){rpe !== null && <span className="text-ink">: {RPE_LABELS[rpe]}</span>}
            </p>
            <Segmented
              label="Effort"
              options={Array.from({ length: 10 }, (_, i) => ({ value: i + 1, label: <span className="num">{i + 1}</span> }))}
              value={rpe}
              onChange={(v) => setRpe(v === rpe ? null : v)}
              disabled={pending}
            />
          </div>
          <AutoTextarea
            rows={1}
            className={`${input} h-auto w-full py-2`}
            placeholder="Anything to add? (optional)"
            value={note}
            maxLength={1000}
            onChange={(e) => setNote(e.target.value)}
            disabled={pending}
            aria-label="Note"
          />
        </>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <button className={button.smallPrimary} disabled={!difficulty || pending} onClick={submit}>
          {pending ? "Saving..." : "Save"}
        </button>
        <button className={button.ghost} disabled={pending} onClick={skip}>
          Skip
        </button>
      </div>
      {result && !result.ok && (
        <p className="text-sm text-negative" role="alert">
          {result.message}
        </p>
      )}
    </div>
  );
}
