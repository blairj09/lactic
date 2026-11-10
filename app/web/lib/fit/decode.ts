// A small decoder for Garmin FIT activity files (Karoo, Zwift, Wahoo, Garmin). It reads only the
// messages a ride needs and skips the rest. No browser or Node APIs, so it runs and tests anywhere.

export const FIT_MANUFACTURER = { garmin: 1, wahoo: 32, zwift: 260, hammerhead: 289 } as const;
export const FIT_SPORT_CYCLING = 2;

export interface FitRecord {
  timestamp: Date;
  power?: number;
  heartRate?: number;
  cadence?: number;
  /** Meters from the start. */
  distance?: number;
  /** Meters per second. */
  speed?: number;
  /** Meters. */
  altitude?: number;
  /** Degrees. */
  lat?: number;
  lng?: number;
}

export interface FitActivity {
  manufacturer?: number;
  product?: number;
  serialNumber?: number;
  timeCreated?: Date;
  sport?: number;
  subSport?: number;
  startTime?: Date;
  totalElapsedSeconds?: number;
  totalTimerSeconds?: number;
  totalDistanceMeters?: number;
  records: FitRecord[];
  /** Laps in file order. */
  laps: FitLap[];
}

export interface FitLap {
  startTime: Date;
  totalElapsedSeconds?: number;
  averagePower?: number;
  maxPower?: number;
  averageHeartRate?: number;
}

// Seconds between the Unix epoch and the FIT epoch (1989-12-31T00:00:00Z).
const FIT_EPOCH = 631065600;

const MESSAGE = { fileId: 0, session: 18, lap: 19, record: 20 } as const;
const TIMESTAMP_FIELD = 253;

interface FieldDefinition {
  num: number;
  size: number;
  baseType: number;
}

interface Definition {
  global: number;
  littleEndian: boolean;
  fields: FieldDefinition[];
  developerBytes: number;
}

export function decodeFit(bytes: Uint8Array): FitActivity {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const activity: FitActivity = { records: [], laps: [] };
  let offset = 0;
  // A file can hold several FIT sections back to back; read them all.
  while (offset + 12 <= bytes.length) {
    const headerSize = view.getUint8(offset);
    if (headerSize < 12 || String.fromCharCode(...bytes.subarray(offset + 8, offset + 12)) !== ".FIT") {
      if (offset === 0) throw new Error("Not a FIT file");
      break;
    }
    const dataSize = view.getUint32(offset + 4, true);
    const end = Math.min(offset + headerSize + dataSize, bytes.length);
    readSection(view, offset + headerSize, end, activity);
    offset = end + 2; // CRC
  }
  activity.records.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
  return activity;
}

function readSection(view: DataView, start: number, end: number, activity: FitActivity) {
  const definitions = new Map<number, Definition>();
  let lastTimestamp = 0;
  let offset = start;

  while (offset < end) {
    const header = view.getUint8(offset++);

    if (header & 0x80) {
      // Compressed timestamp header: a data message whose time is a 5 bit offset from the last one.
      const definition = definitions.get((header >> 5) & 0x03);
      if (!definition) throw new Error("FIT data before its definition");
      const timeOffset = header & 0x1f;
      lastTimestamp += (timeOffset - (lastTimestamp & 0x1f)) & 0x1f;
      const values = readFields(view, offset, definition);
      offset += messageSize(definition);
      if (!values.has(TIMESTAMP_FIELD)) values.set(TIMESTAMP_FIELD, lastTimestamp);
      apply(definition.global, values, activity);
      continue;
    }

    const local = header & 0x0f;
    if (header & 0x40) {
      const littleEndian = view.getUint8(offset + 1) === 0;
      const global = view.getUint16(offset + 2, littleEndian);
      const count = view.getUint8(offset + 4);
      offset += 5;
      const fields: FieldDefinition[] = [];
      for (let i = 0; i < count; i++, offset += 3) {
        fields.push({ num: view.getUint8(offset), size: view.getUint8(offset + 1), baseType: view.getUint8(offset + 2) });
      }
      let developerBytes = 0;
      if (header & 0x20) {
        const developerCount = view.getUint8(offset++);
        for (let i = 0; i < developerCount; i++, offset += 3) developerBytes += view.getUint8(offset + 1);
      }
      definitions.set(local, { global, littleEndian, fields, developerBytes });
      continue;
    }

    const definition = definitions.get(local);
    if (!definition) throw new Error("FIT data before its definition");
    const values = readFields(view, offset, definition);
    offset += messageSize(definition);
    const timestamp = values.get(TIMESTAMP_FIELD);
    if (timestamp !== undefined) lastTimestamp = timestamp;
    apply(definition.global, values, activity);
  }
}

const messageSize = (d: Definition) => d.fields.reduce((sum, f) => sum + f.size, 0) + d.developerBytes;

/** Reads the scalar numeric fields of one data message; invalid values and arrays are left out. */
function readFields(view: DataView, start: number, definition: Definition): Map<number, number> {
  const values = new Map<number, number>();
  let offset = start;
  for (const field of definition.fields) {
    const value = readScalar(view, offset, field, definition.littleEndian);
    if (value !== undefined) values.set(field.num, value);
    offset += field.size;
  }
  return values;
}

function readScalar(view: DataView, offset: number, field: FieldDefinition, le: boolean): number | undefined {
  if (offset + field.size > view.byteLength) return undefined;
  switch (field.baseType & 0x1f) {
    case 0x00: // enum
    case 0x02: // uint8
    case 0x0d: // byte
      return field.size === 1 ? valid(view.getUint8(offset), 0xff) : undefined;
    case 0x0a: // uint8z
      return field.size === 1 ? valid(view.getUint8(offset), 0) : undefined;
    case 0x01:
      return field.size === 1 ? valid(view.getInt8(offset), 0x7f) : undefined;
    case 0x03:
      return field.size === 2 ? valid(view.getInt16(offset, le), 0x7fff) : undefined;
    case 0x04:
      return field.size === 2 ? valid(view.getUint16(offset, le), 0xffff) : undefined;
    case 0x0b: // uint16z
      return field.size === 2 ? valid(view.getUint16(offset, le), 0) : undefined;
    case 0x05:
      return field.size === 4 ? valid(view.getInt32(offset, le), 0x7fffffff) : undefined;
    case 0x06:
      return field.size === 4 ? valid(view.getUint32(offset, le), 0xffffffff) : undefined;
    case 0x0c: // uint32z
      return field.size === 4 ? valid(view.getUint32(offset, le), 0) : undefined;
    case 0x08: {
      if (field.size !== 4) return undefined;
      const v = view.getFloat32(offset, le);
      return Number.isFinite(v) ? v : undefined;
    }
    case 0x09: {
      if (field.size !== 8) return undefined;
      const v = view.getFloat64(offset, le);
      return Number.isFinite(v) ? v : undefined;
    }
    default:
      return undefined; // strings and 64 bit integers: nothing we need
  }
}

const valid = (value: number, invalid: number) => (value === invalid ? undefined : value);
const fitDate = (seconds: number) => new Date((seconds + FIT_EPOCH) * 1000);
const scaled = (value: number | undefined, scale: number, offset = 0) => (value === undefined ? undefined : value / scale - offset);

function apply(global: number, v: Map<number, number>, activity: FitActivity) {
  switch (global) {
    case MESSAGE.fileId: {
      activity.manufacturer ??= v.get(1);
      activity.product ??= v.get(2);
      activity.serialNumber ??= v.get(3);
      const created = v.get(4);
      if (created !== undefined) activity.timeCreated ??= fitDate(created);
      break;
    }
    case MESSAGE.session: {
      // The first session describes the ride; multisport files are rare for cycling.
      if (activity.startTime) break;
      const start = v.get(2);
      if (start !== undefined) activity.startTime = fitDate(start);
      activity.sport = v.get(5);
      activity.subSport = v.get(6);
      activity.totalElapsedSeconds = scaled(v.get(7), 1000);
      activity.totalTimerSeconds = scaled(v.get(8), 1000);
      activity.totalDistanceMeters = scaled(v.get(9), 100);
      break;
    }
    case MESSAGE.lap: {
      const start = v.get(2);
      if (start === undefined) break;
      activity.laps.push({ startTime: fitDate(start), totalElapsedSeconds: scaled(v.get(7), 1000), averagePower: v.get(19), maxPower: v.get(20), averageHeartRate: v.get(15) });
      break;
    }
    case MESSAGE.record: {
      const timestamp = v.get(TIMESTAMP_FIELD);
      if (timestamp === undefined) break;
      activity.records.push({
        timestamp: fitDate(timestamp),
        power: v.get(7),
        heartRate: v.get(3),
        cadence: v.get(4),
        distance: scaled(v.get(5), 100),
        speed: scaled(v.get(73), 1000) ?? scaled(v.get(6), 1000),
        altitude: scaled(v.get(78), 5, 500) ?? scaled(v.get(2), 5, 500),
        lat: degrees(v.get(0)),
        lng: degrees(v.get(1)),
      });
      break;
    }
  }
}

/** Semicircles (2^31 per 180 degrees) to degrees. */
const degrees = (semicircles: number | undefined) => (semicircles === undefined ? undefined : (semicircles * 180) / 2 ** 31);
