// First-run "Sleep and recovery" on an iPhone used on its own: one button for Apple Health, which
// covers Apple Watch and the rings and apps that write to Health. Garmin and other watches that
// don't come in through intervals.icu instead, so that's the second way in.

import { useEffect, useState } from "react";
import { button, Pill, Result } from "@/components/ui";
import { IntervalsConnect } from "~/setup/rides";
import { connectHealth, syncPhoneHealth } from "./health";
import { phoneStatus, type PhoneStatus } from "./plugin";

export function PhoneSleepSetup() {
  const [status, setStatus] = useState<PhoneStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [watch, setWatch] = useState(false);
  const refresh = () => void phoneStatus().then(setStatus).catch(() => {});
  useEffect(refresh, []);

  async function connect() {
    setBusy(true);
    setResult(null);
    try {
      await connectHealth();
      const latest = await syncPhoneHealth();
      setResult({ ok: true, message: latest ? `Connected. Latest night ${latest}.` : "Connected. Your first score comes after tonight's sleep." });
    } catch (e) {
      setResult({ ok: false, message: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
      refresh();
    }
  }

  if (!status) return null;
  const connected = status.healthAsked;
  return (
    <div className="space-y-4">
      <div className="space-y-3 rounded-lg border border-line p-4">
        <div className="flex items-center justify-between gap-3">
          <p className="font-medium">Apple Health</p>
          {connected && <Pill tone="positive">Connected</Pill>}
        </div>
        <p className="text-sm text-muted">Sleep, HRV and resting heart rate from your Apple Watch, or any ring or app that saves to Health. New nights come in on their own.</p>
        {!status.healthAvailable ? (
          <p className="text-sm text-muted">Apple Health isn&apos;t available on this device.</p>
        ) : !connected ? (
          <button type="button" className={`${button.primary} h-11 w-full text-base`} disabled={busy} onClick={() => void connect()}>
            {busy ? "Connecting…" : "Connect Apple Health"}
          </button>
        ) : null}
        {result && <Result ok={result.ok}>{result.message}</Result>}
      </div>
      {watch ? (
        <div className="space-y-3 rounded-lg border border-line p-4">
          <p className="font-medium">Garmin, Oura, WHOOP and others</p>
          <p className="text-sm text-muted">Link your watch or ring to intervals.icu (free), then connect intervals.icu here. Your rides come in the same way.</p>
          <IntervalsConnect heading={false} />
        </div>
      ) : (
        <button type="button" className="text-sm text-muted underline underline-offset-4" onClick={() => setWatch(true)}>
          Use a Garmin, Oura or WHOOP instead
        </button>
      )}
      <p className="text-sm text-muted">No time now? Skip it and connect later in Settings → Apple Health.</p>
    </div>
  );
}
