"use client";

import { canWatchApps, useAppStart } from "./app-start";
import { os } from "~/platform/native";

/**
 * Start with Zwift, in the Lactic app on a computer: Lactic stays in the menu bar and gets a free
 * ride ready, with that app on the trainer, whenever Zwift, Rouvy or MyWhoosh opens.
 */
export default function AppStartSwitch({ className = "mt-4" }: { className?: string }) {
  const [on, setOn] = useAppStart();
  if (!canWatchApps()) return null;
  return (
    <label className={`${className} flex cursor-pointer items-start gap-3`}>
      <input type="checkbox" className="mt-1 size-4 accent-[var(--primary)]" checked={on} onChange={(e) => setOn(e.target.checked)} />
      <span>
        <span className="block text-[15px]">Start with Zwift, Rouvy or MyWhoosh</span>
        <span className="block text-sm text-muted">Lactic stays in the {os() === "macos" ? "menu bar" : "system tray"}. When one opens, pedal to start a free ride.</span>
      </span>
    </label>
  );
}
