// Writes a ride as a FIT activity file, so it can go to intervals.icu like any head unit's file, or
// be exported to Garmin Connect, Strava and the rest. Records of power, heart rate and cadence (and
// position where there's a GPS track), a lap per workout block (or one for the whole ride) and one
// cycling session.
// No browser or Node APIs, so it runs and tests anywhere.

import { FIT_SPORT_CYCLING } from "./decode";

/** Seconds between the Unix epoch and the FIT epoch (1989-12-31T00:00:00Z). */
const FIT_EPOCH = 631065600;
/** FIT's manufacturer id for software that isn't a registered device. */
export const FIT_MANUFACTURER_DEVELOPMENT = 255;
/**
 * Lactic's manufacturer id in files it writes. Still "development" until Lactic has its own id in
 * the FIT SDK; then this changes, and Strava (after a device mapping) shows "Lactic" as the device.
 */
export const FIT_MANUFACTURER_LACTIC = FIT_MANUFACTURER_DEVELOPMENT;
/** Written as the file's product name, which apps that don't know the manufacturer id can show. */
export const FIT_PRODUCT_NAME = "Lactic";
const SUB_SPORT_INDOOR_CYCLING = 6;

export interface RideSamples {
  startedAt: Date;
  /** One value per second; heart rate 0 means no reading. */
  watts: number[];
  heartRate: number[];
  cadence: number[];
  /** Seconds between samples. Default 1. */
  stepSeconds?: number;
  /** Indoor (the default) or a road ride outside. */
  indoor?: boolean;
  /** GPS points as [lat, lng, ride second]. */
  route?: [number, number, number?][] | null;
  /** Ride seconds where a new lap starts (each workout block), from `lapStarts`. One lap when empty. */
  laps?: number[];
}

const BASE = { enum: 0x00, uint8: 0x02, uint16: 0x84, sint32: 0x85, uint32: 0x86, uint32z: 0x8c, string16: 0x07 } as const;
type BaseType = keyof typeof BASE;
const SIZE: Record<BaseType, number> = { enum: 1, uint8: 1, uint16: 2, sint32: 4, uint32: 4, uint32z: 4, string16: 16 };
const INVALID: Record<BaseType, number> = { enum: 0xff, uint8: 0xff, uint16: 0xffff, sint32: 0x7fffffff, uint32: 0xffffffff, uint32z: 0, string16: 0 };

type FieldSpec = [num: number, type: BaseType];

const MESSAGES = {
  fileId: { local: 0, global: 0, fields: [[0, "enum"], [1, "uint16"], [2, "uint16"], [3, "uint32z"], [4, "uint32"], [8, "string16"]] },
  event: { local: 1, global: 21, fields: [[253, "uint32"], [0, "enum"], [1, "enum"]] },
  record: { local: 2, global: 20, fields: [[253, "uint32"], [7, "uint16"], [3, "uint8"], [4, "uint8"]] },
  lap: {
    local: 3,
    global: 19,
    fields: [
      [253, "uint32"], [254, "uint16"], [2, "uint32"], [7, "uint32"], [8, "uint32"],
      [19, "uint16"], [20, "uint16"], [15, "uint8"], [16, "uint8"], [17, "uint8"],
      [0, "enum"], [1, "enum"], [24, "enum"],
    ],
  },
  session: {
    local: 4,
    global: 18,
    fields: [[253, "uint32"], [2, "uint32"], [7, "uint32"], [8, "uint32"], [5, "enum"], [6, "enum"], [25, "uint16"], [26, "uint16"], [0, "enum"], [1, "enum"]],
  },
  activity: { local: 5, global: 34, fields: [[253, "uint32"], [0, "uint32"], [1, "uint16"], [2, "enum"], [3, "enum"], [4, "enum"]] },
  /** A record with a GPS position. */
  placed: { local: 6, global: 20, fields: [[253, "uint32"], [7, "uint16"], [3, "uint8"], [4, "uint8"], [0, "sint32"], [1, "sint32"]] },
} satisfies Record<string, { local: number; global: number; fields: FieldSpec[] }>;

type Message = (typeof MESSAGES)[keyof typeof MESSAGES];

export function encodeRideFit(ride: RideSamples): Uint8Array {
  const body: number[] = [];
  const push = (value: number, size: number) => {
    for (let i = 0; i < size; i++) body.push((value >>> (8 * i)) & 0xff);
  };
  const defined = new Set<number>();
  const write = (message: Message, values: (number | string | null)[]) => {
    if (!defined.has(message.local)) {
      defined.add(message.local);
      body.push(0x40 | message.local, 0, 0); // definition, reserved, little endian
      push(message.global, 2);
      body.push(message.fields.length);
      for (const [num, type] of message.fields) body.push(num, SIZE[type], BASE[type]);
    }
    body.push(message.local);
    message.fields.forEach(([, type], i) => {
      const value = values[i];
      if (typeof value === "string") {
        // Null-padded ASCII, cut to leave room for the terminator.
        const bytes = [...value.slice(0, SIZE[type] - 1)].map((c) => c.charCodeAt(0) & 0x7f);
        for (let j = 0; j < SIZE[type]; j++) body.push(bytes[j] ?? 0);
      } else push(value ?? INVALID[type], SIZE[type]);
    });
  };

  const start = Math.round(ride.startedAt.getTime() / 1000) - FIT_EPOCH;
  const step = Math.max(1, Math.round(ride.stepSeconds ?? 1));
  const samples = Math.max(ride.watts.length, ride.heartRate.length, ride.cadence.length);
  const seconds = samples * step;
  const end = start + Math.max(seconds - step, 0);
  const millis = seconds * 1000;
  const subSport = ride.indoor === false ? 7 : SUB_SPORT_INDOOR_CYCLING; // 7 = road
  // Each timed GPS point goes on the sample nearest its second.
  const positions = new Map<number, [number, number]>();
  for (const [lat, lng, second] of ride.route ?? []) {
    if (second === undefined || !Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    const i = Math.round(second / step);
    if (i >= 0 && i < samples && !positions.has(i)) positions.set(i, [semicircles(lat), semicircles(lng)]);
  }
  const reading = (v: number | undefined, max: number) => (v !== undefined && Number.isFinite(v) && v >= 0 ? Math.min(Math.round(v), max) : null);

  write(MESSAGES.fileId, [4, FIT_MANUFACTURER_LACTIC, 0, 1, start, FIT_PRODUCT_NAME]);
  write(MESSAGES.event, [start, 0, 0]); // timer start
  for (let i = 0; i < samples; i++) {
    const hr = reading(ride.heartRate[i], 254);
    const values = [start + i * step, reading(ride.watts[i], 0xfffe), hr === 0 ? null : hr, reading(ride.cadence[i], 254)];
    const at = positions.get(i);
    if (at) write(MESSAGES.placed, [...values, ...at]);
    else write(MESSAGES.record, values);
  }
  write(MESSAGES.event, [end, 0, 4]); // timer stop all
  // Lap boundaries as sample indexes, each inside the ride and after the one before.
  const firsts = [0];
  for (const second of ride.laps ?? []) {
    const i = Math.round(second / step);
    if (i > firsts.at(-1)! && i < samples) firsts.push(i);
  }
  firsts.forEach((first, n) => {
    const next = firsts[n + 1] ?? samples;
    const lapMillis = (next - first) * step * 1000;
    // Mean and max of a channel over the lap; heart rate leaves out its 0 (no reading) seconds.
    const stats = (values: number[], max: number, skipZeros: boolean): [number | null, number | null] => {
      let sum = 0, count = 0, top = 0;
      for (let i = first; i < next; i++) {
        const v = reading(values[i], max);
        if (v === null || (skipZeros && v === 0)) continue;
        sum += v;
        count++;
        top = Math.max(top, v);
      }
      return top > 0 ? [Math.round(sum / count), top] : [null, null];
    };
    const [avgPower, maxPower] = stats(ride.watts, 0xfffe, false);
    const [avgHr, maxHr] = stats(ride.heartRate, 254, true);
    const [avgCadence] = stats(ride.cadence, 254, false);
    const last = n === firsts.length - 1;
    // lap_trigger 0 = manual (a new block), 7 = session end.
    write(MESSAGES.lap, [start + (next - 1) * step, n, start + first * step, lapMillis, lapMillis, avgPower, maxPower, avgHr, maxHr, avgCadence, 9, 1, last ? 7 : 0]);
  });
  write(MESSAGES.session, [end, start, millis, millis, FIT_SPORT_CYCLING, subSport, 0, firsts.length, 8, 1]);
  write(MESSAGES.activity, [end, millis, 1, 0, 26, 1]);

  const header = [14, 0x20, 0x54, 0x08, ...[0, 8, 16, 24].map((s) => (body.length >>> s) & 0xff), ...[...".FIT"].map((c) => c.charCodeAt(0))];
  const headerCrc = fitCrc(header);
  const file = [...header, headerCrc & 0xff, headerCrc >> 8, ...body];
  const fileCrc = fitCrc(file);
  file.push(fileCrc & 0xff, fileCrc >> 8);
  return Uint8Array.from(file);
}

/** Degrees to FIT's semicircles. */
const semicircles = (degrees: number) => Math.round((degrees * 2 ** 31) / 180);

const CRC_TABLE = [0x0000, 0xcc01, 0xd801, 0x1400, 0xf001, 0x3c00, 0x2800, 0xe401, 0xa001, 0x6c00, 0x7800, 0xb401, 0x5000, 0x9c01, 0x8801, 0x4400];

/** The FIT checksum (CRC-16/ARC). */
export function fitCrc(bytes: ArrayLike<number>): number {
  let crc = 0;
  for (let i = 0; i < bytes.length; i++) {
    const byte = bytes[i];
    let tmp = CRC_TABLE[crc & 0xf];
    crc = ((crc >> 4) & 0x0fff) ^ tmp ^ CRC_TABLE[byte & 0xf];
    tmp = CRC_TABLE[crc & 0xf];
    crc = ((crc >> 4) & 0x0fff) ^ tmp ^ CRC_TABLE[(byte >> 4) & 0xf];
  }
  return crc;
}
