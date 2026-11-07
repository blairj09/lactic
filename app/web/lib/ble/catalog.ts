// Every kind of Bluetooth device the app pairs with: what Chrome's picker filters on, and how to wake it.

import { SCALE_REQUEST } from "../scale/models";
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
    pick: "your heart rate strap",
    wake: "Put the strap on. Most straps only wake up on skin.",
    request: { filters: [{ services: [GATT.service.heartRate] }] },
  },
  {
    key: "scale",
    label: "Scale",
    pick: "your scale",
    wake: "Step on or tap the scale to wake it.",
    request: SCALE_REQUEST,
  },
];

export const deviceKind = (key: DeviceKey) => DEVICE_KINDS.find((k) => k.key === key)!;
