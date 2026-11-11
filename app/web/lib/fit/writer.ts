// The bytes of a FIT file: definition and data messages, the header and both checksums. Shared by
// the ride (activity) and workout writers. No browser or Node APIs, so it runs and tests anywhere.

const BASE = { enum: 0x00, uint8: 0x02, uint16: 0x84, sint32: 0x85, uint32: 0x86, uint32z: 0x8c, string16: 0x07, string32: 0x07 } as const;
export type BaseType = keyof typeof BASE;
const SIZE: Record<BaseType, number> = { enum: 1, uint8: 1, uint16: 2, sint32: 4, uint32: 4, uint32z: 4, string16: 16, string32: 32 };
const INVALID: Record<BaseType, number> = { enum: 0xff, uint8: 0xff, uint16: 0xffff, sint32: 0x7fffffff, uint32: 0xffffffff, uint32z: 0, string16: 0, string32: 0 };

export type FieldSpec = [num: number, type: BaseType];
export interface FitMessage {
  local: number;
  global: number;
  fields: FieldSpec[];
}

/** Seconds between the Unix epoch and the FIT epoch (1989-12-31T00:00:00Z). */
export const FIT_EPOCH = 631065600;

/** Collects messages; `finish` wraps them into a whole file. A null value writes the field's "invalid". */
export function fitWriter() {
  const body: number[] = [];
  const push = (value: number, size: number) => {
    for (let i = 0; i < size; i++) body.push((value >>> (8 * i)) & 0xff);
  };
  const defined = new Set<number>();
  const write = (message: FitMessage, values: (number | string | null)[]) => {
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
  const finish = (): Uint8Array => {
    const header = [14, 0x20, 0x54, 0x08, ...[0, 8, 16, 24].map((s) => (body.length >>> s) & 0xff), ...[...".FIT"].map((c) => c.charCodeAt(0))];
    const headerCrc = fitCrc(header);
    const file = [...header, headerCrc & 0xff, headerCrc >> 8, ...body];
    const fileCrc = fitCrc(file);
    file.push(fileCrc & 0xff, fileCrc >> 8);
    return Uint8Array.from(file);
  };
  return { write, finish };
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
