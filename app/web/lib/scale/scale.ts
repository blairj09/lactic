/// <reference types="web-bluetooth" />
// Web Bluetooth weigh-in on any scale in models.ts. Browser only (the Lactic app's Bluetooth, or
// Chrome). Connected scales go through GATT; Xiaomi scales are read from their advertisements.

import { connectGatt, findRemembered, rememberDevice } from "../ble/devices";
import { BODY_POD, profileCommand, WeighInSession, type ScaleProfile, type Segments } from "./bodypod";
import { decodeBodyComposition, decodeEsf551, decodeMiBodyScale, decodeMiScale, decodeQnFrame, decodeWeightMeasurement, qnEndCommand, qnTimeCommand, qnUnitCommand } from "./decoders";
import { identifyScale, plausibleKg, SCALE_FAMILIES, SCALE_REQUEST, SCALE_UUID, type ScaleFamily } from "./models";

export { SCALE_REQUEST };

export interface WeighInUpdate {
  /** picking: the device list is open. waking: waiting for the remembered scale to wake up. */
  stage: "picking" | "waking" | "connecting" | "waiting" | "measuring" | "analyzing" | "done";
  liveKg: number | null;
}

export interface WeighInResult {
  measuredAt: string;
  weightKg: number;
  /** Segment impedance in ohms by frequency (Body Pod); empty when the scale couldn't measure (socks, wet or dry feet, not holding the bar). */
  impedance: { "50"?: Segments; "250"?: Segments };
  /** Which kind of scale, and its `body_measurements.source`. */
  scale: ScaleFamily;
  source: string;
  /** Body fat the scale worked out itself (standard body composition scales). */
  bodyFatPercent?: number | null;
  /** Foot-to-foot impedance, raw, from scales without a handle. Kept, not used for numbers yet. */
  footImpedanceOhms?: number | null;
}

// Timings from the community Body Pod integration: a whole session can take two minutes, and the
// scale goes quiet for a while between weight and impedance.
const SESSION_MS = 120_000;
const SILENCE_MS = 60_000;
/** After weight settles, how long to wait for impedance or body composition before saving weight alone. */
const IMPEDANCE_WAIT_MS = 20_000;
/** Scales that send body composition right after weight get less time. */
const COMPOSITION_WAIT_MS = 8_000;
/** After impedance, how long to wait for a settled weight. */
const LOCK_GRACE_MS = 5_000;
/** A stored reading older than this isn't today's weigh-in. */
const STALE_MS = 15 * 60_000;

/** Scales only advertise once someone taps or steps on them, so a remembered one gets a while to wake. */
const WAKE_ATTEMPTS = 6;

const NO_WEIGHT = "The scale didn't send a weight. Step on after it's ready, and stay still until it settles.";

/**
 * Connects to the remembered scale if the browser can hand it back, otherwise opens the device list
 * (`choose` forces it). Call it from a click. `profile` is needed for the Body Pod only.
 */
export async function weighIn(profile: ScaleProfile | null, onUpdate: (u: WeighInUpdate) => void, { choose = false } = {}): Promise<WeighInResult> {
  let device = choose ? undefined : await findRemembered("scale");
  const fresh = !device;
  if (!device) {
    onUpdate({ stage: "picking", liveKg: null });
    device = await navigator.bluetooth.requestDevice(SCALE_REQUEST);
    rememberDevice("scale", device);
  }
  const named = identifyScale({ name: device.name });
  if (named === "xiaomi") return broadcastWeighIn(device, onUpdate);

  let server: BluetoothRemoteGATTServer;
  if (fresh) {
    onUpdate({ stage: "connecting", liveKg: null });
    server = await connectGatt(device);
  } else {
    onUpdate({ stage: "waking", liveKg: null });
    try {
      server = await connectGatt(device, { attempts: WAKE_ATTEMPTS });
    } catch {
      throw new Error(`${device.name ?? "The scale"} didn't wake up. Tap or step on it and press Weigh in again.`);
    }
  }
  try {
    const found = await probe(server, named);
    if (!found) throw new Error(`${device.name ?? "This device"} isn't a scale Lactic can read yet.`);
    switch (found.family) {
      case "bodyPod":
        if (!profile) throw new Error("Add your height, birth date and sex in Settings to weigh in on the Body Pod.");
        return await bodyPodSession(found.service, profile, onUpdate);
      case "standard":
        return await standardSession(server, onUpdate);
      default:
        return await vendorSession(found.service, onUpdate);
    }
  } finally {
    device.gatt?.disconnect();
  }
}

async function optionalService(server: BluetoothRemoteGATTServer, uuid: number) {
  try {
    return await server.getPrimaryService(uuid);
  } catch {
    return null;
  }
}

async function optionalChar(service: BluetoothRemoteGATTService | null, uuid: number) {
  if (!service) return null;
  try {
    return await service.getCharacteristic(uuid);
  } catch {
    return null;
  }
}

/** Works out the protocol from the services the scale has, when its name didn't say. */
async function probe(server: BluetoothRemoteGATTServer, named: ScaleFamily | null): Promise<{ family: ScaleFamily; service: BluetoothRemoteGATTService } | null> {
  const fff0 = await optionalService(server, SCALE_UUID.vendorFff0);
  // The Body Pod, QN scales and the ESF-551 all use FFF0; only the Body Pod has FFF4.
  if (fff0 && (named === "bodyPod" || (named === null && (await optionalChar(fff0, BODY_POD.notify))))) return { family: "bodyPod", service: fff0 };
  if (fff0 && (await optionalChar(fff0, 0xfff1))) return { family: named === "etekcity" ? "etekcity" : "qn", service: fff0 };
  const ffe0 = await optionalService(server, SCALE_UUID.vendorFfe0);
  if (ffe0 && (await optionalChar(ffe0, 0xffe1))) return { family: "qn", service: ffe0 };
  const standard = (await optionalService(server, SCALE_UUID.weightScale)) ?? (await optionalService(server, SCALE_UUID.bodyComposition));
  if (standard) return { family: "standard", service: standard };
  return null;
}

const bytesOf = (v: DataView) => new Uint8Array(v.buffer.slice(v.byteOffset, v.byteOffset + v.byteLength));

async function subscribe(c: BluetoothRemoteGATTCharacteristic, on: (bytes: Uint8Array) => void) {
  c.addEventListener("characteristicvaluechanged", () => c.value && on(bytesOf(c.value)));
  await c.startNotifications();
}

/** One GATT write at a time. */
function writer() {
  let tail: Promise<unknown> = Promise.resolve();
  return (c: BluetoothRemoteGATTCharacteristic, bytes: Uint8Array<ArrayBuffer>) => {
    const next = tail.then(() => c.writeValue(bytes));
    tail = next.catch(() => undefined);
    return next;
  };
}

/** The clock of a weigh-in: finishes when `check` says so, or the scale goes quiet or runs long. */
function timeline(check: (now: number) => boolean) {
  const started = Date.now();
  let lastDataAt = started;
  let finish = () => {};
  const done = new Promise<void>((resolve) => (finish = resolve));
  const timer = setInterval(() => {
    const now = Date.now();
    if (now - started > SESSION_MS || now - lastDataAt > SILENCE_MS || check(now)) finish();
  }, 250);
  return {
    heard: () => (lastDataAt = Date.now()),
    finish: () => finish(),
    wait: () => done.finally(() => clearInterval(timer)),
  };
}

function result(scale: ScaleFamily, weightKg: number | null, extra: Partial<WeighInResult> = {}): WeighInResult {
  if (weightKg === null) throw new Error(NO_WEIGHT);
  return { measuredAt: new Date().toISOString(), weightKg, impedance: {}, scale, source: SCALE_FAMILIES[scale].source, ...extra };
}

// --- Hume Body Pod ---------------------------------------------------------------------------------

async function bodyPodSession(service: BluetoothRemoteGATTService, profile: ScaleProfile, onUpdate: (u: WeighInUpdate) => void): Promise<WeighInResult> {
  const session = new WeighInSession();
  let lockedAt: number | null = null;
  let impedanceAt: number | null = null;
  const clock = timeline((now) => (lockedAt !== null && !session.hasImpedance && now - lockedAt > IMPEDANCE_WAIT_MS) || (impedanceAt !== null && now - impedanceAt > LOCK_GRACE_MS));
  const onData = (bytes: Uint8Array) => {
    clock.heard();
    const packet = session.feed(bytes);
    if (!packet) return;
    if (session.lockedKg !== null) lockedAt ??= Date.now();
    if (session.hasImpedance) impedanceAt ??= Date.now();
    const stage = session.hasImpedance ? "done" : session.lockedKg !== null ? "analyzing" : session.liveKg !== null ? "measuring" : "waiting";
    onUpdate({ stage, liveKg: session.weightKg });
    if (session.lockedKg !== null && session.hasImpedance) clock.finish();
  };
  await subscribe(await service.getCharacteristic(BODY_POD.notify), onData);
  // Some firmware sends on FFF2 as well; it's optional.
  const secondary = await optionalChar(service, BODY_POD.secondary);
  if (secondary) await subscribe(secondary, onData).catch(() => undefined);
  // The profile starts the measurement and is what makes the scale run impedance.
  await (await service.getCharacteristic(BODY_POD.profile)).writeValueWithResponse(profileCommand(profile));
  onUpdate({ stage: "waiting", liveKg: null });
  await clock.wait();
  return result("bodyPod", session.weightKg, {
    impedance: { ...(session.impedance[0] && { "50": session.impedance[0] }), ...(session.impedance[1] && { "250": session.impedance[1] }) },
  });
}

// --- Bluetooth SIG Weight Scale / Body Composition -------------------------------------------------

/** A reading with no timestamp, a scale clock that was never set, or a recent time counts as now. */
const isFresh = (at: Date | null) => at === null || at.getFullYear() < 2020 || Math.abs(Date.now() - at.getTime()) < STALE_MS;

async function standardSession(server: BluetoothRemoteGATTServer, onUpdate: (u: WeighInUpdate) => void): Promise<WeighInResult> {
  const weightChar = await optionalChar(await optionalService(server, SCALE_UUID.weightScale), SCALE_UUID.weightMeasurement);
  const compChar = await optionalChar(await optionalService(server, SCALE_UUID.bodyComposition), SCALE_UUID.bodyCompositionMeasurement);
  if (!weightChar && !compChar) throw new Error("This scale doesn't offer its measurements over Bluetooth.");
  let kg: number | null = null;
  let bodyFat: number | null = null;
  let ohms: number | null = null;
  let compDone = !compChar;
  let lockedAt: number | null = null;
  const clock = timeline((now) => kg !== null && (compDone || (lockedAt !== null && now - lockedAt > COMPOSITION_WAIT_MS)));
  const update = () => {
    onUpdate({ stage: kg === null ? "measuring" : compDone ? "done" : "analyzing", liveKg: kg });
    if (kg !== null && compDone) clock.finish();
  };
  if (weightChar)
    await subscribe(weightChar, (bytes) => {
      clock.heard();
      const m = decodeWeightMeasurement(bytes);
      if (!m || !plausibleKg(m.kg) || !isFresh(m.at)) return;
      kg = m.kg;
      lockedAt = Date.now();
      update();
    });
  if (compChar)
    await subscribe(compChar, (bytes) => {
      clock.heard();
      const m = decodeBodyComposition(bytes);
      if (!m || !isFresh(m.at)) return;
      if (m.bodyFatPercent !== null && m.bodyFatPercent > 2 && m.bodyFatPercent < 75) bodyFat = m.bodyFatPercent;
      if (m.impedanceOhms !== null) ohms = m.impedanceOhms;
      if (m.kg !== null && plausibleKg(m.kg)) {
        kg = m.kg;
        lockedAt = Date.now();
      }
      // A two-packet measurement sets the flag on both; the one with the weight comes last.
      if (!m.multiPacket || m.kg !== null) compDone = true;
      update();
    });
  // Scales with a clock want the time; most take it, and it's harmless when they don't.
  const time = await optionalChar(await optionalService(server, SCALE_UUID.currentTimeService), SCALE_UUID.currentTime);
  if (time?.properties.write || time?.properties.writeWithoutResponse) await time.writeValue(currentTime(new Date())).catch(() => undefined);
  onUpdate({ stage: "waiting", liveKg: null });
  await clock.wait();
  return result("standard", kg, { bodyFatPercent: bodyFat, footImpedanceOhms: ohms });
}

/** Current Time (0x2A2B): date-time, day of week (Monday 1), fractions, reason. */
export function currentTime(d: Date): Uint8Array<ArrayBuffer> {
  const y = d.getFullYear();
  return Uint8Array.from([y & 0xff, y >> 8, d.getMonth() + 1, d.getDate(), d.getHours(), d.getMinutes(), d.getSeconds(), ((d.getDay() + 6) % 7) + 1, 0, 0]);
}

// --- QN scales and the Etekcity ESF-551 ------------------------------------------------------------

async function vendorSession(service: BluetoothRemoteGATTService, onUpdate: (u: WeighInUpdate) => void): Promise<WeighInResult> {
  const ffe0 = (await optionalChar(service, 0xffe1)) !== null;
  const notify = await service.getCharacteristic(ffe0 ? 0xffe1 : 0xfff1);
  const unitChar = await optionalChar(service, ffe0 ? 0xffe3 : 0xfff2);
  const timeChar = await optionalChar(service, ffe0 ? 0xffe4 : 0xfff2);
  const write = writer();
  let scale: ScaleFamily = "qn";
  let vendor: number | null = null;
  let liveKg: number | null = null;
  let lockedKg: number | null = null;
  let ohms: number | null = null;
  let lockedAt: number | null = null;
  let unitSentAt = 0;
  const clock = timeline((now) => lockedAt !== null && (ohms !== null || now - lockedAt > LOCK_GRACE_MS));
  await subscribe(notify, (bytes) => {
    clock.heard();
    const esf = decodeEsf551(bytes);
    if (esf) {
      scale = "etekcity";
      if (!plausibleKg(esf.kg)) return;
      liveKg = esf.kg;
      if (esf.stable) {
        lockedKg = esf.kg;
        lockedAt ??= Date.now();
      }
      if (esf.impedanceOhms !== null) ohms = esf.impedanceOhms;
    } else {
      const frame = decodeQnFrame(bytes);
      if (!frame) return;
      if (frame.kind === "unitRequest") {
        vendor = frame.vendor;
        // The scale repeats this every 200 ms until it hears back.
        if (unitChar && Date.now() - unitSentAt > 1000) {
          unitSentAt = Date.now();
          void write(unitChar, qnUnitCommand(frame.vendor)).catch(() => undefined);
        }
        return;
      }
      if (frame.kind === "timeRequest") {
        vendor = frame.vendor;
        if (timeChar) void write(timeChar, qnTimeCommand(frame.vendor, new Date())).catch(() => undefined);
        return;
      }
      if (frame.kind !== "weight" || !plausibleKg(frame.kg)) return;
      liveKg = frame.kg;
      if (frame.final) {
        lockedKg = frame.kg;
        ohms = frame.resistance;
        lockedAt ??= Date.now();
        // The final frame carries everything there is.
        clock.finish();
      }
    }
    onUpdate({ stage: lockedKg === null ? "measuring" : ohms === null ? "analyzing" : "done", liveKg: lockedKg ?? liveKg });
    if (lockedKg !== null && ohms !== null) clock.finish();
  });
  onUpdate({ stage: "waiting", liveKg: null });
  await clock.wait();
  if (vendor !== null && unitChar) await write(unitChar, qnEndCommand(vendor)).catch(() => undefined);
  return result(scale, lockedKg ?? liveKg, { footImpedanceOhms: ohms });
}

// --- Xiaomi: weight in the advertisement -----------------------------------------------------------

const full16 = (n: number) => `0000${n.toString(16).padStart(4, "0")}-0000-1000-8000-00805f9b34fb`;

async function broadcastWeighIn(device: BluetoothDevice, onUpdate: (u: WeighInUpdate) => void): Promise<WeighInResult> {
  if (typeof device.watchAdvertisements !== "function") throw new Error("Reading a Xiaomi scale needs the Lactic app.");
  const controller = new AbortController();
  let liveKg: number | null = null;
  let lockedKg: number | null = null;
  let ohms: number | null = null;
  let lockedAt: number | null = null;
  let bodyScale = false;
  let last = "";
  const clock = timeline((now) => lockedAt !== null && (!bodyScale || ohms !== null || now - lockedAt > COMPOSITION_WAIT_MS));
  const onAdvert = (event: Event) => {
    const data = (event as BluetoothAdvertisingEvent).serviceData;
    const v2 = data?.get(full16(SCALE_UUID.bodyComposition));
    const v1 = data?.get(full16(SCALE_UUID.weightScale));
    const view = v2 ?? v1;
    if (!view) return;
    const bytes = bytesOf(view);
    const key = Array.from(bytes).join(",");
    if (key === last) return;
    last = key;
    clock.heard();
    const reading = v2 ? decodeMiBodyScale(bytes) : decodeMiScale(bytes);
    // A reading marked removed is the scale repeating the last weigh-in after someone stepped off.
    if (!reading || reading.removed || !plausibleKg(reading.kg)) return;
    bodyScale ||= Boolean(v2);
    liveKg = reading.kg;
    if (reading.stable) {
      lockedKg = reading.kg;
      lockedAt ??= Date.now();
    }
    if (reading.impedanceOhms !== null) ohms = reading.impedanceOhms;
    onUpdate({ stage: lockedKg === null ? "measuring" : bodyScale && ohms === null ? "analyzing" : "done", liveKg: lockedKg ?? liveKg });
  };
  device.addEventListener("advertisementreceived", onAdvert);
  try {
    await device.watchAdvertisements({ signal: controller.signal });
    onUpdate({ stage: "waiting", liveKg: null });
    await clock.wait();
  } finally {
    controller.abort();
    device.removeEventListener("advertisementreceived", onAdvert);
  }
  return result("xiaomi", lockedKg, { footImpedanceOhms: ohms });
}
