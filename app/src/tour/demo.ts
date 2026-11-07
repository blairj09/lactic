// The tour's demo ride: a short workout on the simulated trainer and heart rate strap. It talks to
// its own simulator through the same GATT packets a real trainer uses, so it shows ERG for real,
// and it never touches the rider's paired gear, rides or plan.

import type { BleBackend } from "~/bluetooth/backend";
import { fullUuid } from "~/bluetooth/backend";
import { controlPoint, GATT, parseHeartRate, parseIndoorBikeData } from "@/lib/ble/protocol";
import { ramp, steady, type Workout } from "@/lib/engine/workout";

/** About two and a half minutes: a warm-up, three short efforts and an easy finish. */
export const DEMO_WORKOUT: Workout = {
  name: "Demo ride",
  segments: [ramp(30, 0.5, 0.75), steady(20, 1.1), steady(15, 0.6), steady(20, 1.1), steady(15, 0.6), steady(20, 1.2), steady(15, 0.5)],
};

export interface DemoReading {
  watts: number | null;
  heartRate: number | null;
  cadence: number | null;
}

export interface DemoGear {
  /** ERG: the trainer holds this many watts. */
  setTarget(watts: number): Promise<void>;
  stop(): Promise<void>;
}

const TRAINER = "sim:trainer";
const HR = "sim:hr";
const svc = GATT.service;
const chr = GATT.characteristic;

/** Connects the simulated trainer and strap and takes control of the trainer. */
export async function connectDemoGear(backend: BleBackend, onReading: (r: Partial<DemoReading>) => void): Promise<DemoGear> {
  const off = backend.onNotify((n) => {
    if (n.id === TRAINER && n.characteristic === fullUuid(chr.indoorBikeData)) {
      const d = parseIndoorBikeData(n.value);
      if (d) onReading({ watts: d.powerWatts ?? null, cadence: d.cadenceRpm ?? null });
    }
    if (n.id === HR && n.characteristic === fullUuid(chr.heartRateMeasurement)) {
      const h = parseHeartRate(n.value);
      if (h) onReading({ heartRate: h.bpm });
    }
  });
  await backend.connect(TRAINER);
  await backend.connect(HR);
  await backend.subscribe(TRAINER, fullUuid(svc.fitnessMachine), fullUuid(chr.indoorBikeData), true);
  await backend.subscribe(TRAINER, fullUuid(svc.fitnessMachine), fullUuid(chr.fitnessMachineControlPoint), true);
  await backend.subscribe(HR, fullUuid(svc.heartRate), fullUuid(chr.heartRateMeasurement), true);
  // One write at a time, as with real gear.
  let queue: Promise<unknown> = Promise.resolve();
  const write = (bytes: Uint8Array) => {
    queue = queue.then(() => backend.write(TRAINER, fullUuid(svc.fitnessMachine), fullUuid(chr.fitnessMachineControlPoint), [...bytes], true)).catch(() => undefined);
    return queue as Promise<void>;
  };
  await write(controlPoint.requestControl());
  await write(controlPoint.startOrResume());
  return {
    setTarget: (watts) => write(controlPoint.setTargetPower(watts)),
    async stop() {
      off();
      await queue;
      await backend.disconnect(TRAINER);
      await backend.disconnect(HR);
    },
  };
}
