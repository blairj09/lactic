// The website demo's gear switch on the ride page: the sample rider rides Lactic's simulated
// trainer, and a visitor in Chrome or Edge can connect their own trainer (Chrome's picker) and ride
// it right there, at their own FTP. Their ride saves into the demo like any other, for this tab only.

import { useState } from "react";
import type { SensorHub, SensorState } from "@shared/ble/sensor-hub";
import { isPickerCancel, rememberDevice } from "@shared/ble/devices";
import { button, input } from "@/components/ui";
import { grant, hasChromeBluetooth } from "~/bluetooth/web-bluetooth";
import { countTestDrive } from "~/try/count";
import { rampTestFtp, twentyMinuteTestFtp } from "@shared/engine/ftp";
import { isDemo } from "./flag";

export const SIM_TRAINER = "Lactic Sim Trainer";
const SIM_HR = "Lactic Sim HR";

/** Whether the demo's trainer is the simulated one. */
export const onSimTrainer = (state: SensorState) => !state.links.trainer.name || state.links.trainer.name === SIM_TRAINER;

/** Counts a test drive step in the homepage's analytics, own trainer or simulated. */
export function countDemoRide(step: "started" | "finished", hub: SensorHub) {
  if (isDemo) countTestDrive(step, onSimTrainer(hub.getState()));
}

/** The last ride in this tab, for "Open Lactic" (./after-ride.tsx): the FTP it rode at or found. */
export interface DemoRideNote {
  ftp: number;
  method: "rampTest" | "twentyMinute" | "manual";
  simulated: boolean;
}
let lastRide: DemoRideNote | null = null;
export const lastDemoRide = () => lastRide;

export function noteDemoRide({ ftp, watts, rampTest, twentyMinuteTest, hub }: { ftp: number; watts: number[]; rampTest: boolean; twentyMinuteTest: boolean; hub: SensorHub }) {
  if (!isDemo) return;
  const ramp = rampTest ? rampTestFtp(watts) : null;
  const twenty = twentyMinuteTest ? twentyMinuteTestFtp(watts) : null;
  lastRide = {
    ftp: ramp?.watts ?? twenty?.watts ?? ftp,
    method: ramp ? "rampTest" : twenty ? "twentyMinute" : "manual",
    simulated: onSimTrainer(hub.getState()),
  };
}

export default function DemoGear({ hub, state, ftp, onFtp, riding }: { hub: SensorHub; state: SensorState; ftp: number; onFtp: (ftp: number) => void; riding: boolean }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!isDemo) return null;
  const sim = onSimTrainer(state);
  const chrome = hasChromeBluetooth();

  const connectOwn = async () => {
    setError(null);
    setBusy(true);
    try {
      // From the click, as Chrome needs for its picker.
      await hub.connect("trainer", { choose: true });
      // The simulated strap isn't the visitor's heart: Sensors pairs theirs.
      if (state.links.heartRate.name === SIM_HR) await hub.forget("heartRate");
      countTestDrive("connected", false);
    } catch (e) {
      if (!isPickerCancel(e)) setError(`Couldn't connect the trainer. ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const useSim = async () => {
    setError(null);
    setBusy(true);
    try {
      await hub.forget("trainer");
      rememberDevice("trainer", grant("sim:trainer", SIM_TRAINER));
      await hub.connect("trainer");
      if (!state.connected.heartRate) {
        await hub.forget("heartRate");
        rememberDevice("heartRate", grant("sim:hr", SIM_HR));
        await hub.connect("heartRate");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-label="Your trainer" className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-dashed border-line px-5 py-3 text-sm">
      {sim ? (
        <>
          <span className="text-muted">{chrome ? "Riding the simulated trainer." : "Riding the simulated trainer. Open lactic.fit in Chrome or Edge to ride your own."}</span>
          {chrome && (
            <button className={`${button.primary} ml-auto h-9 px-4`} disabled={busy || riding} onClick={connectOwn}>
              {busy ? "Connecting..." : "Connect your trainer"}
            </button>
          )}
        </>
      ) : (
        <>
          <label className="flex items-center gap-2">
            <span>Your FTP</span>
            <input type="number" className={`${input} num h-9 w-20`} value={ftp || ""} onChange={(e) => onFtp(Number(e.target.value) || 0)} disabled={riding} aria-label="Your FTP" />
            <span className="text-muted">W</span>
          </label>
          <button className={`${button.secondary} ml-auto h-9 px-4`} disabled={busy || riding} onClick={useSim}>
            Use the simulated trainer
          </button>
        </>
      )}
      {error && <span className="w-full text-negative">{error}</span>}
    </section>
  );
}
