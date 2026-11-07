import { describe, expect, it } from "vitest";
import {
  ControlOp,
  controlPoint,
  crankCadence,
  parseControlResponse,
  parseCyclingPower,
  parseHeartRate,
  parseIndoorBikeData,
} from "./protocol";

describe("FTMS indoor bike data", () => {
  it("parses speed, cadence and power", () => {
    // flags 0x0044: speed present (bit 0 clear), cadence (bit 2), power (bit 6)
    // speed 3250 = 32.50 km/h, cadence 180 = 90 rpm, power 250 W
    const data = [0x44, 0x00, 0xb2, 0x0c, 0xb4, 0x00, 0xfa, 0x00];
    expect(parseIndoorBikeData(data)).toEqual({ speedKph: 32.5, cadenceRpm: 90, powerWatts: 250 });
  });

  it("skips energy fields to reach heart rate and elapsed time", () => {
    // flags: speed (bit 0 clear), power (6), energy (8), heart rate (9), elapsed time (11)
    const flags = (1 << 6) | (1 << 8) | (1 << 9) | (1 << 11);
    const data = [flags & 0xff, flags >> 8, 0x10, 0x27, 0x2c, 0x01, 1, 0, 2, 0, 3, 142, 0x3c, 0x00];
    expect(parseIndoorBikeData(data)).toEqual({ speedKph: 100, powerWatts: 300, heartRate: 142, elapsedSeconds: 60 });
  });

  it("tolerates truncated packets", () => {
    expect(parseIndoorBikeData([0x44, 0x00, 0xb2])).toEqual({ speedKph: undefined, cadenceRpm: undefined, powerWatts: undefined });
    expect(parseIndoorBikeData([0x44])).toBeNull();
  });
});

describe("FTMS control point", () => {
  it("encodes ERG target power little-endian", () => {
    expect(Array.from(controlPoint.setTargetPower(250))).toEqual([ControlOp.setTargetPower, 0xfa, 0x00]);
    expect(Array.from(controlPoint.setTargetPower(1000))).toEqual([ControlOp.setTargetPower, 0xe8, 0x03]);
  });

  it("encodes simulation grade", () => {
    // grade 5% = 500 = 0x01F4; crr 0.004 = 40; cw 0.51 = 51
    expect(Array.from(controlPoint.setSimulation(5))).toEqual([0x11, 0, 0, 0xf4, 0x01, 40, 51]);
    // negative grade -2.5% = -250 = 0xFF06
    expect(Array.from(controlPoint.setSimulation(-2.5)).slice(3, 5)).toEqual([0x06, 0xff]);
  });

  it("parses responses", () => {
    expect(parseControlResponse([0x80, 0x00, 0x01])).toEqual({ request: 0, result: 1, succeeded: true });
    expect(parseControlResponse([0x80, 0x05, 0x05])?.succeeded).toBe(false);
    expect(parseControlResponse([0x05, 0x00, 0x01])).toBeNull();
  });
});

describe("heart rate", () => {
  it("parses 8-bit heart rate with R-R intervals", () => {
    // flags 0x10: uint8 HR, RR present. RR 1024 = 1000 ms, 768 = 750 ms
    expect(parseHeartRate([0x10, 72, 0x00, 0x04, 0x00, 0x03])).toEqual({ bpm: 72, rrIntervalsMs: [1000, 750] });
  });

  it("parses 16-bit heart rate and skips energy expended", () => {
    expect(parseHeartRate([0x09, 0x2c, 0x01, 0x10, 0x00])).toEqual({ bpm: 300, rrIntervalsMs: [] });
  });
});

describe("cycling power", () => {
  it("parses power, balance and crank data", () => {
    // flags: balance (bit 0) + crank (bit 5); 245 W; balance 100 = 50%; revs 10; time 2048
    const data = [0x21, 0x00, 0xf5, 0x00, 100, 10, 0, 0x00, 0x08];
    expect(parseCyclingPower(data)).toEqual({
      watts: 245,
      pedalBalancePercent: 50,
      cumulativeCrankRevolutions: 10,
      lastCrankEventTime: 2048,
    });
  });

  it("computes cadence across counter wraparound", () => {
    const previous = { watts: 0, cumulativeCrankRevolutions: 65535, lastCrankEventTime: 65000 };
    // 2 revolutions in 1280 ticks (1.25 s) = 96 rpm
    const current = { watts: 0, cumulativeCrankRevolutions: 1, lastCrankEventTime: (65000 + 1280) % 65536 };
    expect(crankCadence(previous, current)).toBeCloseTo(96);
    expect(crankCadence(current, current)).toBeNull();
  });
});
