// Lactic's Bluetooth device chooser, which takes the place of Chrome's: it scans while open and
// lists nearby devices that fit what the page asked for, strongest signal first.

import { useEffect, useRef, useState } from "react";
import { button } from "@/components/ui";
import { matches, onAdvertsChanged, recentAdverts, scanning, setPicker, type RequestOptions, type Seen } from "./web-bluetooth";

interface Ask {
  options: RequestOptions;
  resolve: (v: { id: string; name: string | null } | null) => void;
}

function useAdverts(): Seen[] {
  const [, force] = useState(0);
  useEffect(() => onAdvertsChanged(() => force((n) => n + 1)), []);
  // Drop devices that went quiet.
  useEffect(() => {
    const t = setInterval(() => force((n) => n + 1), 2000);
    return () => clearInterval(t);
  }, []);
  return recentAdverts(8000);
}

const bars = (rssi: number | null) => (rssi === null ? 1 : rssi > -60 ? 4 : rssi > -70 ? 3 : rssi > -82 ? 2 : 1);

function Signal({ rssi }: { rssi: number | null }) {
  const n = bars(rssi);
  return (
    <span className="flex h-3.5 items-end gap-0.5" aria-label={`Signal ${n} of 4`}>
      {[1, 2, 3, 4].map((i) => (
        <span key={i} className={`w-1 rounded-sm ${i <= n ? "bg-ink" : "bg-line"}`} style={{ height: `${25 * i}%` }} />
      ))}
    </span>
  );
}

function List({ ask, onPick }: { ask: Ask; onPick: (s: Seen | null) => void }) {
  const all = useAdverts();
  const found = all.filter((a) => matches(a, ask.options)).sort((a, b) => (b.rssi ?? -127) - (a.rssi ?? -127));
  const [waited, setWaited] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setWaited(true), 8000);
    return () => clearTimeout(t);
  }, []);
  return (
    <div className="space-y-4 p-6">
      <div className="space-y-1">
        <h2 className="text-lg font-semibold tracking-tight">Choose a device</h2>
        <p className="flex items-center gap-2 text-sm text-muted">
          <span className="relative flex size-2">
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-primary opacity-60" />
            <span className="relative inline-flex size-2 rounded-full bg-primary" />
          </span>
          Looking for nearby devices…
        </p>
      </div>
      <ul className="max-h-72 divide-y divide-line overflow-y-auto rounded-md border border-line">
        {found.map((d) => (
          <li key={d.id}>
            <button type="button" onClick={() => onPick(d)} className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left text-sm hover:bg-raised">
              <span className="min-w-0">
                <span className="block truncate font-medium">{d.name ?? "Unnamed device"}</span>
                {d.id.startsWith("sim:") && <span className="text-xs text-muted">Simulated</span>}
              </span>
              <Signal rssi={d.rssi} />
            </button>
          </li>
        ))}
        {!found.length && <li className="px-4 py-6 text-center text-sm text-muted">{waited ? "Nothing yet. Wake the device (pedal, put the strap on, or tap the scale) and keep it close." : "Searching…"}</li>}
      </ul>
      <div className="flex justify-end">
        <button type="button" className={button.secondary} onClick={() => onPick(null)}>
          Cancel
        </button>
      </div>
    </div>
  );
}

/** Mount once: answers every navigator.bluetooth.requestDevice() in the app. */
export function BluetoothPicker() {
  const [ask, setAsk] = useState<Ask | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    setPicker(
      (options) =>
        new Promise((resolve) => {
          setAsk((prev) => {
            prev?.resolve(null);
            return { options, resolve };
          });
        }),
    );
    return () => setPicker(null);
  }, []);

  useEffect(() => {
    if (!ask) return;
    dialog.current?.showModal();
    void scanning.hold();
    return () => void scanning.release();
  }, [ask]);

  const finish = (s: Seen | null) => {
    ask?.resolve(s ? { id: s.id, name: s.name } : null);
    setAsk(null);
    dialog.current?.close();
  };

  return (
    <dialog
      ref={dialog}
      onClose={() => ask && finish(null)}
      className="m-auto w-[min(26rem,calc(100vw-2rem))] rounded-lg border border-line bg-surface p-0 text-ink backdrop:bg-black/70"
    >
      {ask && <List ask={ask} onPick={finish} />}
    </dialog>
  );
}

/** Live list of everything nearby, for onboarding's gear step. */
export const useNearby = useAdverts;
