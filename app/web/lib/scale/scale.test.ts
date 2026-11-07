import { afterEach, describe, expect, it, vi } from "vitest";
import { BODY_POD } from "./bodypod";
import { weighIn } from "./scale";

/** A fake Body Pod: once it gets a profile, it streams a weigh-in on FFF4. */
function fakeScale() {
  const written: number[][] = [];
  const listeners: (() => void)[] = [];
  const notify = {
    value: undefined as DataView | undefined,
    addEventListener: (_: string, l: () => void) => listeners.push(l),
    startNotifications: async () => notify,
  };
  const emit = (bytes: number[]) => {
    notify.value = new DataView(Uint8Array.from(bytes).buffer);
    listeners.forEach((l) => l());
  };
  const profile = {
    writeValueWithResponse: async (data: Uint8Array) => {
      written.push(Array.from(data));
      setTimeout(() => {
        emit([0xcf, 0, 0x00, 0x00, 0x1d, 0, 0, 0]);
        emit([0xcf, 0, 0x80, 0x10, 0x1d, 0, 0, 0]);
        for (const f of [0, 1]) emit([0xbe, f, 0xb8, 0x0b, 0xc2, 0x0b, 0xfa, 0x00, 0xc4, 0x09, 0xce, 0x09, 0]);
      }, 0);
    },
  };
  const service = {
    getCharacteristic: async (uuid: number) => {
      if (uuid === BODY_POD.notify) return notify;
      if (uuid === BODY_POD.profile) return profile;
      throw new DOMException("No such characteristic", "NotFoundError");
    },
  };
  const device = { gatt: { connect: async () => ({ getPrimaryService: async () => service }), disconnect: vi.fn() } };
  vi.stubGlobal("navigator", { bluetooth: { requestDevice: async () => device } });
  return { written, device };
}

afterEach(() => vi.unstubAllGlobals());

describe("weigh-in", () => {
  it("sends the profile, waits for a settled weight and both impedance sweeps, then disconnects", async () => {
    const { written, device } = fakeScale();
    const stages: string[] = [];
    const result = await weighIn({ male: true, age: 35, heightCm: 180 }, (u) => stages.push(u.stage));
    expect(written[0][0]).toBe(0xfe);
    expect(result.weightKg).toBe(74.4);
    expect(result.impedance["50"]).toEqual({ rightArm: 300, leftArm: 301, trunk: 25, rightLeg: 250, leftLeg: 251 });
    expect(result.impedance["250"]).toBeDefined();
    expect(stages).toEqual(["picking", "connecting", "waiting", "measuring", "analyzing", "analyzing", "done"]);
    expect(device.gatt.disconnect).toHaveBeenCalled();
  });
});
