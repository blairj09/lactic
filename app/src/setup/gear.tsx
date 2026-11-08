// Your gear: scan once, see everything nearby sorted into trainer, power meter, heart rate and
// scale, and pick with one click. Picked devices reconnect by themselves from then on.

import { useEffect, useState } from "react";
import { button, Notice, Pill } from "@/components/ui";
import { WatchHeartRateHelp } from "@/components/watch-hr-help";
import { DEVICES_CHANGED, remembered, rememberDevice, forgetDevice, type DeviceKey } from "@/lib/ble/devices";
import { identifyScale, SCALE_FAMILIES, SCALE_FAMILY_ORDER } from "@/lib/scale/models";
import { fullUuid } from "~/bluetooth/backend";
import { useNearby } from "~/bluetooth/picker";
import { ble, grant, scanning, simEnabled, type Seen } from "~/bluetooth/web-bluetooth";

const SLOTS: { key: DeviceKey; label: string; service: number; wake: string; note?: string }[] = [
  { key: "trainer", label: "Smart trainer", service: 0x1826, wake: "Spin the pedals to wake it." },
  { key: "powerMeter", label: "Power meter", service: 0x1818, wake: "Turn the cranks a few times.", note: "Optional. Most smart trainers measure power themselves." },
  { key: "heartRate", label: "Heart rate", service: 0x180d, wake: "Put the strap on (most wake on skin), or turn on heart rate broadcast on your watch." },
  { key: "scale", label: "Smart scale", service: 0xfff0, wake: "Step on the scale, or tap it with your foot, to wake it.", note: "Optional. Body Pod, Xiaomi, Renpho, Etekcity and standard Bluetooth scales." },
];

function fits(slot: (typeof SLOTS)[number], d: Seen) {
  // Scales differ too much to go by one service: recognise them by name, services or broadcast data.
  if (slot.key === "scale") return identifyScale(d) !== null;
  return d.services.map(fullUuid).includes(fullUuid(slot.service));
}

/** "Use MIBCS (Xiaomi Mi scale)": scale names are often a model code, so say what it is. */
function pickLabel(slot: (typeof SLOTS)[number], d: Seen) {
  const name = d.name ?? "unnamed device";
  const family = slot.key === "scale" ? identifyScale(d) : null;
  return family && family !== "bodyPod" && !name.toLowerCase().includes(SCALE_FAMILIES[family].label.split(" ")[0].toLowerCase()) ? `Use ${name} (${SCALE_FAMILIES[family].label})` : `Use ${name}`;
}

/** The scales Lactic reads, for anyone wondering whether theirs will work. */
function ScaleList() {
  return (
    <details className="text-sm text-muted">
      <summary className="cursor-pointer select-none hover:text-ink">Which scales work?</summary>
      <ul className="mt-2 list-disc space-y-1 pl-5">
        {SCALE_FAMILY_ORDER.map((f) => (
          <li key={f}>{SCALE_FAMILIES[f].examples}.</li>
        ))}
      </ul>
      <p className="mt-2">Withings, Garmin Index, Eufy and other scales that sync to their own cloud reach Lactic through intervals.icu or Apple Health instead.</p>
    </details>
  );
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

/** `scale` false leaves the smart scale out, for riders who don't track weight. */
export function GearSetup({ scale = true }: { scale?: boolean }) {
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
        {SLOTS.filter((slot) => scale || slot.key !== "scale").map((slot) => {
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
                      {pickLabel(slot, d)}
                    </button>
                  ))}
                </div>
              )}
              {!chosen && options.length === 0 && slot.note && <p className="text-sm text-faint">{slot.wake}</p>}
              {!chosen && slot.key === "heartRate" && <WatchHeartRateHelp />}
              {slot.key === "scale" && !chosen && <ScaleList />}
            </li>
          );
        })}
      </ul>
      <p className="text-sm text-muted">Skip anything you don&apos;t have. Add it later in Settings or on the Ride screen.</p>
    </div>
  );
}
