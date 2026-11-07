// Hume Body Pod (a Lefu-based scale) over BLE. Packet layouts are from the community notes behind
// github.com/danfulton72/hume_pod_ha; this decoder is our own. Pure: no browser or Node APIs.

export const BODY_POD = {
  service: 0xfff0,
  /** Write the user profile here to start a measurement. */
  profile: 0xfff1,
  /** Secondary notifications on some firmware. */
  secondary: 0xfff2,
  /** Weight and impedance notifications. */
  notify: 0xfff4,
} as const;

export interface ScaleProfile {
  male: boolean;
  age: number;
  heightCm: number;
  /** 0 sedentary, 1 moderate, 2 active. */
  activity?: 0 | 1 | 2;
}

/** FE, user id, sex, activity, height cm, age, unit (1 = kg), XOR of bytes 1 to 6. */
export function profileCommand({ male, age, heightCm, activity = 2 }: ScaleProfile): Uint8Array<ArrayBuffer> {
  const clamp = (v: number) => Math.min(Math.max(Math.round(v), 0), 255);
  const body = [0x01, male ? 1 : 0, activity, clamp(heightCm), clamp(age), 0x01];
  return Uint8Array.from([0xfe, ...body, body.reduce((x, b) => x ^ b, 0)]);
}

/** Segment order in impedance packets. */
export const SEGMENTS = ["rightArm", "leftArm", "trunk", "rightLeg", "leftLeg"] as const;
export type Segments = Record<(typeof SEGMENTS)[number], number>;

export type ScalePacket =
  | { kind: "weight"; kg: number; locked: boolean }
  | { kind: "impedance"; /** 0 is about 50 kHz, 1 about 250 kHz. */ frequency: number; ohms: Segments }
  | { kind: "other"; header: number };

const le16 = (d: Uint8Array, at: number) => d[at] | (d[at + 1] << 8);

export function decodeScalePacket(data: Uint8Array): ScalePacket | null {
  if (data.length === 0) return null;
  const header = data[0];
  if (header === 0xcf && data.length >= 5) {
    // Firmware signals a settled weight either with bit 7 of byte 2, or (Body Pod 2) byte 9 going 01 -> 00.
    const locked = (data[2] & 0x80) !== 0 || (data.length === 11 && data[9] === 0);
    return { kind: "weight", kg: le16(data, 3) / 100, locked };
  }
  if (header === 0xbe && data.length >= 12) {
    const ohms = Object.fromEntries(SEGMENTS.map((s, i) => [s, le16(data, 2 + i * 2) / 10])) as Segments;
    return { kind: "impedance", frequency: data[1], ohms };
  }
  return { kind: "other", header };
}

const MIN_WEIGHT_KG = 5;

/** Collects one weigh-in from the stream of notifications. */
export class WeighInSession {
  liveKg: number | null = null;
  lockedKg: number | null = null;
  impedance: Partial<Record<number, Segments>> = {};
  private last = "";

  feed(data: Uint8Array): ScalePacket | null {
    // The scale repeats packets; skip exact repeats.
    const key = Array.from(data).join(",");
    if (key === this.last) return null;
    this.last = key;
    const packet = decodeScalePacket(data);
    if (packet?.kind === "weight" && packet.kg > MIN_WEIGHT_KG) {
      this.liveKg = packet.kg;
      if (packet.locked) this.lockedKg = packet.kg;
    }
    if (packet?.kind === "impedance") this.impedance[packet.frequency] = packet.ohms;
    return packet;
  }

  get weightKg() {
    return this.lockedKg ?? this.liveKg;
  }

  get hasImpedance() {
    return this.impedance[0] !== undefined && this.impedance[1] !== undefined;
  }
}
