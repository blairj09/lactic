import { describe, expect, it } from "vitest";
import { decodeBodyComposition, decodeEsf551, decodeMiBodyScale, decodeMiScale, decodeQnFrame, decodeWeightMeasurement, qnEndCommand, qnTimeCommand, qnUnitCommand } from "./decoders";

const date = [0xea, 0x07, 11, 7, 8, 30, 0]; // 2026-11-07 08:30:00

describe("standard Bluetooth weight scale", () => {
  it("reads kilograms at 5 g resolution, with and without a timestamp", () => {
    expect(decodeWeightMeasurement([0x00, 0x20, 0x3a])).toEqual({ kg: 74.4, at: null, userId: null });
    const m = decodeWeightMeasurement([0x06, 0x20, 0x3a, ...date, 1]);
    expect(m?.kg).toBe(74.4);
    expect(m?.at?.getFullYear()).toBe(2026);
    expect(m?.userId).toBe(1);
  });

  it("converts pounds and skips unsuccessful measurements", () => {
    expect(decodeWeightMeasurement([0x01, 0x10, 0x40])?.kg).toBe(74.39);
    expect(decodeWeightMeasurement([0x00, 0xff, 0xff])).toBeNull();
  });

  it("reads body fat, impedance and weight from body composition", () => {
    expect(decodeBodyComposition([0x00, 0x06, 0xb9, 0x00, 0x03, 0x14, 0x20, 0x3a])).toEqual({ bodyFatPercent: 18.5, kg: 74.4, impedanceOhms: 512.3, at: null, multiPacket: false });
  });

  it("skips the optional fields it doesn't use to find weight", () => {
    // Timestamp, user, BMR and muscle percentage before the weight.
    const flags = 0x0002 | 0x0004 | 0x0008 | 0x0010 | 0x0400;
    const m = decodeBodyComposition([flags & 0xff, flags >> 8, 0xc8, 0x00, ...date, 1, 0x10, 0x27, 0x90, 0x01, 0x20, 0x3a]);
    expect(m).toMatchObject({ bodyFatPercent: 20, kg: 74.4 });
  });
});

describe("Xiaomi", () => {
  it("reads the Mi Smart Scale broadcast", () => {
    expect(decodeMiScale([0x20, 0x20, 0x3a, ...date])).toEqual({ kg: 74.4, stable: true, removed: false, impedanceOhms: null });
    expect(decodeMiScale([0xa0, 0x20, 0x3a, ...date])?.removed).toBe(true);
    expect(decodeMiScale([0x00, 0x20, 0x3a, ...date])?.stable).toBe(false);
  });

  it("reads the Body Composition Scale broadcast with impedance", () => {
    expect(decodeMiBodyScale([0x02, 0x26, ...date, 0xf4, 0x01, 0x20, 0x3a])).toEqual({ kg: 74.4, stable: true, removed: false, impedanceOhms: 500 });
    expect(decodeMiBodyScale([0x02, 0x24, ...date, 0x00, 0x00, 0x20, 0x3a])?.impedanceOhms).toBeNull();
  });
});

describe("QN scales", () => {
  it("reads weight frames in 0.01 kg, and 0.1 kg on older models", () => {
    expect(decodeQnFrame([0x10, 0x0b, 0x15, 0x1d, 0x10, 0x01, 0x01, 0xf4, 0x01, 0xc2, 0])).toEqual({ kind: "weight", kg: 74.4, final: true, resistance: 500 });
    expect(decodeQnFrame([0x10, 0x0b, 0x15, 0x02, 0xe8, 0x00, 0x00, 0x00, 0x00, 0x00, 0])).toEqual({ kind: "weight", kg: 74.4, final: false, resistance: null });
  });

  it("recognises the scale's requests", () => {
    expect(decodeQnFrame([0x12, 0x0f, 0xff, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0])).toEqual({ kind: "unitRequest", vendor: 0xff });
    expect(decodeQnFrame([0x14, 0x0b, 0x15, 0, 0, 0, 0, 0, 0, 0, 0])).toEqual({ kind: "timeRequest", vendor: 0x15 });
  });

  it("builds replies that echo the vendor byte and end in a sum", () => {
    expect(Array.from(qnUnitCommand(0x15))).toEqual([0x13, 0x09, 0x15, 0x01, 0x10, 0x28, 0x37, 0x00, 0xa1]);
    expect(Array.from(qnEndCommand(0x15))).toEqual([0x1f, 0x05, 0x15, 0x10, 0x49]);
    const t = qnTimeCommand(0x15, new Date(946_656_000_000 + 256_000));
    expect(Array.from(t)).toEqual([0x20, 0x08, 0x15, 0x00, 0x01, 0x00, 0x00, 0x3e]);
  });
});

describe("Etekcity ESF-551", () => {
  const frame = (stable: boolean, imp: boolean) => [0xa5, 0x02, 0x07, 0x10, 0x00, 0x00, 0x01, 0x61, 0xa1, 0x00, 0xa0, 0x22, 0x01, 0xf4, 0x01, 0, 0, 0, 0, stable ? 1 : 0, imp ? 1 : 0, 0];

  it("reads weight in grams and impedance when measured", () => {
    expect(decodeEsf551(frame(true, true))).toEqual({ kg: 74.4, stable: true, impedanceOhms: 500 });
    expect(decodeEsf551(frame(false, false))).toEqual({ kg: 74.4, stable: false, impedanceOhms: null });
  });

  it("ignores other frames", () => {
    expect(decodeEsf551(frame(true, true).slice(0, 20))).toBeNull();
    expect(decodeEsf551([0x10, ...frame(true, true).slice(1)])).toBeNull();
  });
});
