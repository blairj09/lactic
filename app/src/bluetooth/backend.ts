// Where Bluetooth comes from: the OS through the Rust core (ble.rs), and the built-in simulated
// devices (sim.ts) for trying Lactic without gear. Both look the same to the Web Bluetooth layer
// above (web-bluetooth.ts).

import { invoke, isDesktop, listen } from "~/platform/native";

export interface CharInfo {
  uuid: string;
  properties: string[];
}

export interface ServiceInfo {
  uuid: string;
  characteristics: CharInfo[];
}

export interface Advert {
  id: string;
  name: string | null;
  rssi: number | null;
  services: string[];
}

export interface Notification {
  id: string;
  service: string;
  characteristic: string;
  value: number[];
}

export interface BleBackend {
  available(): Promise<{ available: boolean; reason: string | null }>;
  scan(): Promise<void>;
  stopScan(): Promise<void>;
  connect(id: string): Promise<ServiceInfo[]>;
  disconnect(id: string): Promise<void>;
  subscribe(id: string, service: string, characteristic: string, on: boolean): Promise<void>;
  write(id: string, service: string, characteristic: string, value: number[], withResponse: boolean): Promise<void>;
  read(id: string, service: string, characteristic: string): Promise<number[]>;
  onAdvert(cb: (a: Advert) => void): () => void;
  onNotify(cb: (n: Notification) => void): () => void;
  onDisconnected(cb: (id: string) => void): () => void;
}

/** Full 128-bit UUID, lower case, for a 16-bit number or any UUID string. */
export function fullUuid(uuid: number | string): string {
  if (typeof uuid === "number") return `0000${uuid.toString(16).padStart(4, "0")}-0000-1000-8000-00805f9b34fb`;
  const s = uuid.toLowerCase();
  if (/^[0-9a-f]{4}$/.test(s)) return `0000${s}-0000-1000-8000-00805f9b34fb`;
  if (/^[0-9a-f]{8}$/.test(s)) return `${s}-0000-1000-8000-00805f9b34fb`;
  return s;
}

function emitter<T>() {
  const set = new Set<(v: T) => void>();
  return {
    on(cb: (v: T) => void) {
      set.add(cb);
      return () => void set.delete(cb);
    },
    emit(v: T) {
      set.forEach((cb) => cb(v));
    },
  };
}

/** The OS's Bluetooth, through the Rust core. */
export function nativeBackend(): BleBackend {
  const adverts = emitter<Advert>();
  const notes = emitter<Notification>();
  const drops = emitter<string>();
  void listen<Advert>("ble:advert", adverts.emit);
  void listen<Notification>("ble:notify", notes.emit);
  void listen<string>("ble:disconnected", drops.emit);
  return {
    available: () => invoke("ble_available"),
    scan: () => invoke("ble_scan"),
    stopScan: () => invoke("ble_stop_scan"),
    connect: (id) => invoke("ble_connect", { id }),
    disconnect: (id) => invoke("ble_disconnect", { id }),
    subscribe: (id, service, characteristic, on) => invoke("ble_subscribe", { id, service, characteristic, on }),
    write: (id, service, characteristic, value, withResponse) => invoke("ble_write", { id, service, characteristic, value, withResponse }),
    read: (id, service, characteristic) => invoke("ble_read", { id, service, characteristic }),
    onAdvert: adverts.on,
    onNotify: notes.on,
    onDisconnected: drops.on,
  };
}

/** No Bluetooth at all (a browser without the desktop shell): only the simulator. */
export function noBackend(): BleBackend {
  const never = () => () => undefined;
  const none = async () => {
    throw new Error("Bluetooth needs the Lactic desktop app");
  };
  return {
    available: async () => ({ available: false, reason: "Bluetooth needs the Lactic desktop app" }),
    scan: async () => undefined,
    stopScan: async () => undefined,
    connect: none,
    disconnect: async () => undefined,
    subscribe: none,
    write: none,
    read: none,
    onAdvert: never,
    onNotify: never,
    onDisconnected: never,
  };
}

/** Sends simulator ids ("sim:...") to the simulator and everything else to the OS. */
export function combined(real: BleBackend, sim: BleBackend, simOn: () => boolean): BleBackend {
  const pick = (id: string) => (id.startsWith("sim:") ? sim : real);
  return {
    available: () => real.available(),
    async scan() {
      await Promise.all([real.scan().catch(() => undefined), simOn() ? sim.scan() : undefined]);
    },
    async stopScan() {
      await Promise.all([real.stopScan().catch(() => undefined), sim.stopScan()]);
    },
    connect: (id) => pick(id).connect(id),
    disconnect: (id) => pick(id).disconnect(id),
    subscribe: (id, s, c, on) => pick(id).subscribe(id, s, c, on),
    write: (id, s, c, v, r) => pick(id).write(id, s, c, v, r),
    read: (id, s, c) => pick(id).read(id, s, c),
    onAdvert: (cb) => {
      const a = real.onAdvert(cb);
      const b = sim.onAdvert((ad) => simOn() && cb(ad));
      return () => (a(), b());
    },
    onNotify: (cb) => {
      const a = real.onNotify(cb);
      const b = sim.onNotify(cb);
      return () => (a(), b());
    },
    onDisconnected: (cb) => {
      const a = real.onDisconnected(cb);
      const b = sim.onDisconnected(cb);
      return () => (a(), b());
    },
  };
}

export const hasNativeBluetooth = isDesktop;
