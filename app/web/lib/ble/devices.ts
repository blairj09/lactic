/// <reference types="web-bluetooth" />
// Remembered Bluetooth devices, so Chrome's device picker only shows the first time. Browser only.
//
// Chrome keeps a site's paired devices and hands them back from navigator.bluetooth.getDevices(),
// which connects without a click or the picker. On desktop Chrome that API still sits behind
// chrome://flags/#enable-web-bluetooth-new-permissions-backend (plus Experimental Web Platform
// features); without them, getDevices is missing
// and every first connect of a page load goes through the picker. Within a page load, a dropped
// device always reconnects without the picker, since the BluetoothDevice object stays valid.

export type DeviceKey = "trainer" | "heartRate" | "powerMeter" | "scale";

export const DEVICE_KEYS: DeviceKey[] = ["trainer", "powerMeter", "heartRate", "scale"];

interface StoredDevice {
  id: string;
  /** The name the device advertises. */
  name: string;
  /** A name the user gave it in Settings. */
  nickname?: string;
  pairedAt?: string;
  /** Last successful connection, ISO time. */
  lastSeen?: string;
}

export interface RememberedDevice {
  id: string;
  /** What to call it: the user's name for it, else the advertised name. */
  name: string;
  deviceName: string;
  nickname?: string;
  pairedAt?: string;
  lastSeen?: string;
}

const STORAGE = "ble.devices";
/** Fired on window whenever the remembered devices change, so open screens can refresh. */
export const DEVICES_CHANGED = "ble-devices-changed";

function readAll(): Partial<Record<DeviceKey, StoredDevice>> {
  try {
    return JSON.parse(localStorage.getItem(STORAGE) ?? "{}");
  } catch {
    return {};
  }
}

function writeAll(all: Partial<Record<DeviceKey, StoredDevice>>) {
  try {
    localStorage.setItem(STORAGE, JSON.stringify(all));
    window.dispatchEvent(new Event(DEVICES_CHANGED));
  } catch {}
}

function patch(key: DeviceKey, change: Partial<StoredDevice>) {
  const all = readAll();
  const current = all[key];
  if (!current) return;
  writeAll({ ...all, [key]: { ...current, ...change } });
}

/** The device last paired for this key, whether or not Chrome can reconnect it silently. */
export function remembered(key: DeviceKey): RememberedDevice | undefined {
  const saved = readAll()[key];
  return saved && { ...saved, name: saved.nickname || saved.name, deviceName: saved.name };
}

/**
 * Remembers the device for this key. The same device picked again (same id, or same name under a
 * new id) keeps its nickname and history.
 */
export function rememberDevice(key: DeviceKey, device: BluetoothDevice) {
  const all = readAll();
  const current = all[key];
  const name = device.name ?? "Unknown device";
  const same = current && (current.id === device.id || current.name === name);
  writeAll({ ...all, [key]: same ? { ...current, id: device.id, name } : { id: device.id, name, pairedAt: new Date().toISOString() } });
}

/** Gives a remembered device the user's own name; an empty name goes back to the advertised one. */
export function renameDevice(key: DeviceKey, nickname: string) {
  patch(key, { nickname: nickname.trim() || undefined });
}

/** Records a successful connection on every key that remembers this device. */
function markSeen(device: BluetoothDevice) {
  const all = readAll();
  const now = new Date().toISOString();
  let changed = false;
  for (const key of DEVICE_KEYS) {
    if (all[key]?.id === device.id) {
      all[key] = { ...all[key]!, lastSeen: now };
      changed = true;
    }
  }
  if (changed) writeAll(all);
}

/** Whether this browser reconnects remembered devices after a reload without the picker. */
export function canReconnectSilently(): boolean {
  return typeof navigator !== "undefined" && typeof navigator.bluetooth?.getDevices === "function";
}

/** The remembered device for this key, if Chrome still has permission for it. */
export async function findRemembered(key: DeviceKey): Promise<BluetoothDevice | undefined> {
  const saved = remembered(key);
  if (!saved || !canReconnectSilently()) return undefined;
  try {
    const devices = await navigator.bluetooth.getDevices();
    const byId = devices.find((d) => d.id === saved.id);
    if (byId) return byId;
    // Chrome hands out new ids when its Bluetooth permissions change (turning on the flags, for
    // one), so a device remembered before then is found by name and its id updated.
    const byName = devices.filter((d) => d.name === saved.deviceName);
    if (byName.length !== 1) return undefined;
    rememberDevice(key, byName[0]);
    return byName[0];
  } catch {
    return undefined;
  }
}

/** Forgets the device here and, where Chrome supports it, revokes the site's permission too. */
export async function forgetDevice(key: DeviceKey, device?: BluetoothDevice) {
  const all = readAll();
  delete all[key];
  writeAll(all);
  const target = device ?? (await findRemembered(key));
  try {
    await (target as (BluetoothDevice & { forget?: () => Promise<void> }) | undefined)?.forget?.();
  } catch {}
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Resolves when the device is heard advertising, or after `ms` if the browser can't listen. */
async function waitForAdvertisement(device: BluetoothDevice, ms: number): Promise<void> {
  if (typeof device.watchAdvertisements !== "function") return;
  const controller = new AbortController();
  try {
    await new Promise<void>((resolve) => {
      const done = () => resolve();
      device.addEventListener("advertisementreceived", done, { once: true });
      setTimeout(done, ms);
      device.watchAdvertisements({ signal: controller.signal }).catch(done);
    });
  } finally {
    controller.abort();
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Timed out connecting")), ms);
    promise.then(
      (v) => (clearTimeout(timer), resolve(v)),
      (e) => (clearTimeout(timer), reject(e)),
    );
  });
}

export interface ConnectOptions {
  attempts?: number;
  timeoutMs?: number;
  /** Stops retrying when it returns true, e.g. after the user pressed Disconnect. */
  cancelled?: () => boolean;
}

/** Opens GATT, retrying with backoff: a sensor that just woke up often refuses the first try. */
export async function connectGatt(device: BluetoothDevice, { attempts = 3, timeoutMs = 10_000, cancelled }: ConnectOptions = {}) {
  let last: unknown;
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (cancelled?.()) throw new DOMException("Connection cancelled", "AbortError");
    if (attempt > 0) {
      await waitForAdvertisement(device, Math.min(1000 * 2 ** attempt, 8000));
      if (cancelled?.()) throw new DOMException("Connection cancelled", "AbortError");
    }
    try {
      const server = await withTimeout(device.gatt!.connect(), timeoutMs);
      markSeen(device);
      return server;
    } catch (e) {
      last = e;
      device.gatt?.disconnect();
      if (attempt < attempts - 1 && typeof device.watchAdvertisements !== "function") await sleep(1000 * 2 ** attempt);
    }
  }
  throw last;
}

/** True for the picker being closed without a choice, which isn't an error worth showing. */
export function isPickerCancel(e: unknown): boolean {
  return e instanceof DOMException && e.name === "NotFoundError";
}
