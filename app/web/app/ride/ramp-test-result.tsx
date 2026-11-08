"use client";

import { useState, useTransition } from "react";
import { RAMP_TEST_FACTOR, TWENTY_MINUTE_TEST_FACTOR } from "@/lib/engine/ftp";
import { button } from "@/components/ui";
import { setFtp } from "../actions";

/** After a saved ramp test or 20-minute test: the FTP it gives, set only when you confirm. */
export default function RampTestResult({
  test,
  result,
  current,
  onSet,
}: {
  test: "ramp" | "twentyMinute";
  /** FTP, and the best minute (ramp) or best 20 minutes it came from. */
  result: { watts: number; best: number };
  current: number;
  onSet: (watts: number) => void;
}) {
  const [pending, start] = useTransition();
  const [answer, setAnswer] = useState<{ ok: boolean; message: string } | null>(null);
  const percent = Math.round((test === "ramp" ? RAMP_TEST_FACTOR : TWENTY_MINUTE_TEST_FACTOR) * 100);
  const basis = test === "ramp" ? `Ramp test: best minute ${result.best} W` : `20-minute test: ${result.best} W for 20 minutes`;

  if (answer?.ok) return <p className="text-sm text-muted" role="status">{answer.message}</p>;
  if (result.watts === current) {
    return (
      <p className="num text-sm text-muted">
        {basis}, so FTP {result.watts} W ({percent}%), the same as now.
      </p>
    );
  }
  const change = result.watts - current;
  return (
    <div className="space-y-3">
      <p className="num text-sm">
        {basis}, so FTP {result.watts} W ({percent}%), {change > 0 ? "up" : "down"} {Math.abs(change)} W from{" "}
        {current} W.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <button
          className={button.smallPrimary}
          disabled={pending}
          onClick={() =>
            start(async () => {
              const saved = await setFtp(result.watts, test === "ramp" ? "rampTest" : "twentyMinute");
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
