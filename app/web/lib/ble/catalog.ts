// Every kind of Bluetooth device the app pairs with: what Chrome's picker filters on, and how to wake it.

import { BODY_POD } from "../scale/bodypod";
import type { DeviceKey } from "./devices";
import { GATT } from "./protocol";

export interface DeviceKind {
  key: DeviceKey;
  label: string;
  /** What to pick in Chrome's list, for the pairing sheet. */
  pick: string;
  wake: string;
  request: RequestDeviceOptions;
}

export const DEVICE_KINDS: DeviceKind[] = [
  {
    key: "trainer",
    label: "Trainer",
    pick: "your KICKR",
    wake: "Spin the pedals so the trainer wakes up and starts advertising.",
    request: { filters: [{ services: [GATT.service.fitnessMachine] }] },
  },
  {
    key: "powerMeter",
    label: "Power meter",
    pick: "your power meter",
    wake: "Turn the cranks a few times to wake the power meter.",
    request: { filters: [{ services: [GATT.service.cyclingPower] }] },
  },
  {
    key: "heartRate",
    label: "Heart rate",
    pick: "your heart rate strap or watch",
    wake: "Put the strap on (most only wake up on skin), or turn on heart rate broadcast on your watch.",
    request: { filters: [{ services: [GATT.service.heartRate] }] },
  },
  {
    key: "scale",
    label: "Scale",
    pick: "your Body Pod",
    wake: "Tap the scale with your foot to wake it.",
    request: { filters: [{ services: [BODY_POD.service] }, { namePrefix: "Body Pod" }, { namePrefix: "Hume" }], optionalServices: [BODY_POD.service] },
  },
];

export const deviceKind = (key: DeviceKey) => DEVICE_KINDS.find((k) => k.key === key)!;
