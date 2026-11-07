"use client";

import { useState, useTransition } from "react";
import { RAMP_TEST_FACTOR } from "@/lib/engine/ftp";
import { button } from "@/components/ui";
import { setFtp } from "../actions";

/** After a saved ramp test: the FTP it gives, set only when you confirm. */
export default function RampTestResult({
  result,
  current,
  onSet,
}: {
  result: { watts: number; bestMinute: number };
  current: number;
  onSet: (watts: number) => void;
}) {
  const [pending, start] = useTransition();
  const [answer, setAnswer] = useState<{ ok: boolean; message: string } | null>(null);
  const percent = Math.round(RAMP_TEST_FACTOR * 100);

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
