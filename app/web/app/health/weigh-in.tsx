"use client";

import { Result, button as ui } from "@/components/ui";
import { useEffect, useState } from "react";
import { isPickerCancel, remembered } from "@/lib/ble/devices";
import { isWebBluetoothAvailable } from "@/lib/ble/sensor-hub";
import type { ScaleProfile } from "@/lib/scale/bodypod";
import { identifyScale, SCALE_FAMILIES } from "@/lib/scale/models";
import { weighIn, type WeighInUpdate } from "@/lib/scale/scale";
import { saveWeighIn, type ActionResult } from "../actions";
import { weightIn, weightUnit } from "@/lib/units";
import { useUnits } from "@/lib/use-units";

export const STAGE_TEXT: Record<WeighInUpdate["stage"], string> = {
  picking: "Step on or tap the scale to wake it, then choose it in the list. It's remembered after this.",
  waking: "Step on or tap the scale to wake it.",
  connecting: "Connecting...",
  waiting: "Ready. Step on the scale.",
  measuring: "Hold still...",
  analyzing: "Weight locked. Stay on while it measures body composition...",
  done: "Done.",
};

/** The remembered scale and what to do before stepping on it. */
function rememberedScale() {
  const saved = remembered("scale");
  if (!saved) return null;
  const family = identifyScale({ name: saved.deviceName });
  return { name: saved.name, hint: family ? SCALE_FAMILIES[family].hint : "Barefoot for body composition." };
}

export default function WeighIn({ profile }: { profile: ScaleProfile | null }) {
  const units = useUnits();
  const [busy, setBusy] = useState(false);
  const [update, setUpdate] = useState<WeighInUpdate | null>(null);
  const [result, setResult] = useState<ActionResult | null>(null);
  const [scale, setScale] = useState<ReturnType<typeof rememberedScale>>(null);
  useEffect(() => setScale(rememberedScale()), []);

  const run = async (choose = false) => {
    if (!isWebBluetoothAvailable()) {
      setResult({ ok: false, message: "This browser has no Web Bluetooth. Weigh in from the Lactic app." });
      return;
    }
    setBusy(true);
    setResult(null);
    try {
      const reading = await weighIn(profile, setUpdate, { choose });
      setScale(rememberedScale());
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
            {scale ? scale.hint : "Works with the Hume Body Pod, Xiaomi, Renpho and other QN scales, Etekcity and standard Bluetooth scales."}
            {scale && !busy && (
              <>
                {" "}
                {scale.name} ·{" "}
                <button className="underline-offset-4 hover:text-ink hover:underline" onClick={() => run(true)}>
                  another scale
                </button>
              </>
            )}
          </p>
        </div>
        <button className={ui.primary} disabled={busy} onClick={() => run()}>
          {busy ? "Weighing..." : scale ? "Weigh in" : "Pair scale"}
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
