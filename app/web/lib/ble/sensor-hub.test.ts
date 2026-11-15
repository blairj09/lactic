import { afterEach, describe, expect, it, vi } from "vitest";
import { GATT } from "./protocol";
import { SensorHub } from "./sensor-hub";

/** A fake FTMS trainer: records control point writes and answers each with a success indication. */
function fakeTrainer() {
  const writes: number[][] = [];
  const characteristic = (uuid: number) => {
    const listeners: (() => void)[] = [];
    const c = {
      uuid,
      value: undefined as DataView | undefined,
      addEventListener: (_: string, l: () => void) => listeners.push(l),
      startNotifications: async () => c,
      emit(bytes: number[]) {
        c.value = new DataView(Uint8Array.from(bytes).buffer);
        listeners.forEach((l) => l());
      },
      writeValueWithResponse: async (data: Uint8Array) => {
        writes.push(Array.from(data));
        queueMicrotask(() => c.emit([0x80, data[0], 0x01]));
      },
    };
    return c;
  };
  const bikeData = characteristic(GATT.characteristic.indoorBikeData);
  const control = characteristic(GATT.characteristic.fitnessMachineControlPoint);
  const service = { getCharacteristic: async (uuid: number) => (uuid === bikeData.uuid ? bikeData : control) };
  const listeners = new Map<string, Set<() => void>>();
  const fire = (type: string) => [...(listeners.get(type) ?? [])].forEach((l) => l());
  const device = {
    id: "kickr-1",
    name: "KICKR TEST",
    connects: 0,
    /** Asleep, it refuses connections and doesn't advertise. */
    asleep: false,
    addEventListener: (type: string, l: () => void) => listeners.set(type, (listeners.get(type) ?? new Set()).add(l)),
    removeEventListener: (type: string, l: () => void) => listeners.get(type)?.delete(l),
    watchAdvertisements: vi.fn(async () => undefined),
    gatt: {
      connect: async () => {
        if (device.asleep) throw new DOMException("Connection failed", "NetworkError");
        device.connects++;
        return { getPrimaryService: async () => service };
      },
      disconnect: vi.fn(),
    },
    /** The trainer drops out on its own, as a Bluetooth link does. */
    drop: () => fire("gattserverdisconnected"),
    /** The trainer wakes up and is heard advertising. */
    wake: () => {
      device.asleep = false;
      fire("advertisementreceived");
    },
  };
  const requestDevice = vi.fn(async () => device);
  vi.stubGlobal("navigator", { bluetooth: { requestDevice } });
  return { writes, bikeData, device, requestDevice };
}

function memoryStorage() {
  const items = new Map<string, string>();
  vi.stubGlobal("localStorage", { getItem: (k: string) => items.get(k) ?? null, setItem: (k: string, v: string) => items.set(k, v) });
}

const settle = () => new Promise((r) => setTimeout(r, 0));

afterEach(() => vi.unstubAllGlobals());

describe("SensorHub with a trainer", () => {
  it("requests control once, then sends ERG targets", async () => {
    const { writes } = fakeTrainer();
    const hub = new SensorHub();
    await hub.connect("trainer");
    expect(hub.getState().connected.trainer).toBe("KICKR TEST");

    await hub.setTargetPower(200);
    await hub.setTargetPower(250);
    await new Promise((r) => setTimeout(r, 0));

    expect(writes).toEqual([[0x00], [0x05, 200, 0], [0x05, 250, 0]]);
    expect(hub.getState().targetWatts).toBe(250);
    expect(hub.getState().trainerStatus).toBe("ERG 250 W");
  });

  it("publishes live power and cadence from indoor bike data", async () => {
    const { bikeData } = fakeTrainer();
    const hub = new SensorHub();
    await hub.connect("trainer");
    const seen = vi.fn();
    hub.subscribe(seen);

    bikeData.emit([0x44, 0x00, 0xb2, 0x0c, 0xb4, 0x00, 0xfa, 0x00]);

    expect(seen).toHaveBeenCalled();
    expect(hub.getState()).toMatchObject({ powerWatts: 250, cadenceRpm: 90, speedKph: 32.5 });
  });

  it("rejects ERG commands with no trainer connected", async () => {
    await expect(new SensorHub().setTargetPower(200)).rejects.toThrow("No trainer connected");
  });

  it("reconnects by itself after a drop and puts the ERG target back", async () => {
    const { writes, device, requestDevice } = fakeTrainer();
    const hub = new SensorHub();
    await hub.connect("trainer");
    await hub.setTargetPower(220);
    await settle();

    device.drop();
    await settle();
    await settle();

    expect(requestDevice).toHaveBeenCalledTimes(1);
    expect(device.connects).toBe(2);
    expect(hub.getState().links.trainer).toEqual({ status: "connected", name: "KICKR TEST" });
    // Control is requested again on the new link before the target.
    expect(writes.slice(-2)).toEqual([[0x00], [0x05, 220, 0]]);
  });

  it("puts the simulated grade back after a drop when ERG is off", async () => {
    const { writes, device } = fakeTrainer();
    const hub = new SensorHub();
    await hub.connect("trainer");
    await hub.setSimulationGrade(3);
    await settle();

    device.drop();
    await settle();
    await settle();

    expect(writes.at(-1)).toEqual([0x11, 0, 0, 44, 1, 40, 51]);
    expect(hub.getState().targetWatts).toBeUndefined();
  });

  it("stays disconnected after Disconnect, and Connect reuses the device without the picker", async () => {
    const { device, requestDevice } = fakeTrainer();
    const hub = new SensorHub();
    await hub.connect("trainer");

    hub.disconnect("trainer");
    device.drop();
    await settle();
    expect(hub.getState().links.trainer).toEqual({ status: "idle", name: "KICKR TEST" });
    expect(device.connects).toBe(1);

    await hub.connect("trainer");
    expect(requestDevice).toHaveBeenCalledTimes(1);
    expect(hub.getState().connected.trainer).toBe("KICKR TEST");
  });

  it("restores a remembered trainer on load without the picker", async () => {
    memoryStorage();
    const { device, requestDevice } = fakeTrainer();
    await new SensorHub().connect("trainer");
    vi.stubGlobal("navigator", { bluetooth: { requestDevice, getDevices: async () => [device] } });

    const hub = new SensorHub();
    await hub.restore();

    expect(requestDevice).toHaveBeenCalledTimes(1);
    expect(hub.getState().connected.trainer).toBe("KICKR TEST");
  });

  it("waits for a remembered trainer that's asleep on load and connects when it wakes", async () => {
    memoryStorage();
    const { device, requestDevice } = fakeTrainer();
    await new SensorHub().connect("trainer");
    vi.stubGlobal("navigator", { bluetooth: { requestDevice, getDevices: async () => [device] } });
    device.asleep = true;

    const hub = new SensorHub();
    await hub.restore();
    expect(hub.getState().links.trainer).toMatchObject({ status: "idle", waiting: true });
    expect(device.watchAdvertisements).toHaveBeenCalled();

    device.wake();
    await settle();
    await settle();
    expect(hub.getState().links.trainer).toMatchObject({ status: "connected", name: "KICKR TEST" });
    expect(hub.getState().links.trainer.waiting).toBeFalsy();
    expect(requestDevice).toHaveBeenCalledTimes(1);
  });

  it("stops waiting for a sensor after Disconnect", async () => {
    memoryStorage();
    const { device, requestDevice } = fakeTrainer();
    await new SensorHub().connect("trainer");
    vi.stubGlobal("navigator", { bluetooth: { requestDevice, getDevices: async () => [device] } });
    device.asleep = true;

    const hub = new SensorHub();
    await hub.restore();
    hub.disconnect("trainer");
    device.wake();
    await settle();
    expect(hub.getState().links.trainer.status).toBe("idle");
    expect(hub.getState().links.trainer.waiting).toBeFalsy();
  });

  it("uses the trainer's power by default, and power matches ERG to the power meter when picked", async () => {
    const trainer = fakeTrainer();
    const listeners: (() => void)[] = [];
    const measurement = {
      uuid: GATT.characteristic.cyclingPowerMeasurement,
      value: undefined as DataView | undefined,
      addEventListener: (_: string, l: () => void) => listeners.push(l),
      startNotifications: async () => measurement,
    };
    const pedals = {
      id: "pedals-1",
      name: "PEDALS",
      addEventListener: () => undefined,
      gatt: { connect: async () => ({ getPrimaryService: async () => ({ getCharacteristic: async () => measurement }) }), disconnect: vi.fn() },
    };
    const requestDevice = vi.fn(async (options: { filters: { services: number[] }[] }) =>
      options.filters[0].services[0] === GATT.service.cyclingPower ? pedals : trainer.device,
    );
    vi.stubGlobal("navigator", { bluetooth: { requestDevice } });
    let now = 0;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    const hub = new SensorHub();
    await hub.connect("trainer");
    await hub.connect("powerMeter");
    await hub.setTargetPower(200);
    await settle();

    // A second of riding: the KICKR says 206 W, the pedals 200 W.
    const second = () => {
      trainer.bikeData.emit([0x40, 0x00, 0x00, 0x00, 0xce, 0x00]);
      now += 200;
      measurement.value = new DataView(Uint8Array.from([0x00, 0x00, 200, 0x00]).buffer);
      listeners.forEach((l) => l());
      now += 800;
    };
    for (let s = 0; s < 15; s++) second();
    await settle();
    expect(hub.getState()).toMatchObject({ powerSource: "trainer", powerWatts: 206, meterWatts: 200 });
    expect(trainer.writes.at(-1)).toEqual([0x05, 200, 0]);

    hub.setPowerSource("powerMeter");
    await settle();
    expect(hub.getState().powerWatts).toBe(200);
    // The trainer reads 3% high, so it's asked for 206 W to put 200 W on the pedals.
    expect(trainer.writes.at(-1)).toEqual([0x05, 206, 0]);
    expect(hub.getState().targetWatts).toBe(200);

    hub.setPowerSource("trainer");
    await settle();
    expect(trainer.writes.at(-1)).toEqual([0x05, 200, 0]);
  });
});

describe("SensorHub hands off (head unit)", () => {
  it("reads the trainer but never writes to its control point", async () => {
    const { writes, bikeData } = fakeTrainer();
    const hub = new SensorHub();
    hub.setHandsOff(true);
    await hub.connect("trainer");

    await hub.setTargetPower(200);
    await hub.setSimulationGrade(4);
    await settle();
    bikeData.emit([0x44, 0x00, 0xb2, 0x0c, 0xb4, 0x00, 0xfa, 0x00]);

    expect(writes).toEqual([]);
    expect(hub.getState()).toMatchObject({ handsOff: true, powerWatts: 250, cadenceRpm: 90, trainerStatus: "Reading only" });
    expect(hub.getState().targetWatts).toBeUndefined();
  });

  it("drops a write already queued when hands off comes on", async () => {
    const { writes } = fakeTrainer();
    const hub = new SensorHub();
    await hub.connect("trainer");
    const queued = hub.setTargetPower(200);
    hub.setHandsOff(true);
    await queued;
    await settle();
    expect(writes).toEqual([]);
  });

  it("puts nothing back on the trainer after a drop", async () => {
    const { writes, device } = fakeTrainer();
    const hub = new SensorHub();
    await hub.connect("trainer");
    await hub.setSimulationGrade(3);
    await settle();
    const before = writes.length;
    hub.setHandsOff(true);

    device.drop();
    await settle();
    await settle();

    expect(device.connects).toBe(2);
    expect(writes.length).toBe(before);
  });

  it("takes power from the power meter when there's no trainer", async () => {
    const listeners: (() => void)[] = [];
    const measurement = {
      uuid: GATT.characteristic.cyclingPowerMeasurement,
      value: undefined as DataView | undefined,
      addEventListener: (_: string, l: () => void) => listeners.push(l),
      startNotifications: async () => measurement,
    };
    const pedals = {
      id: "pedals-1",
      name: "PEDALS",
      addEventListener: () => undefined,
      gatt: { connect: async () => ({ getPrimaryService: async () => ({ getCharacteristic: async () => measurement }) }), disconnect: vi.fn() },
    };
    vi.stubGlobal("navigator", { bluetooth: { requestDevice: vi.fn(async () => pedals) } });
    const hub = new SensorHub();
    hub.setHandsOff(true);
    await hub.connect("powerMeter");
    measurement.value = new DataView(Uint8Array.from([0x00, 0x00, 180, 0x00]).buffer);
    listeners.forEach((l) => l());
    expect(hub.getState()).toMatchObject({ powerSource: "trainer", powerWatts: 180 });
  });
});
