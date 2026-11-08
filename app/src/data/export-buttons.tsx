// Export buttons: one ride's FIT file on its page, everything in Settings → Your data.

import { useState } from "react";
import { button, Result } from "@/components/ui";
import { exportEverything, rideFit, saveBytes } from "./export";

type Outcome = { ok: boolean; message: string } | null;
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function ExportRideButton({ id }: { id: string }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Outcome>(null);
  async function go() {
    setBusy(true);
    setResult(null);
    try {
      const file = await rideFit(id);
      if (!file) return setResult({ ok: false, message: "This ride has no recorded samples to export." });
      const to = await saveBytes(file.name, file.bytes, { name: "FIT file", extensions: ["fit"] });
      if (to) setResult({ ok: true, message: "Saved." });
    } catch (e) {
      setResult({ ok: false, message: message(e) });
    } finally {
      setBusy(false);
    }
  }
  return (
    <span className="flex items-center gap-2">
      {result && <Result ok={result.ok}>{result.message}</Result>}
      <button type="button" className={button.small} disabled={busy} onClick={() => void go()} title="A FIT file for Garmin Connect, Strava, TrainingPeaks and other apps">
        {busy ? "Saving…" : "Export FIT"}
      </button>
    </span>
  );
}

export function ExportEverythingButton() {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Outcome>(null);
  async function go() {
    setBusy(true);
    setResult(null);
    try {
      const zip = await exportEverything();
      const to = await saveBytes(`Lactic export ${new Date().toISOString().slice(0, 10)}.zip`, zip, { name: "Zip archive", extensions: ["zip"] });
      if (to) setResult({ ok: true, message: `Saved to ${to}.` });
    } catch (e) {
      setResult({ ok: false, message: message(e) });
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <button type="button" className={button.small} disabled={busy} onClick={() => void go()}>
        {busy ? "Exporting…" : "Export everything…"}
      </button>
      {result && <Result ok={result.ok}>{result.message}</Result>}
    </>
  );
}
