"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { RAMP_TEST_FACTOR } from "@/lib/engine/ftp";
import { button } from "@/components/ui";
import { setFtp, undoFtp } from "../actions";

/**
 * After a saved ramp test: the FTP it gives. Set only when you confirm, unless FTP is still setup's guess:
 * then the test is the first real number, so it's set straight away, with Undo.
 */
export default function RampTestResult({
  result,
  current: currentNow,
  guess: guessNow = false,
  onSet,
}: {
  result: { watts: number; bestMinute: number };
  current: number;
  guess?: boolean;
  onSet: (watts: number) => void;
}) {
  // As they were when the test was saved: setting FTP refreshes the page behind this.
  const [guess] = useState(guessNow);
  const [current] = useState(currentNow);
  const [pending, start] = useTransition();
  const [answer, setAnswer] = useState<{ ok: boolean; message: string } | null>(null);
  const [applied, setApplied] = useState(false);
  const applying = useRef(false);
  const percent = Math.round(RAMP_TEST_FACTOR * 100);

  // A guessed FTP: the test sets it (even when it matches the guess, so FTP counts as tested from here on).
  useEffect(() => {
    if (!guess || applying.current) return;
    applying.current = true;
    start(async () => {
      const saved = await setFtp(result.watts, "rampTest");
      if (saved.ok) {
        setApplied(true);
        onSet(result.watts);
      } else setAnswer(saved);
    });
  }, [guess, result.watts, onSet]);

  if (guess) {
    if (answer) return <p className={`text-sm ${answer.ok ? "text-muted" : "text-negative"}`} role="status">{answer.message}</p>;
    if (!applied) return <p className="text-sm text-muted" role="status">Setting your FTP from this test...</p>;
    return (
      <div className="space-y-2" role="status">
        <p className="num text-sm">
          Your FTP is now {result.watts} W: {percent}% of your best minute, {result.bestMinute} W. Lactic started from a guess of {current} W, and your
          workouts now follow the real number.
        </p>
        <button
          className={button.small}
          disabled={pending}
          onClick={() =>
            start(async () => {
              const back = await undoFtp(current);
              if (back.ok) onSet(current);
              setAnswer(back.ok ? { ok: true, message: `FTP back to ${current} W.` } : back);
            })
          }
        >
          Undo
        </button>
      </div>
    );
  }

  if (answer?.ok) return <p className="text-sm text-muted" role="status">{answer.message}</p>;
  if (result.watts === current) {
    return (
      <p className="num text-sm text-muted">
        Ramp test: best minute {result.bestMinute} W, so FTP {result.watts} W ({percent}%), the same as now.
      </p>
    );
  }
  const change = result.watts - current;
  return (
    <div className="space-y-3">
      <p className="num text-sm">
        Ramp test: best minute {result.bestMinute} W, so FTP {result.watts} W ({percent}%), {change > 0 ? "up" : "down"} {Math.abs(change)} W from{" "}
        {current} W.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <button
          className={button.smallPrimary}
          disabled={pending}
          onClick={() =>
            start(async () => {
              const saved = await setFtp(result.watts, "rampTest");
              setAnswer(saved);
              if (saved.ok) onSet(result.watts);
            })
          }
        >
          {pending ? "Saving..." : `Set FTP to ${result.watts} W`}
        </button>
        <button className={button.small} disabled={pending} onClick={() => setAnswer({ ok: true, message: `FTP stays at ${current} W.` })}>
          Keep {current} W
        </button>
      </div>
      {answer && !answer.ok && <p className="text-sm text-negative">{answer.message}</p>}
    </div>
  );
}
