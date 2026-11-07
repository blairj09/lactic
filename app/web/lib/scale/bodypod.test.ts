import { describe, expect, it } from "vitest";
import { decodeScalePacket, profileCommand, WeighInSession } from "./bodypod";

const weight = (kg: number, flags: number) => {
  const raw = Math.round(kg * 100);
  return Uint8Array.from([0xcf, 0x00, flags, raw & 0xff, raw >> 8, 0, 0, 0]);
};
const impedance = (frequency: number, ohms: number[]) => Uint8Array.from([0xbe, frequency, ...ohms.flatMap((o) => [(o * 10) & 0xff, (o * 10) >> 8]), 0]);

describe("Body Pod packets", () => {
  it("builds the profile command with its XOR check byte", () => {
    expect(Array.from(profileCommand({ male: true, age: 35, heightCm: 180 }))).toEqual([0xfe, 0x01, 0x01, 0x02, 180, 35, 0x01, 0x94]);
  });

  it("reads live and settled weight", () => {
    expect(decodeScalePacket(weight(74.35, 0x00))).toEqual({ kind: "weight", kg: 74.35, locked: false });
    expect(decodeScalePacket(weight(74.4, 0x80))).toEqual({ kind: "weight", kg: 74.4, locked: true });
    // Body Pod 2 style: 11 bytes, byte 9 drops to 0 when settled.
    const pod2 = Uint8Array.from([0xcf, 0, 0, 0x10, 0x1d, 0, 0, 0, 0, 0, 0]);
    expect(decodeScalePacket(pod2)).toEqual({ kind: "weight", kg: 74.4, locked: true });
  });

  it("reads segment impedance in the order right arm, left arm, trunk, right leg, left leg", () => {
    expect(decodeScalePacket(impedance(0, [310.5, 312, 24.5, 260, 258]))).toEqual({
      kind: "impedance",
      frequency: 0,
      ohms: { rightArm: 310.5, leftArm: 312, trunk: 24.5, rightLeg: 260, leftLeg: 258 },
    });
  });

  it("collects a whole weigh-in, ignoring repeats and the empty scale", () => {
    const s = new WeighInSession();
    expect(s.feed(weight(0.2, 0))).not.toBeNull();
    expect(s.weightKg).toBeNull();
    s.feed(weight(70, 0));
    expect(s.feed(weight(70, 0))).toBeNull();
    s.feed(weight(74.4, 0x80));
    s.feed(impedance(0, [300, 300, 25, 250, 250]));
    expect(s.hasImpedance).toBe(false);
    s.feed(impedance(1, [270, 270, 20, 230, 230]));
    expect(s).toMatchObject({ lockedKg: 74.4, weightKg: 74.4, hasImpedance: true });
  });
});
