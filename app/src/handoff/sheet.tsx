// "From your test drive": a lactic.fit test drive opened in a Lactic that's already set up. The rider
// picks which FTP to keep and whether the ride goes into their history.

import { useEffect, useState } from "react";
import { button, Result } from "@/components/ui";
import { formatTime } from "@/lib/format";
import { createClient } from "~/db/supabase-client";
import { revalidatePath } from "~/shims/next-cache";
import { applyTestDrive, clearTestDrive, watchTestDrive, type TestDrive } from "./handoff";

const TESTS: Record<TestDrive["method"], string> = {
  rampTest: "Your ramp test on lactic.fit",
  twentyMinute: "Your 20-minute test on lactic.fit",
  manual: "Your test drive on lactic.fit",
};

/** The hint under a prefilled FTP on the first run. */
export const testDriveHint = (t: TestDrive) =>
  t.method === "manual" ? "The FTP you rode your test drive at. Change it if you know better." : `${TESTS[t.method]}. Change it if you know better.`;

/** The test drive ride, with a tick for adding it to the rider's rides. */
export function TestDriveRide({ drive, checked, onChange }: { drive: TestDrive; checked: boolean; onChange: (on: boolean) => void }) {
  if (!drive.ride) return null;
  const started = new Date(drive.ride.startedAt);
  const day = started.toDateString() === new Date().toDateString() ? "Today" : started.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  return (
    <label className="flex cursor-pointer items-center gap-3 rounded-lg border border-line bg-surface px-4 py-3">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="min-w-0">
        <span className="block truncate font-medium">{drive.ride.name}</span>
        <span className="num block text-sm text-muted">
          {day} · {formatTime(drive.ride.summary.durationSeconds)}
        </span>
      </span>
    </label>
  );
}

export function HandoffSheet() {
  const [drive, setDrive] = useState<TestDrive | null>(null);
  const [current, setCurrent] = useState<number | null>(null);
  const [useIt, setUseIt] = useState(true);
  const [addRide, setAddRide] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(
    () =>
      watchTestDrive((t) => {
        void createClient()
          .from("athlete_settings")
          .select("ftp_watts")
          .maybeSingle()
          .then(({ data }) => {
            const ftp = (data as { ftp_watts?: number | null } | null)?.ftp_watts ?? null;
            // Nothing to ask: the same FTP and no ride.
            if (ftp === t.ftp && !t.ride) return clearTestDrive();
            setCurrent(ftp);
            // A test on the test drive sets FTP; a ride at a typed-in FTP keeps the one Lactic has.
            setUseIt(t.method !== "manual");
            setAddRide(Boolean(t.ride));
            setError(null);
            setDrive(t);
          });
      }),
    [],
  );

  if (!drive) return null;
  const same = current === drive.ftp;
  const close = () => {
    clearTestDrive();
    setDrive(null);
  };
  const done = async () => {
    setBusy(true);
    const r = await applyTestDrive(drive, { useFtp: useIt && !same, addRide }).catch((e) => ({ ok: false, message: e instanceof Error ? e.message : String(e) }));
    setBusy(false);
    if (!r.ok) return setError(r.message);
    revalidatePath("/");
    setDrive(null);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 px-2 pt-16 pb-8 sm:px-6" onClick={(e) => e.target === e.currentTarget && !busy && close()}>
      <div role="dialog" aria-modal="true" aria-labelledby="handoff-title" className="w-full max-w-md space-y-4 rounded-xl border border-line bg-ground p-6 shadow-2xl">
        <div className="space-y-1">
          <h2 id="handoff-title" className="text-xl font-semibold tracking-tight">
            From your test drive
          </h2>
          <p className="text-muted">
            {TESTS[drive.method]} {drive.method === "manual" ? "was ridden at" : "set your FTP to"} {drive.ftp} W.
            {current !== null && !same && ` Lactic has ${current} W.`}
          </p>
        </div>
        {current !== null && !same && (
          <div className="space-y-2">
            <Choice on={useIt} onPick={() => setUseIt(true)} label="Use the test drive" watts={drive.ftp} />
            <Choice on={!useIt} onPick={() => setUseIt(false)} label="Keep what I have" watts={current} />
          </div>
        )}
        {drive.ride && (
          <div className="space-y-1.5">
            <p className="text-sm font-medium">Add the ride to my history</p>
            <TestDriveRide drive={drive} checked={addRide} onChange={setAddRide} />
          </div>
        )}
        {error && <Result ok={false}>{error}</Result>}
        <div className="flex items-center justify-end gap-3 pt-2">
          <button type="button" className={button.ghost} disabled={busy} onClick={close}>
            Cancel
          </button>
          <button type="button" className={button.primary} disabled={busy} onClick={() => void done()}>
            {busy ? "Saving…" : "Done"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Choice({ on, onPick, label, watts }: { on: boolean; onPick: () => void; label: string; watts: number }) {
  return (
    <label className={`flex cursor-pointer items-center gap-3 rounded-lg border bg-surface px-4 py-3 ${on ? "border-accent" : "border-line"}`}>
      <input type="radio" checked={on} onChange={onPick} />
      <span className="flex-1">{label}</span>
      <span className="num font-medium">{watts} W</span>
    </label>
  );
}
