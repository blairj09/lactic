// Writes a ride recorded here as a FIT activity file, so it can go to intervals.icu like any head
// unit's file. 1 Hz records of power, heart rate and cadence, one lap and one indoor cycling session.
// No browser or Node APIs, so it runs and tests anywhere.

import { FIT_SPORT_CYCLING } from "./decode";

/** Seconds between the Unix epoch and the FIT epoch (1989-12-31T00:00:00Z). */
const FIT_EPOCH = 631065600;
/** FIT's manufacturer id for software that isn't a registered device. */
export const FIT_MANUFACTURER_DEVELOPMENT = 255;
const SUB_SPORT_INDOOR_CYCLING = 6;

export interface RideSamples {
  startedAt: Date;
  /** One value per second; heart rate 0 means no reading. */
  watts: number[];
  heartRate: number[];
  cadence: number[];
}

const BASE = { enum: 0x00, uint8: 0x02, uint16: 0x84, uint32: 0x86, uint32z: 0x8c } as const;
type BaseType = keyof typeof BASE;
const SIZE: Record<BaseType, number> = { enum: 1, uint8: 1, uint16: 2, uint32: 4, uint32z: 4 };
const INVALID: Record<BaseType, number> = { enum: 0xff, uint8: 0xff, uint16: 0xffff, uint32: 0xffffffff, uint32z: 0 };

type FieldSpec = [num: number, type: BaseType];

const MESSAGES = {
  fileId: { local: 0, global: 0, fields: [[0, "enum"], [1, "uint16"], [2, "uint16"], [3, "uint32z"], [4, "uint32"]] },
  event: { local: 1, global: 21, fields: [[253, "uint32"], [0, "enum"], [1, "enum"]] },
  record: { local: 2, global: 20, fields: [[253, "uint32"], [7, "uint16"], [3, "uint8"], [4, "uint8"]] },
  lap: { local: 3, global: 19, fields: [[253, "uint32"], [2, "uint32"], [7, "uint32"], [8, "uint32"], [0, "enum"], [1, "enum"]] },
  session: {
    local: 4,
    global: 18,
    fields: [[253, "uint32"], [2, "uint32"], [7, "uint32"], [8, "uint32"], [5, "enum"], [6, "enum"], [25, "uint16"], [26, "uint16"], [0, "enum"], [1, "enum"]],
  },
  activity: { local: 5, global: 34, fields: [[253, "uint32"], [0, "uint32"], [1, "uint16"], [2, "enum"], [3, "enum"], [4, "enum"]] },
} satisfies Record<string, { local: number; global: number; fields: FieldSpec[] }>;

type Message = (typeof MESSAGES)[keyof typeof MESSAGES];

export function encodeRideFit(ride: RideSamples): Uint8Array {
  const body: number[] = [];
  const push = (value: number, size: number) => {
    for (let i = 0; i < size; i++) body.push((value >>> (8 * i)) & 0xff);
  };
  const defined = new Set<number>();
  const write = (message: Message, values: (number | null)[]) => {
    if (!defined.has(message.local)) {
      defined.add(message.local);
      body.push(0x40 | message.local, 0, 0); // definition, reserved, little endian
      push(message.global, 2);
      body.push(message.fields.length);
      for (const [num, type] of message.fields) body.push(num, SIZE[type], BASE[type]);
    }
    body.push(message.local);
    message.fields.forEach(([, type], i) => push(values[i] ?? INVALID[type], SIZE[type]));
  };

  const start = Math.round(ride.startedAt.getTime() / 1000) - FIT_EPOCH;
  const seconds = ride.watts.length;
  const end = start + Math.max(seconds - 1, 0);
  const millis = seconds * 1000;
  const reading = (v: number | undefined, max: number) => (v !== undefined && Number.isFinite(v) && v >= 0 ? Math.min(Math.round(v), max) : null);

  write(MESSAGES.fileId, [4, FIT_MANUFACTURER_DEVELOPMENT, 0, 1, start]);
  write(MESSAGES.event, [start, 0, 0]); // timer start
  for (let i = 0; i < seconds; i++) {
    const hr = reading(ride.heartRate[i], 254);
    write(MESSAGES.record, [start + i, reading(ride.watts[i], 0xfffe), hr === 0 ? null : hr, reading(ride.cadence[i], 254)]);
  }
  write(MESSAGES.event, [end, 0, 4]); // timer stop all
  write(MESSAGES.lap, [end, start, millis, millis, 9, 1]);
  write(MESSAGES.session, [end, start, millis, millis, FIT_SPORT_CYCLING, SUB_SPORT_INDOOR_CYCLING, 0, 1, 8, 1]);
  write(MESSAGES.activity, [end, millis, 1, 0, 26, 1]);

  const header = [14, 0x20, 0x54, 0x08, ...[0, 8, 16, 24].map((s) => (body.length >>> s) & 0xff), ...[...".FIT"].map((c) => c.charCodeAt(0))];
  const headerCrc = fitCrc(header);
  const file = [...header, headerCrc & 0xff, headerCrc >> 8, ...body];
  const fileCrc = fitCrc(file);
  file.push(fileCrc & 0xff, fileCrc >> 8);
  return Uint8Array.from(file);
}

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
