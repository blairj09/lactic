"use client";

import { useState, useTransition } from "react";
import { button } from "@/components/ui";
import type { FtpCheck } from "@/lib/engine/ftp-check";
import { scheduleRampTest, setFtp, undoFtp } from "./actions";

/**
 * Today's FTP banner: rides say FTP is higher (apply it, with Undo straight after), or the last test is
 * getting old (put a ramp test on the next good day). The numbers come from the engine (ftp-check.ts).
 */
export default function FtpBanner({ ftp, check, windowDays }: { ftp: number; check: FtpCheck; windowDays: number }) {
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const { higher, stale, applied } = check;
  if (!higher && !stale && !applied && !message) return null;

  return (
    <section aria-label="FTP" className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-lg border border-line bg-surface px-4 py-3 text-sm">
      {applied ? (
        <>
          <p>
            FTP set to <span className="num font-medium">{applied.watts} W</span> from today, from your recent rides. Zones and stress use it now.
          </p>
          {applied.previous !== null && (
            <button className={button.small} disabled={pending} onClick={() => start(async () => setMessage((await undoFtp(applied.previous!)).message))}>
              {pending ? "Undoing..." : `Undo, back to ${applied.previous} W`}
            </button>
          )}
        </>
      ) : higher ? (
        <>
          <p>
            <span className="font-medium">Your FTP looks higher:</span> about <span className="num font-medium">{higher.watts} W</span>, up{" "}
            <span className="num">{higher.gain} W</span> on your {ftp} W, from your best efforts in the last {windowDays} days
            {higher.method === "twentyMinute" ? " (95% of your best 20 minutes)" : ""}.
            {message && <span role="status" className="text-muted"> {message}</span>}
          </p>
          <button className={button.small} disabled={pending} onClick={() => start(async () => setMessage((await setFtp(higher.watts, higher.method)).message))}>
            {pending ? "Saving..." : `Use ${higher.watts} W`}
          </button>
        </>
      ) : stale ? (
        <>
          <p>
            <span className="font-medium">Time for an FTP test?</span>{" "}
            {stale.days === null ? "There's no test on record yet" : `Your last test was ${Math.round(stale.days / 7)} weeks ago`}, so your zones may be off. A ramp
            test takes about 25 minutes.
            {message && <span role="status" className="text-muted"> {message}</span>}
          </p>
          <button className={button.small} disabled={pending || Boolean(message)} onClick={() => start(async () => setMessage((await scheduleRampTest()).message))}>
            {pending ? "Planning..." : "Schedule a ramp test"}
          </button>
        </>
      ) : (
        <p role="status">{message}</p>
      )}
    </section>
  );
}
