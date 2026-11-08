"use client";

import { Result, button as ui } from "@/components/ui";
import { useEffect, useState } from "react";
import { isPickerCancel, remembered } from "@/lib/ble/devices";
import { isWebBluetoothAvailable } from "@/lib/ble/sensor-hub";
import type { ScaleProfile } from "@/lib/scale/bodypod";
import { weighIn, type WeighInUpdate } from "@/lib/scale/scale";
import { saveWeighIn, type ActionResult } from "../actions";
import { weightIn, weightUnit } from "@/lib/units";
import { useUnits } from "@/lib/use-units";

export const STAGE_TEXT: Record<WeighInUpdate["stage"], string> = {
  picking: "Tap the scale with your foot to wake it, then choose your Body Pod in the list. It's remembered after this.",
  waking: "Tap the scale with your foot to wake it.",
  connecting: "Connecting...",
  waiting: "Connected. Step on the scale.",
  measuring: "Hold still...",
  analyzing: "Weight locked. Keep holding the handle while it measures body composition...",
  done: "Done.",
};

export default function WeighIn({ profile }: { profile: ScaleProfile }) {
  const units = useUnits();
  const [busy, setBusy] = useState(false);
  const [update, setUpdate] = useState<WeighInUpdate | null>(null);
  const [result, setResult] = useState<ActionResult | null>(null);
  const [scaleName, setScaleName] = useState<string | null>(null);
  useEffect(() => setScaleName(remembered("scale")?.name ?? null), []);

  const run = async (choose = false) => {
    if (!isWebBluetoothAvailable()) {
      setResult({ ok: false, message: "This browser has no Web Bluetooth. Weigh in from the Lactic app." });
      return;
    }
    setBusy(true);
    setResult(null);
    try {
      const reading = await weighIn(profile, setUpdate, { choose });
      setScaleName(remembered("scale")?.name ?? null);
      setUpdate({ stage: "done", liveKg: reading.weightKg });
      setResult(await saveWeighIn(reading));
    } catch (e) {
      // Closing the device picker isn't an error worth showing.
      if (!isPickerCancel(e)) setResult({ ok: false, message: e instanceof Error ? e.message : String(e) });
      setUpdate(null);
    }
    setBusy(false);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
        <div className="min-w-0 space-y-1">
          <h2 className="text-base font-medium">Weigh in</h2>
          <p className="text-sm text-muted">
            Barefoot, holding the handle. Close the Hume app first.
            {scaleName && !busy && (
              <>
                {" "}
                {scaleName} ·{" "}
                <button className="underline-offset-4 hover:text-ink hover:underline" onClick={() => run(true)}>
                  another scale
                </button>
              </>
            )}
          </p>
        </div>
        <button className={ui.primary} disabled={busy} onClick={() => run()}>
          {busy ? "Weighing..." : scaleName ? "Weigh in" : "Pair scale"}
        </button>
      </div>
      {update && (
        <div className="space-y-1">
          <p className="num text-5xl font-medium tracking-tight">
            {update.liveKg === null ? <span className="text-faint">–</span> : weightIn(update.liveKg, units).toFixed(1)}
            <span className="ml-1 text-base font-normal tracking-normal text-muted">{weightUnit(units)}</span>
          </p>
          <p className="text-sm text-muted" aria-live="polite">
            {STAGE_TEXT[update.stage]}
          </p>
        </div>
      )}
      {result && <Result ok={result.ok}>{result.message}</Result>}
    </div>
  );
}
