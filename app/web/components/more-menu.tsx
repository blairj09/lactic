"use client";

import { useEffect, useRef, useState } from "react";
import { button } from "@/components/ui";

export interface MoreItem {
  label: string;
  onSelect: () => void;
  danger?: boolean;
}

/** A "⋯" button that opens a small menu of less-used actions. Escape or a click outside closes it. */
export function MoreMenu({ label, items }: { label: string; items: MoreItem[] }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !box.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", close);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", close);
    };
  }, [open]);
  return (
    <div ref={box} className="relative">
      <button type="button" className={`${button.small} px-2.5`} aria-label={label} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        ⋯
      </button>
      {open && (
        <div role="menu" className="absolute left-0 z-30 mt-1.5 w-48 rounded-lg border border-line bg-surface p-1.5 shadow-xl">
          {items.map((it) => (
            <button
              key={it.label}
              type="button"
              role="menuitem"
              className={`block w-full rounded-md px-3 py-2 text-left text-sm hover:bg-active ${it.danger ? "text-negative" : ""}`}
              onClick={() => {
                setOpen(false);
                it.onSelect();
              }}
            >
              {it.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
