// Pure parsers and encoders for the BLE cycling profiles we use. No Web Bluetooth here, so it's testable in Node.

export const GATT = {
  service: {
    fitnessMachine: 0x1826,
    heartRate: 0x180d,
    cyclingPower: 0x1818,
  },
  characteristic: {
    indoorBikeData: 0x2ad2,
    fitnessMachineControlPoint: 0x2ad9,
    fitnessMachineStatus: 0x2ada,
    heartRateMeasurement: 0x2a37,
    cyclingPowerMeasurement: 0x2a63,
  },
} as const;

/** Reads little-endian fields in order; each read returns undefined once the data runs out. */
class Reader {
  private offset = 0;
  constructor(private readonly view: DataView) {}

  get remaining() {
    return this.view.byteLength - this.offset;
  }
  private take<T>(size: number, read: (at: number) => T): T | undefined {
    if (this.remaining < size) return undefined;
    const value = read(this.offset);
    this.offset += size;
    return value;
  }
  uint8 = () => this.take(1, (at) => this.view.getUint8(at));
  uint16 = () => this.take(2, (at) => this.view.getUint16(at, true));
  int16 = () => this.take(2, (at) => this.view.getInt16(at, true));
  uint24 = () => this.take(3, (at) => this.view.getUint16(at, true) | (this.view.getUint8(at + 2) << 16));
  skip(size: number) {
    this.offset = Math.min(this.offset + size, this.view.byteLength);
  }
}

const viewOf = (data: DataView | ArrayLike<number>) =>
  data instanceof DataView ? data : new DataView(Uint8Array.from(data).buffer);

export interface IndoorBikeData {
  speedKph?: number;
  averageSpeedKph?: number;
  cadenceRpm?: number;
  averageCadenceRpm?: number;
  totalDistanceMeters?: number;
  resistanceLevel?: number;
  powerWatts?: number;
  averagePowerWatts?: number;
  heartRate?: number;
  elapsedSeconds?: number;
}

/** FTMS Indoor Bike Data (0x2AD2) notification. */
export function parseIndoorBikeData(data: DataView | ArrayLike<number>): IndoorBikeData | null {
  const r = new Reader(viewOf(data));
  const flags = r.uint16();
  if (flags === undefined) return null;
  const has = (bit: number) => (flags & (1 << bit)) !== 0;
  const scaled = (v: number | undefined, f: number) => (v === undefined ? undefined : v / f);

  const out: IndoorBikeData = {};
  // Bit 0 is "More Data": instantaneous speed is present when it is 0.
  if (!has(0)) out.speedKph = scaled(r.uint16(), 100);
  if (has(1)) out.averageSpeedKph = scaled(r.uint16(), 100);
  if (has(2)) out.cadenceRpm = scaled(r.uint16(), 2);
  if (has(3)) out.averageCadenceRpm = scaled(r.uint16(), 2);
  if (has(4)) out.totalDistanceMeters = r.uint24();
  if (has(5)) out.resistanceLevel = r.int16();
  if (has(6)) out.powerWatts = r.int16();
  if (has(7)) out.averagePowerWatts = r.int16();
  if (has(8)) r.skip(5); // total energy (2), energy per hour (2), energy per minute (1)
  if (has(9)) out.heartRate = r.uint8();
  if (has(10)) r.skip(1); // metabolic equivalent
  if (has(11)) out.elapsedSeconds = r.uint16();
  return out;
}

export const ControlOp = {
  requestControl: 0x00,
  reset: 0x01,
  setTargetResistance: 0x04,
  setTargetPower: 0x05,
  startOrResume: 0x07,
  stopOrPause: 0x08,
  setIndoorBikeSimulation: 0x11,
  response: 0x80,
} as const;

export const ControlResult = {
  success: 0x01,
  notSupported: 0x02,
  invalidParameter: 0x03,
  operationFailed: 0x04,
  controlNotPermitted: 0x05,
} as const;

const clampInt16 = (v: number) => Math.max(-32768, Math.min(32767, Math.round(v)));
const clampUint8 = (v: number) => Math.max(0, Math.min(255, Math.round(v)));

export const controlPoint = {
  requestControl: () => Uint8Array.of(ControlOp.requestControl),
  startOrResume: () => Uint8Array.of(ControlOp.startOrResume),
  /** ERG mode: hold this many watts regardless of cadence. */
  setTargetPower(watts: number) {
    const bytes = new Uint8Array(3);
    const view = new DataView(bytes.buffer);
    bytes[0] = ControlOp.setTargetPower;
    view.setInt16(1, clampInt16(watts), true);
    return bytes;
  },
  /** Simulation (slope) mode. Grade in percent, wind in m/s. */
  setSimulation(gradePercent: number, windSpeed = 0, rollingResistance = 0.004, windResistance = 0.51) {
    const bytes = new Uint8Array(7);
    const view = new DataView(bytes.buffer);
    bytes[0] = ControlOp.setIndoorBikeSimulation;
    view.setInt16(1, clampInt16(windSpeed * 1000), true);
    view.setInt16(3, clampInt16(gradePercent * 100), true);
    bytes[5] = clampUint8(rollingResistance * 10000);
    bytes[6] = clampUint8(windResistance * 100);
    return bytes;
  },
};

export interface ControlResponse {
  request: number;
  result: number;
  succeeded: boolean;
}

export function parseControlResponse(data: DataView | ArrayLike<number>): ControlResponse | null {
  const r = new Reader(viewOf(data));
  if (r.uint8() !== ControlOp.response) return null;
  const request = r.uint8();
  const result = r.uint8();
  if (request === undefined || result === undefined) return null;
  return { request, result, succeeded: result === ControlResult.success };
}

export interface HeartRateMeasurement {
  bpm: number;
  /** R-R intervals in milliseconds, when the strap sends them. */
  rrIntervalsMs: number[];
}

/** Heart Rate Measurement (0x2A37) notification. */
export function parseHeartRate(data: DataView | ArrayLike<number>): HeartRateMeasurement | null {
  const r = new Reader(viewOf(data));
  const flags = r.uint8();
  if (flags === undefined) return null;
  const bpm = flags & 0x01 ? r.uint16() : r.uint8();
  if (bpm === undefined) return null;
  if (flags & 0x08) r.skip(2); // energy expended
  const rrIntervalsMs: number[] = [];
  if (flags & 0x10) {
    for (let rr = r.uint16(); rr !== undefined; rr = r.uint16()) rrIntervalsMs.push((rr * 1000) / 1024);
  }
  return { bpm, rrIntervalsMs };
}

export interface CyclingPowerMeasurement {
  watts: number;
  /** Right/left balance in percent, when the meter reports it. */
  pedalBalancePercent?: number;
  cumulativeCrankRevolutions?: number;
  /** Last crank event time in 1/1024 s; wraps at 64 s. */
  lastCrankEventTime?: number;
}

/** Cycling Power Measurement (0x2A63) notification. */
export function parseCyclingPower(data: DataView | ArrayLike<number>): CyclingPowerMeasurement | null {
  const r = new Reader(viewOf(data));
  const flags = r.uint16();
  const watts = r.int16();
  if (flags === undefined || watts === undefined) return null;
  const has = (bit: number) => (flags & (1 << bit)) !== 0;
  const out: CyclingPowerMeasurement = { watts };
  if (has(0)) {
    const balance = r.uint8();
    if (balance !== undefined) out.pedalBalancePercent = balance / 2;
  }
  if (has(2)) r.skip(2); // accumulated torque
  if (has(4)) r.skip(6); // wheel revolutions (4) + last wheel event time (2)
  if (has(5)) {
    out.cumulativeCrankRevolutions = r.uint16();
    out.lastCrankEventTime = r.uint16();
  }
  return out;
}

/** Cadence between two power measurements, handling 16-bit wraparound. Null if the crank didn't turn. */
export function crankCadence(previous: CyclingPowerMeasurement, current: CyclingPowerMeasurement): number | null {
  const { cumulativeCrankRevolutions: r0, lastCrankEventTime: t0 } = previous;
  const { cumulativeCrankRevolutions: r1, lastCrankEventTime: t1 } = current;
  if (r0 === undefined || r1 === undefined || t0 === undefined || t1 === undefined) return null;
  const revs = (r1 - r0 + 0x10000) % 0x10000;
  const ticks = (t1 - t0 + 0x10000) % 0x10000;
  if (revs === 0 || ticks === 0) return null;
  return (revs / (ticks / 1024)) * 60;
}
