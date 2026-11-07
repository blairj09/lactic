// Your gear: scan once, see everything nearby sorted into trainer, power meter, heart rate and
// scale, and pick with one click. Picked devices reconnect by themselves from then on.

import { useEffect, useState } from "react";
import { button, Notice, Pill } from "@/components/ui";
import { DEVICES_CHANGED, remembered, rememberDevice, forgetDevice, type DeviceKey } from "@/lib/ble/devices";
import { fullUuid } from "~/bluetooth/backend";
import { useNearby } from "~/bluetooth/picker";
import { ble, grant, scanning, simEnabled, type Seen } from "~/bluetooth/web-bluetooth";

const SLOTS: { key: DeviceKey; label: string; service: number; wake: string; note?: string }[] = [
  { key: "trainer", label: "Smart trainer", service: 0x1826, wake: "Spin the pedals to wake it." },
  { key: "powerMeter", label: "Power meter", service: 0x1818, wake: "Turn the cranks a few times.", note: "Optional. Most smart trainers measure power themselves." },
  { key: "heartRate", label: "Heart rate", service: 0x180d, wake: "Put the strap on (most wake on skin), or start a workout broadcast on your watch." },
  { key: "scale", label: "Smart scale", service: 0xfff0, wake: "Tap the scale with your foot.", note: "Hume Body Pod for now. Others coming." },
];

function fits(slot: (typeof SLOTS)[number], d: Seen) {
  if (d.services.map(fullUuid).includes(fullUuid(slot.service))) return true;
  return slot.key === "scale" && /^(Body Pod|Hume)/.test(d.name ?? "");
}

function useRemembered() {
  const read = () => Object.fromEntries(SLOTS.map((s) => [s.key, remembered(s.key)])) as Record<DeviceKey, ReturnType<typeof remembered>>;
  const [all, setAll] = useState(read);
  useEffect(() => {
    const on = () => setAll(read());
    window.addEventListener(DEVICES_CHANGED, on);
    return () => window.removeEventListener(DEVICES_CHANGED, on);
  }, []);
  return all;
}

export function GearSetup() {
  const nearby = useNearby();
  const mine = useRemembered();
  const [status, setStatus] = useState<{ available: boolean; reason: string | null } | null>(null);
  // Simulated gear is a testing switch (Settings in development builds), not part of setup.
  const sim = simEnabled();

  useEffect(() => {
    void ble().available().then(setStatus);
    void scanning.hold();
    return () => void scanning.release();
  }, []);

  const use = (key: DeviceKey, d: Seen) => rememberDevice(key, grant(d.id, d.name));
  const visible = nearby.filter((d) => sim || !d.id.startsWith("sim:"));

  return (
    <div className="space-y-5">
      {status && !status.available && !sim && <Notice>Lactic can&apos;t reach Bluetooth ({(status.reason ?? "it's off").replace(/\.$/, "")}). Turn Bluetooth on in your computer's settings, then come back.</Notice>}
      <ul className="divide-y divide-line rounded-lg border border-line">
        {SLOTS.map((slot) => {
          const chosen = mine[slot.key];
          const taken = new Set(SLOTS.map((x) => mine[x.key]?.id));
          const ftms = fullUuid(0x1826);
          // A trainer also advertises power; offering it as the power meter would only double up.
          const options = visible.filter((d) => fits(slot, d) && !taken.has(d.id) && !(slot.key === "powerMeter" && d.services.map(fullUuid).includes(ftms))).sort((a, b) => (b.rssi ?? -127) - (a.rssi ?? -127));
          return (
            <li key={slot.key} className="space-y-3 p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="font-medium">{slot.label}</p>
                  <p className="text-sm text-muted">{chosen ? chosen.name : (slot.note ?? slot.wake)}</p>
                </div>
                {chosen ? (
                  <div className="flex items-center gap-2">
                    <Pill tone="positive">Paired</Pill>
                    <button type="button" className={button.ghost} onClick={() => void forgetDevice(slot.key)}>
                      Change
                    </button>
                  </div>
                ) : (
                  !options.length && (
                    <span className="flex items-center gap-2 text-sm text-faint">
                      <span className="size-1.5 animate-pulse rounded-full bg-faint" /> Looking…
                    </span>
                  )
                )}
              </div>
              {!chosen && options.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {options.map((d) => (
                    <button key={d.id} type="button" className={button.small} onClick={() => use(slot.key, d)}>
                      Use {d.name ?? "unnamed device"}
                    </button>
                  ))}
                </div>
              )}
              {!chosen && options.length === 0 && slot.note && <p className="text-sm text-faint">{slot.wake}</p>}
            </li>
          );
        })}
      </ul>
      <p className="text-sm text-muted">Skip anything you don&apos;t have. You can add gear later in Settings → Bluetooth, or from the Ride page.</p>
    </div>
  );
}
