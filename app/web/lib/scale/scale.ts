/// <reference types="web-bluetooth" />
// Web Bluetooth weigh-in on a Hume Body Pod. Browser only (Chrome on the Mac, or Bluefy on iPhone).

import { connectGatt, findRemembered, rememberDevice } from "../ble/devices";
import { BODY_POD, profileCommand, WeighInSession, type ScaleProfile, type Segments } from "./bodypod";

export interface WeighInUpdate {
  /** picking: Chrome's list is open. waking: waiting for the remembered scale to wake up. */
  stage: "picking" | "waking" | "connecting" | "waiting" | "measuring" | "analyzing" | "done";
  liveKg: number | null;
}

export interface WeighInResult {
  measuredAt: string;
  weightKg: number;
  /** Segment impedance in ohms by frequency; empty when the scale couldn't measure (socks, wet or dry feet, not holding the bar). */
  impedance: { "50"?: Segments; "250"?: Segments };
}

// Timings from the community Body Pod integration: a whole session can take two minutes, and the
// scale goes quiet for a while between weight and impedance.
const SESSION_MS = 120_000;
const SILENCE_MS = 60_000;
/** After weight settles, how long to wait for impedance before saving weight alone. */
const IMPEDANCE_WAIT_MS = 20_000;
/** After impedance, how long to wait for a settled weight. */
const LOCK_GRACE_MS = 5_000;

/** The Body Pod only advertises once someone taps or steps on it, so a remembered one gets a while to wake. */
const WAKE_ATTEMPTS = 6;

/**
 * Connects to the remembered scale if Chrome can hand it back, otherwise opens Chrome's picker
 * (`choose` forces the picker). Call it from a click.
 */
export async function weighIn(profile: ScaleProfile, onUpdate: (u: WeighInUpdate) => void, { choose = false } = {}): Promise<WeighInResult> {
  let device = choose ? undefined : await findRemembered("scale");
  let server: BluetoothRemoteGATTServer;
  if (device) {
    onUpdate({ stage: "waking", liveKg: null });
    try {
      server = await connectGatt(device, { attempts: WAKE_ATTEMPTS });
    } catch {
      throw new Error(`${device.name ?? "The scale"} didn't wake up. Tap it with your foot and press Weigh in again.`);
    }
  } else {
    onUpdate({ stage: "picking", liveKg: null });
    device = await navigator.bluetooth.requestDevice({
      filters: [{ services: [BODY_POD.service] }, { namePrefix: "Body Pod" }, { namePrefix: "Hume" }],
      optionalServices: [BODY_POD.service],
    });
    rememberDevice("scale", device);
    onUpdate({ stage: "connecting", liveKg: null });
    server = await connectGatt(device);
  }
  try {
    const service = await server.getPrimaryService(BODY_POD.service);
    const session = new WeighInSession();
    const started = Date.now();
    let lastDataAt = started;
    let lockedAt: number | null = null;
    let impedanceAt: number | null = null;

    let finish = () => {};
    const done = new Promise<void>((resolve) => (finish = resolve));
    const onData = (characteristic: BluetoothRemoteGATTCharacteristic) => () => {
      const value = characteristic.value;
      if (!value) return;
      lastDataAt = Date.now();
      const packet = session.feed(new Uint8Array(value.buffer, value.byteOffset, value.byteLength));
      if (!packet) return;
      if (session.lockedKg !== null) lockedAt ??= Date.now();
      if (session.hasImpedance) impedanceAt ??= Date.now();
      const stage = session.hasImpedance ? "done" : session.lockedKg !== null ? "analyzing" : session.liveKg !== null ? "measuring" : "waiting";
      onUpdate({ stage, liveKg: session.weightKg });
      if (session.lockedKg !== null && session.hasImpedance) finish();
    };

    const notify = await service.getCharacteristic(BODY_POD.notify);
    notify.addEventListener("characteristicvaluechanged", onData(notify));
    await notify.startNotifications();
    // Some firmware sends on FFF2 as well; it's optional.
    try {
      const secondary = await service.getCharacteristic(BODY_POD.secondary);
      secondary.addEventListener("characteristicvaluechanged", onData(secondary));
      await secondary.startNotifications();
    } catch {}
    // The profile starts the measurement and is what makes the scale run impedance.
    await (await service.getCharacteristic(BODY_POD.profile)).writeValueWithResponse(profileCommand(profile));
    onUpdate({ stage: "waiting", liveKg: null });

    const timer = setInterval(() => {
      const now = Date.now();
      if (now - started > SESSION_MS || now - lastDataAt > SILENCE_MS) finish();
      if (lockedAt !== null && !session.hasImpedance && now - lockedAt > IMPEDANCE_WAIT_MS) finish();
      if (impedanceAt !== null && now - impedanceAt > LOCK_GRACE_MS) finish();
    }, 500);
    await done;
    clearInterval(timer);

    const weightKg = session.weightKg;
    if (weightKg === null) throw new Error("The scale didn't send a weight. Step on after connecting, and stay still until it settles.");
    return {
      measuredAt: new Date().toISOString(),
      weightKg,
      impedance: { ...(session.impedance[0] && { "50": session.impedance[0] }), ...(session.impedance[1] && { "250": session.impedance[1] }) },
    };
  } finally {
    device.gatt?.disconnect();
  }
}
