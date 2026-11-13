"use client";

import { canWatchApps, useHeadUnitAuto } from "./head-unit-auto";

/**
 * Head unit with Zwift, in the Lactic app on a computer: Lactic stays in the menu bar and gets the
 * head unit ready whenever Zwift, Rouvy or MyWhoosh opens.
 */
export default function HeadUnitAuto({ className = "mt-4" }: { className?: string }) {
  const [on, setOn] = useHeadUnitAuto();
  if (!canWatchApps()) return null;
  return (
    <label className={`${className} flex cursor-pointer items-start gap-3`}>
      <input type="checkbox" className="mt-1 size-4 accent-[var(--primary)]" checked={on} onChange={(e) => setOn(e.target.checked)} />
      <span>
        <span className="block text-[15px]">Start with Zwift, Rouvy or MyWhoosh</span>
        <span className="block text-sm text-muted">Lactic stays in the menu bar. When one opens, pedal and the head unit starts.</span>
      </span>
    </label>
  );
}
