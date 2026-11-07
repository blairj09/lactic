// Packet decoders for the scales in models.ts other than the Body Pod (bodypod.ts). Pure: no browser
// or Node APIs.
//
// Layouts: the Bluetooth SIG Weight Scale and Body Composition service specs; Xiaomi and QN from
// openScale (github.com/oliexdev/openScale) and Home Assistant's xiaomi-ble; QN and Etekcity ESF-551
// from etekcity_esf551_ble (github.com/ronnnnnnnnnnnnn/etekcity_esf551_ble). The code is our own.

import { LB_TO_KG, plausibleKg } from "./models";

const le16 = (d: ArrayLike<number>, at: number) => d[at] | (d[at + 1] << 8);
const be16 = (d: ArrayLike<number>, at: number) => (d[at] << 8) | d[at + 1];

/** A date-time in the SIG layout (year u16, month, day, hours, minutes, seconds), as local time. */
function sigDate(d: ArrayLike<number>, at: number): Date | null {
  const year = le16(d, at);
  if (year < 1582 || d[at + 2] < 1 || d[at + 3] < 1) return null;
  return new Date(year, d[at + 2] - 1, d[at + 3], d[at + 4], d[at + 5], d[at + 6]);
}

// --- Bluetooth SIG Weight Scale and Body Composition -------------------------------------------

export interface WeightMeasurement {
  kg: number;
  at: Date | null;
  userId: number | null;
}

/** Weight Measurement (0x2A9D). */
export function decodeWeightMeasurement(d: ArrayLike<number>): WeightMeasurement | null {
  if (d.length < 3) return null;
  const flags = d[0];
  const imperial = (flags & 0x01) !== 0;
  let at = 1;
  const raw = le16(d, at);
  at += 2;
  // 0xFFFF means "measurement unsuccessful".
  if (raw === 0xffff) return null;
  const kg = imperial ? raw * 0.01 * LB_TO_KG : raw * 0.005;
  let when: Date | null = null;
  if (flags & 0x02) {
    if (d.length < at + 7) return null;
    when = sigDate(d, at);
    at += 7;
  }
  const userId = flags & 0x04 && d.length > at ? d[at] : null;
  return { kg: round2(kg), at: when, userId };
}

export interface BodyCompositionMeasurement {
  bodyFatPercent: number | null;
  kg: number | null;
  impedanceOhms: number | null;
  at: Date | null;
  /** The scale split this measurement over two packets; this is one of them. */
  multiPacket: boolean;
}

/** Body Composition Measurement (0x2A9C). */
export function decodeBodyComposition(d: ArrayLike<number>): BodyCompositionMeasurement | null {
  if (d.length < 4) return null;
  const flags = le16(d, 0);
  const imperial = (flags & 0x0001) !== 0;
  const mass = (raw: number) => (imperial ? raw * 0.01 * LB_TO_KG : raw * 0.005);
  let at = 2;
  const fatRaw = le16(d, at);
  at += 2;
  const result: BodyCompositionMeasurement = {
    bodyFatPercent: fatRaw === 0xffff ? null : fatRaw / 10,
    kg: null,
    impedanceOhms: null,
    at: null,
    multiPacket: (flags & 0x1000) !== 0,
  };
  const take = (bytes: number) => {
    const start = at;
    at += bytes;
    return at <= d.length ? start : -1;
  };
  if (flags & 0x0002) {
    const i = take(7);
    if (i >= 0) result.at = sigDate(d, i);
  }
  if (flags & 0x0004) take(1); // user id
  if (flags & 0x0008) take(2); // basal metabolism
  if (flags & 0x0010) take(2); // muscle percentage
  if (flags & 0x0020) take(2); // muscle mass
  if (flags & 0x0040) take(2); // fat free mass
  if (flags & 0x0080) take(2); // soft lean mass
  if (flags & 0x0100) take(2); // body water mass
  if (flags & 0x0200) {
    const i = take(2);
    if (i >= 0) result.impedanceOhms = le16(d, i) / 10;
  }
  if (flags & 0x0400) {
    const i = take(2);
    if (i >= 0) result.kg = round2(mass(le16(d, i)));
  }
  return result;
}

// --- Xiaomi Mi scales ------------------------------------------------------------------------------

export interface MiReading {
  kg: number;
  /** The scale has settled on this weight. */
  stable: boolean;
  /** Someone stepped off; the scale is repeating its last reading. */
  removed: boolean;
  /** Foot-to-foot impedance, Body Composition Scale 2 only. */
  impedanceOhms: number | null;
}

const fromMiUnits = (raw: number, lb: boolean, jin: boolean) => (lb ? (raw / 100) * LB_TO_KG : jin ? raw / 100 / 2 : raw / 200);

/** Mi Smart Scale (1 and 2) service data under 0x181D: control byte, weight, date. */
export function decodeMiScale(d: ArrayLike<number>): MiReading | null {
  if (d.length < 3) return null;
  const ctrl = d[0];
  const kg = fromMiUnits(le16(d, 1), (ctrl & 0x01) !== 0, (ctrl & 0x10) !== 0);
  return { kg: round2(kg), stable: (ctrl & 0x20) !== 0, removed: (ctrl & 0x80) !== 0, impedanceOhms: null };
}

/** Mi Body Composition Scale (2) service data under 0x181B: two control bytes, date, impedance, weight. */
export function decodeMiBodyScale(d: ArrayLike<number>): MiReading | null {
  if (d.length < 13) return null;
  const ctrl1 = d[1];
  const kg = fromMiUnits(le16(d, 11), (d[0] & 0x01) !== 0, (ctrl1 & 0x40) !== 0);
  const hasImpedance = (ctrl1 & 0x02) !== 0;
  const ohms = le16(d, 9);
  return {
    kg: round2(kg),
    stable: (ctrl1 & 0x20) !== 0,
    removed: (ctrl1 & 0x80) !== 0,
    impedanceOhms: hasImpedance && ohms > 0 && ohms < 3000 ? ohms : null,
  };
}

// --- QN scales -------------------------------------------------------------------------------------
//
// The scale drives the session: it repeats a unit request (0x12) until answered, then asks for the
// time (0x14), then streams weight frames (0x10) until the final one. Every frame carries a
// per-model "vendor byte" at offset 2, which replies echo. Commands end with a mod-256 sum.

export type QnFrame =
  | { kind: "unitRequest"; vendor: number }
  | { kind: "timeRequest"; vendor: number }
  | { kind: "weight"; kg: number; final: boolean; /** 50 kHz foot-to-foot resistance, raw. */ resistance: number | null }
  | { kind: "other"; opcode: number };

const withSum = (bytes: number[]) => Uint8Array.from([...bytes, bytes.reduce((s, b) => s + b, 0) & 0xff]);

/** Seconds from the Unix epoch to the QN scales' epoch (2000-01-01 in UTC+8). */
const QN_EPOCH = 946_656_000;

export function decodeQnFrame(d: ArrayLike<number>): QnFrame | null {
  if (d.length < 3) return null;
  const opcode = d[0];
  if (opcode === 0x12 && d.length >= 10) return { kind: "unitRequest", vendor: d[2] };
  if (opcode === 0x14 && d.length >= 11) return { kind: "timeRequest", vendor: d[2] };
  if (opcode === 0x10 && d.length >= 10) {
    const raw = be16(d, 3);
    // Most models count in 0.01 kg; some older ones in 0.1 kg. Whichever gives a body weight.
    const kg = plausibleKg(raw / 100) ? raw / 100 : plausibleKg(raw / 10) ? raw / 10 : raw / 100;
    const resistance = be16(d, 6);
    return { kind: "weight", kg: round2(kg), final: d[5] === 1, resistance: resistance > 0 ? resistance : null };
  }
  return { kind: "other", opcode };
}

/** Answer to the unit request: show kilograms. */
export const qnUnitCommand = (vendor: number) => withSum([0x13, 0x09, vendor, 0x01, 0x10, 0x28, 0x37, 0x00]);

/** Answer to the time request: the current time, which starts the measurement. */
export function qnTimeCommand(vendor: number, now: Date) {
  const t = Math.max(0, Math.floor(now.getTime() / 1000) - QN_EPOCH);
  return withSum([0x20, 0x08, vendor, t & 0xff, (t >> 8) & 0xff, (t >> 16) & 0xff, (t >>> 24) & 0xff]);
}

/** Ends the session, or the scale keeps repeating its final frame. */
export const qnEndCommand = (vendor: number) => withSum([0x1f, 0x05, vendor, 0x10]);

// --- Etekcity ESF-551 ------------------------------------------------------------------------------

export interface EsfReading {
  kg: number;
  stable: boolean;
  impedanceOhms: number | null;
}

/** A 22-byte ESF-551 weight notification: A5 02 .. 10 00 .. 01 61 A1 00, weight, impedance, flags. */
export function decodeEsf551(d: ArrayLike<number>): EsfReading | null {
  if (d.length !== 22 || d[0] !== 0xa5 || d[1] !== 0x02 || d[3] !== 0x10 || d[4] !== 0x00) return null;
  if (d[6] !== 0x01 || d[7] !== 0x61 || d[8] !== 0xa1 || d[9] !== 0x00) return null;
  const grams = d[10] | (d[11] << 8) | (d[12] << 16);
  const ohms = le16(d, 13);
  return { kg: round2(grams / 1000), stable: d[19] === 1, impedanceOhms: d[20] === 1 && ohms > 0 ? ohms : null };
}

function round2(v: number) {
  return Math.round(v * 100) / 100;
}
