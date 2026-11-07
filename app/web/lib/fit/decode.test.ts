import { describe, expect, it } from "vitest";
import { decodeFit, FIT_MANUFACTURER } from "./decode";
import { rideFromFit } from "./ride";

const FIT_EPOCH = 631065600;
const fitTime = (iso: string) => Date.parse(iso) / 1000 - FIT_EPOCH;

type Field = { num: number; size: number; baseType: number; value: number };

/** Builds a minimal FIT file: one definition per message type, little endian, CRC left as zero. */
function encodeFit(messages: { local: number; global: number; fields: Field[]; compressedOffset?: number }[]): Uint8Array {
  const body: number[] = [];
  const defined = new Set<number>();
  const push = (value: number, size: number) => {
    for (let i = 0; i < size; i++) body.push((value >>> (8 * i)) & 0xff);
  };
  for (const m of messages) {
    if (!defined.has(m.local)) {
      defined.add(m.local);
      body.push(0x40 | m.local, 0, 0);
      push(m.global, 2);
      const fields = m.fields.filter((f) => !(m.compressedOffset !== undefined && f.num === 253));
      body.push(fields.length);
      for (const f of fields) body.push(f.num, f.size, f.baseType);
    }
    if (m.compressedOffset !== undefined) {
      body.push(0x80 | (m.local << 5) | m.compressedOffset);
      for (const f of m.fields) if (f.num !== 253) push(f.value, f.size);
    } else {
      body.push(m.local);
      for (const f of m.fields) push(f.value, f.size);
    }
  }
  const header = [14, 0x20, 0, 0, ...[0, 8, 16, 24].map((s) => (body.length >>> s) & 0xff), ...".FIT"].map((c) =>
    typeof c === "string" ? c.charCodeAt(0) : c,
  );
  return Uint8Array.from([...header, 0, 0, ...body, 0, 0]);
}

const u8 = (num: number, value: number): Field => ({ num, size: 1, baseType: 0x02, value });
const u16 = (num: number, value: number): Field => ({ num, size: 2, baseType: 0x84, value });
const u32 = (num: number, value: number): Field => ({ num, size: 4, baseType: 0x86, value });

const start = fitTime("2026-10-28T17:00:00Z");
const fileId = { local: 0, global: 0, fields: [u8(0, 4), u16(1, FIT_MANUFACTURER.hammerhead), u16(2, 1), u32(3, 12345), u32(4, start)] };
const record = (second: number, watts: number) => ({
  local: 1,
  global: 20,
  fields: [u32(253, start + second), u16(7, watts), u8(3, 140), u8(4, 90), u32(5, second * 800)],
});
const session = {
  local: 2,
  global: 18,
  fields: [u32(253, start + 120), u32(2, start), { num: 5, size: 1, baseType: 0x00, value: 2 }, u32(7, 125000), u32(8, 120000), u32(9, 96000)],
};

describe("FIT decoding", () => {
  it("reads file id, session and records", () => {
    const records = Array.from({ length: 120 }, (_, s) => record(s, 200));
    const fit = decodeFit(encodeFit([fileId, ...records, session]));
    expect(fit.manufacturer).toBe(FIT_MANUFACTURER.hammerhead);
    expect(fit.serialNumber).toBe(12345);
    expect(fit.startTime?.toISOString()).toBe("2026-10-28T17:00:00.000Z");
    expect(fit.sport).toBe(2);
    expect(fit.totalTimerSeconds).toBe(120);
    expect(fit.totalDistanceMeters).toBe(960);
    expect(fit.records).toHaveLength(120);
    expect(fit.records[10]).toMatchObject({ power: 200, heartRate: 140, cadence: 90, distance: 80 });
  });

  it("treats 0xFFFF as a missing value", () => {
    const fit = decodeFit(encodeFit([fileId, record(0, 0xffff)]));
    expect(fit.records[0].power).toBeUndefined();
  });

  it("decodes compressed timestamp headers", () => {
    const base = record(0, 100);
    const next = { local: 3, global: 20, fields: base.fields.map((f) => (f.num === 7 ? u16(7, 300) : f)), compressedOffset: (start + 3) & 0x1f };
    const fit = decodeFit(encodeFit([fileId, base, next]));
    expect(fit.records.map((r) => r.timestamp.getTime() / 1000 - FIT_EPOCH - start)).toEqual([0, 3]);
    expect(fit.records[1].power).toBe(300);
  });

  it("rejects files that aren't FIT", () => {
    expect(() => decodeFit(new TextEncoder().encode("hello, this is not a fit file"))).toThrow("Not a FIT file");
  });
});

describe("ride from a FIT file", () => {
  it("summarizes a Karoo ride and skips a paused stretch", () => {
    const seconds = [...Array.from({ length: 600 }, (_, s) => s), ...Array.from({ length: 600 }, (_, s) => s + 1800)];
    const fit = decodeFit(encodeFit([fileId, ...seconds.map((s) => record(s, 250)), session]));
    const ride = rideFromFit(fit, "Morning ride.fit");
    expect(ride.source).toBe("karoo_fit");
    expect(ride.name).toBe("Morning ride");
    expect(ride.summary.durationSeconds).toBe(1200);
    expect(ride.summary.normalizedPower).toBeCloseTo(250);
    expect(ride.summary.averageHeartRate).toBe(140);
    expect(ride.summary.powerCurve?.[1200]).toBeCloseTo(250);
    expect(ride.externalId).toBe(`${FIT_MANUFACTURER.hammerhead}-12345-2026-10-28T17:00:00.000Z`);
  });
});
