"use client";

import { useEffect, useRef } from "react";
import type { DeviceKind } from "@/lib/ble/catalog";
import { button } from "./ui";

/**
 * The app's own screen before Chrome's device list: how to wake the device and what to pick.
 * `onFind` runs inside the click, so Chrome allows its picker.
 */
export default function PairSheet({ kind, onFind, onClose }: { kind: DeviceKind | null; onFind: (kind: DeviceKind) => void; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (kind) dialog.current?.showModal();
    else dialog.current?.close();
  }, [kind]);

  const label = kind?.label.toLowerCase();
  return (
    <dialog
      ref={dialog}
      onClose={onClose}
      className="m-auto w-[min(28rem,calc(100vw-2rem))] rounded-lg border border-line bg-surface p-0 text-ink backdrop:bg-black/70"
    >
      {kind && (
        <div className="space-y-5 p-6">
          <div className="space-y-1.5">
            <h2 className="text-lg font-semibold tracking-tight">Pair {label}</h2>
            <p className="text-sm text-muted">Once paired, the app remembers it and reconnects by itself, including when the signal drops mid-ride.</p>
          </div>
          <ol className="space-y-3 text-sm">
            <li className="flex gap-3">
              <span className="num flex size-6 flex-none items-center justify-center rounded-full bg-raised text-xs">1</span>
              <span className="pt-0.5">{kind.wake}</span>
            </li>
            <li className="flex gap-3">
              <span className="num flex size-6 flex-none items-center justify-center rounded-full bg-raised text-xs">2</span>
              <span className="pt-0.5">A list of nearby devices appears. Choose {kind.pick}.</span>
            </li>
          </ol>
          <div className="flex justify-end gap-2">
            <button className={button.secondary} onClick={onClose}>
              Not now
            </button>
            <button
              className={button.primary}
              autoFocus
              onClick={() => {
                onClose();
                onFind(kind);
              }}
            >
              Find {label}
            </button>
          </div>
        </div>
      )}
    </dialog>
  );
}
