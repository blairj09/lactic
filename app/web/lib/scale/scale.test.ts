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

/** A characteristic that records writes and can push notifications. */
function fakeChar(onWrite?: (bytes: number[], emit: (b: number[]) => void) => void, properties: Record<string, boolean> = { write: true }) {
  const listeners: (() => void)[] = [];
  const c = {
    value: undefined as DataView | undefined,
    properties,
    written: [] as number[][],
    addEventListener: (_: string, l: () => void) => listeners.push(l),
    startNotifications: async () => c,
    emit(bytes: number[]) {
      c.value = new DataView(Uint8Array.from(bytes).buffer);
      listeners.forEach((l) => l());
    },
    writeValue: async (data: Uint8Array) => {
      c.written.push(Array.from(data));
      onWrite?.(Array.from(data), (b) => setTimeout(() => c.emit(b), 0));
    },
  };
  return c;
}

/** A device with these services (16-bit uuid to characteristics), picked from the list. */
function fakeDevice(name: string, services: Record<number, Record<number, ReturnType<typeof fakeChar>>>) {
  const notFound = () => new DOMException("Not found", "NotFoundError");
  const server = {
    getPrimaryService: async (uuid: number) => {
      const chars = services[uuid];
      if (!chars) throw notFound();
      return {
        getCharacteristic: async (c: number) => {
          if (!chars[c]) throw notFound();
          return chars[c];
        },
      };
    },
  };
  const device = { name, gatt: { connect: async () => server, disconnect: vi.fn() } };
  vi.stubGlobal("navigator", { bluetooth: { requestDevice: async () => device } });
  return device;
}

describe("weigh-in on other scales", () => {
  it("answers a QN scale's unit and time requests, then takes the final frame", async () => {
    const notify = fakeChar();
    const write = fakeChar((bytes) => {
      if (bytes[0] === 0x13) setTimeout(() => notify.emit([0x14, 0x0b, 0xff, 0, 0, 0, 0, 0, 0, 0, 0]), 0);
      if (bytes[0] === 0x20)
        setTimeout(() => {
          notify.emit([0x10, 0x0b, 0xff, 0x1c, 0xe8, 0x00, 0, 0, 0, 0, 0]);
          notify.emit([0x10, 0x0b, 0xff, 0x1d, 0x10, 0x01, 0x01, 0xf4, 0x01, 0xc2, 0]);
        }, 0);
    });
    notify.startNotifications = async () => {
      setTimeout(() => notify.emit([0x12, 0x0f, 0xff, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0]), 0);
      return notify;
    };
    const device = fakeDevice("QN-Scale", { 0xfff0: { 0xfff1: notify, 0xfff2: write } });
    const result = await weighIn(null, () => undefined);
    expect(result).toMatchObject({ weightKg: 74.4, scale: "qn", source: "qn_scale", footImpedanceOhms: 500 });
    expect(write.written.map((w) => w[0])).toEqual([0x13, 0x20, 0x1f]);
    expect(write.written[0][2]).toBe(0xff);
    expect(device.gatt.disconnect).toHaveBeenCalled();
  });

  it("reads an Etekcity ESF-551 on the same service", async () => {
    const frame = (stable: number) => [0xa5, 0x02, 0x07, 0x10, 0x00, 0x00, 0x01, 0x61, 0xa1, 0x00, 0xa0, 0x22, 0x01, 0xf4, 0x01, 0, 0, 0, 0, stable, stable, 0];
    const notify = fakeChar();
    notify.startNotifications = async () => {
      setTimeout(() => (notify.emit(frame(0)), notify.emit(frame(1))), 0);
      return notify;
    };
    fakeDevice("Etekcity Fitness Scale", { 0xfff0: { 0xfff1: notify, 0xfff2: fakeChar() } });
    expect(await weighIn(null, () => undefined)).toMatchObject({ weightKg: 74.4, scale: "etekcity", footImpedanceOhms: 500 });
  });

  it("reads a standard scale's weight and its own body fat, skipping stored old readings", async () => {
    const weight = fakeChar();
    const comp = fakeChar();
    const clock = fakeChar();
    weight.startNotifications = async () => {
      setTimeout(() => {
        weight.emit([0x02, 0x00, 0x3c, 0xe9, 0x07, 1, 2, 8, 0, 0]); // January 2025: from the scale's memory
        weight.emit([0x00, 0x20, 0x3a]);
        comp.emit([0x00, 0x00, 0xb9, 0x00]);
      }, 0);
      return weight;
    };
    fakeDevice("BF600", { 0x181d: { 0x2a9d: weight }, 0x181b: { 0x2a9c: comp }, 0x1805: { 0x2a2b: clock } });
    const result = await weighIn(null, () => undefined);
    expect(result).toMatchObject({ weightKg: 74.4, scale: "standard", source: "ble_scale", bodyFatPercent: 18.5 });
    expect(clock.written[0]).toHaveLength(10);
  });

  it("reads a Xiaomi scale from its broadcast without connecting", async () => {
    const listeners: ((e: Event) => void)[] = [];
    const advert = (bytes: number[]) =>
      Object.assign(new Event("advertisementreceived"), { serviceData: new Map([["0000181b-0000-1000-8000-00805f9b34fb", new DataView(Uint8Array.from(bytes).buffer)]]) });
    const date = [0xea, 0x07, 11, 7, 8, 30, 0];
    const device = {
      name: "MIBCS",
      gatt: { connect: vi.fn(), disconnect: vi.fn() },
      addEventListener: (_: string, l: (e: Event) => void) => listeners.push(l),
      removeEventListener: vi.fn(),
      watchAdvertisements: async () => {
        setTimeout(() => {
          for (const bytes of [
            [0x02, 0xa6, ...date, 0xf4, 0x01, 0x00, 0x3c], // last weigh-in, stepped off
            [0x02, 0x04, ...date, 0x00, 0x00, 0x00, 0x3a],
            [0x02, 0x24, ...date, 0x00, 0x00, 0x20, 0x3a],
            [0x02, 0x26, ...date, 0xf4, 0x01, 0x20, 0x3a],
          ])
            listeners.forEach((l) => l(advert(bytes)));
        }, 0);
      },
    };
    vi.stubGlobal("navigator", { bluetooth: { requestDevice: async () => device } });
    const result = await weighIn(null, () => undefined);
    expect(result).toMatchObject({ weightKg: 74.4, scale: "xiaomi", source: "mi_scale", footImpedanceOhms: 500 });
    expect(device.gatt.connect).not.toHaveBeenCalled();
  });
});
