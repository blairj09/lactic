// navigator.bluetooth for the desktop app. The webview has no Web Bluetooth, so this builds the
// same API on the Rust core (and the simulator), and the web app's SensorHub, devices.ts and
// scale.ts run unchanged. requestDevice opens Lactic's own picker in place of Chrome's.

import { combined, fullUuid, hasNativeBluetooth, nativeBackend, noBackend, type Advert, type BleBackend, type ServiceInfo } from "./backend";
import { simBackend } from "./sim";
import { getSetting } from "~/settings/store";
import { logEvent } from "~/support/log";

type Uuid = number | string;
interface Filter {
  services?: Uuid[];
  name?: string;
  namePrefix?: string;
}
export interface RequestOptions {
  filters?: Filter[];
  optionalServices?: Uuid[];
  acceptAllDevices?: boolean;
}

export interface Seen extends Advert {
  at: number;
}

const GRANTED_KEY = "lactic.ble.granted";

function readGranted(): { id: string; name: string | null }[] {
  try {
    return JSON.parse(localStorage.getItem(GRANTED_KEY) ?? "[]");
  } catch {
    return [];
  }
}
function writeGranted(list: { id: string; name: string | null }[]) {
  try {
    localStorage.setItem(GRANTED_KEY, JSON.stringify(list));
  } catch {}
}

/** True when an advert passes the page's requestDevice filters. */
export function matches(ad: Pick<Advert, "name" | "services">, options: RequestOptions): boolean {
  if (options.acceptAllDevices) return true;
  const services = new Set(ad.services.map(fullUuid));
  return (options.filters ?? []).some((f) => {
    if (f.services && !f.services.every((s) => services.has(fullUuid(s)))) return false;
    if (f.name !== undefined && ad.name !== f.name) return false;
    if (f.namePrefix !== undefined && !(ad.name ?? "").startsWith(f.namePrefix)) return false;
    return Boolean(f.services || f.name !== undefined || f.namePrefix !== undefined);
  });
}

// --- the picker ---------------------------------------------------------------------------------

export type Picker = (options: RequestOptions) => Promise<{ id: string; name: string | null } | null>;
let picker: Picker | null = null;
/** The UI registers its device chooser here (see picker.tsx). */
export function setPicker(p: Picker | null) {
  picker = p;
}

// --- the API ------------------------------------------------------------------------------------

const notFound = (what: string) => new DOMException(what, "NotFoundError");

class LCharacteristic extends EventTarget {
  value: DataView | null = null;
  oncharacteristicvaluechanged: ((e: Event) => void) | null = null;
  readonly service: LService;
  readonly uuid: string;
  readonly properties: Record<string, boolean>;
  constructor(service: LService, uuid: string, props: string[]) {
    super();
    this.service = service;
    this.uuid = uuid;
    const has = (p: string) => props.includes(p);
    this.properties = {
      read: has("read"),
      write: has("write"),
      writeWithoutResponse: has("write-without-response"),
      notify: has("notify"),
      indicate: has("indicate"),
    };
  }
  private get dev() {
    return this.service.device;
  }
  /** Called with each notification from the backend. */
  deliver(bytes: number[]) {
    this.value = new DataView(Uint8Array.from(bytes).buffer);
    const event = new Event("characteristicvaluechanged");
    this.dispatchEvent(event);
    this.oncharacteristicvaluechanged?.(event);
  }
  async startNotifications() {
    await ble().subscribe(this.dev.id, this.service.uuid, this.uuid, true);
    return this;
  }
  async stopNotifications() {
    await ble()
      .subscribe(this.dev.id, this.service.uuid, this.uuid, false)
      .catch(() => undefined);
    return this;
  }
  async readValue() {
    const bytes = await ble().read(this.dev.id, this.service.uuid, this.uuid);
    this.value = new DataView(Uint8Array.from(bytes).buffer);
    return this.value;
  }
  private async send(value: BufferSource, withResponse: boolean) {
    const bytes = ArrayBuffer.isView(value) ? new Uint8Array(value.buffer, value.byteOffset, value.byteLength) : new Uint8Array(value);
    await ble().write(this.dev.id, this.service.uuid, this.uuid, Array.from(bytes), withResponse);
  }
  writeValue(v: BufferSource) {
    return this.send(v, !this.properties.writeWithoutResponse || this.properties.write);
  }
  writeValueWithResponse(v: BufferSource) {
    return this.send(v, true);
  }
  writeValueWithoutResponse(v: BufferSource) {
    return this.send(v, false);
  }
}

class LService {
  readonly isPrimary = true;
  readonly device: LDevice;
  readonly uuid: string;
  readonly chars: LCharacteristic[];
  constructor(device: LDevice, info: ServiceInfo) {
    this.device = device;
    this.uuid = fullUuid(info.uuid);
    this.chars = info.characteristics.map((c) => new LCharacteristic(this, fullUuid(c.uuid), c.properties));
  }
  async getCharacteristic(uuid: Uuid) {
    const c = this.chars.find((x) => x.uuid === fullUuid(uuid));
    if (!c) throw notFound(`No characteristic ${uuid}`);
    return c;
  }
  async getCharacteristics(uuid?: Uuid) {
    return uuid === undefined ? this.chars : this.chars.filter((x) => x.uuid === fullUuid(uuid));
  }
}

class LServer {
  connected = false;
  services: LService[] = [];
  readonly device: LDevice;
  private connecting: Promise<LServer> | null = null;
  constructor(device: LDevice) {
    this.device = device;
  }
  connect(): Promise<LServer> {
    if (this.connected) return Promise.resolve(this);
    this.connecting ??= ble()
      .connect(this.device.id)
      .then((infos) => {
        this.services = infos.map((i) => new LService(this.device, i));
        this.connected = true;
        logEvent("bluetooth", "info", `Connected ${this.label()}`);
        return this;
      })
      .catch((e) => {
        logEvent("bluetooth", "warn", `Couldn't connect ${this.label()}: ${e instanceof Error ? e.message : String(e)}`);
        throw e;
      })
      .finally(() => (this.connecting = null));
    return this.connecting;
  }
  disconnect() {
    if (!this.connected) {
      void ble().disconnect(this.device.id).catch(() => undefined);
      return;
    }
    void ble().disconnect(this.device.id).catch(() => undefined);
    this.leaving = true;
    this.dropped();
  }
  private leaving = false;
  private label() {
    return `${this.device.name ?? "a device"}${this.device.id.startsWith("sim:") ? " (simulated)" : ""}`;
  }
  dropped() {
    if (!this.connected) return;
    logEvent("bluetooth", this.leaving ? "info" : "warn", this.leaving ? `Disconnected ${this.label()}` : `${this.label()} dropped the connection`);
    this.leaving = false;
    this.connected = false;
    this.device.dispatchEvent(new Event("gattserverdisconnected"));
  }
  async getPrimaryService(uuid: Uuid) {
    if (!this.connected) throw new DOMException("GATT Server is disconnected", "NetworkError");
    const s = this.services.find((x) => x.uuid === fullUuid(uuid));
    if (!s) throw notFound(`No service ${uuid}`);
    return s;
  }
  async getPrimaryServices(uuid?: Uuid) {
    return uuid === undefined ? this.services : this.services.filter((x) => x.uuid === fullUuid(uuid));
  }
}

class LDevice extends EventTarget {
  readonly id: string;
  name: string | undefined;
  readonly gatt: LServer;
  watchingAdvertisements = false;
  constructor(id: string, name: string | null) {
    super();
    this.id = id;
    this.name = name ?? undefined;
    this.gatt = new LServer(this);
  }
  async watchAdvertisements({ signal }: { signal?: AbortSignal } = {}) {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    this.watchingAdvertisements = true;
    watchers.add(this);
    void scanning.hold();
    signal?.addEventListener("abort", () => this.unwatch(), { once: true });
  }
  unwatch() {
    if (!this.watchingAdvertisements) return;
    this.watchingAdvertisements = false;
    watchers.delete(this);
    void scanning.release();
  }
  async forget() {
    this.gatt.disconnect();
    writeGranted(readGranted().filter((g) => g.id !== this.id));
    devices.delete(this.id);
  }
}

// --- shared state -------------------------------------------------------------------------------

let backend: BleBackend | null = null;
const devices = new Map<string, LDevice>();
const watchers = new Set<LDevice>();
const seen = new Map<string, Seen>();
const seenListeners = new Set<() => void>();

export const SIM_SETTING = "bluetooth.simulator";
let simOn = !hasNativeBluetooth;
/** Whether the simulated gear shows up (Settings → Bluetooth, and onboarding). */
export const simEnabled = () => simOn;
async function loadSim() {
  simOn = (await getSetting<boolean>(SIM_SETTING, !hasNativeBluetooth)) === true;
}

export function ble(): BleBackend {
  if (!backend) {
    backend = combined(hasNativeBluetooth ? nativeBackend() : noBackend(), simBackend(), simEnabled);
    backend.onAdvert((ad) => {
      const prev = seen.get(ad.id);
      seen.set(ad.id, { ...ad, name: ad.name ?? prev?.name ?? null, services: ad.services.length ? ad.services : (prev?.services ?? []), at: Date.now() });
      seenListeners.forEach((cb) => cb());
      const d = devices.get(ad.id);
      if (d?.watchingAdvertisements) {
        const e = Object.assign(new Event("advertisementreceived"), { device: d, name: ad.name, rssi: ad.rssi, uuids: ad.services });
        d.dispatchEvent(e);
      }
    });
    backend.onNotify((n) => {
      const d = devices.get(n.id);
      const s = d?.gatt.services.find((x) => x.uuid === fullUuid(n.service));
      s?.chars.find((c) => c.uuid === fullUuid(n.characteristic))?.deliver(n.value);
    });
    backend.onDisconnected((id) => devices.get(id)?.gatt.dropped());
  }
  return backend;
}

/** A scan that stays on while anyone needs it (the picker, auto-reconnect watchers). */
export const scanning = (() => {
  let holders = 0;
  return {
    async hold() {
      holders++;
      if (holders === 1) await ble().scan();
    },
    async release() {
      holders = Math.max(0, holders - 1);
      if (holders === 0) await ble().stopScan();
    },
  };
})();

/** Everything heard advertising recently, for the picker. */
export function recentAdverts(maxAgeMs = 10_000): Seen[] {
  const now = Date.now();
  return [...seen.values()].filter((s) => now - s.at < maxAgeMs);
}
export function onAdvertsChanged(cb: () => void) {
  seenListeners.add(cb);
  return () => void seenListeners.delete(cb);
}

function deviceFor(id: string, name: string | null): LDevice {
  let d = devices.get(id);
  if (!d) {
    d = new LDevice(id, name);
    devices.set(id, d);
  } else if (name) d.name = name;
  return d;
}

/** Grants a device to the page without the picker (onboarding pairs gear this way). */
export function grant(id: string, name: string | null): BluetoothDevice {
  const list = readGranted().filter((g) => g.id !== id);
  writeGranted([...list, { id, name }]);
  return deviceFor(id, name) as unknown as BluetoothDevice;
}

const bluetooth = {
  async getAvailability() {
    return (await ble().available()).available || simEnabled();
  },
  async requestDevice(options: RequestOptions = {}) {
    if (!picker) throw notFound("No device picker");
    ble();
    const choice = await picker(options);
    if (!choice) throw notFound("User cancelled the requestDevice() chooser.");
    return grant(choice.id, choice.name);
  },
  async getDevices() {
    ble();
    return readGranted()
      .filter((g) => !g.id.startsWith("sim:") || simEnabled())
      .map((g) => deviceFor(g.id, g.name) as unknown as BluetoothDevice);
  },
  addEventListener() {},
  removeEventListener() {},
};

/** Puts navigator.bluetooth in place (once, at boot). */
export async function installWebBluetooth() {
  await loadSim().catch(() => undefined);
  window.addEventListener("lactic:settings", (e) => {
    if ((e as CustomEvent).detail === SIM_SETTING) void loadSim();
  });
  Object.defineProperty(navigator, "bluetooth", { value: bluetooth, configurable: true });
}
