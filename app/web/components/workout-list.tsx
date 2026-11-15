"use client";

import { useEffect, useRef } from "react";
import type { Workout } from "@/lib/engine/workout";
import WorkoutProfile from "./workout-profile";

/**
 * One workout in a list: name, a line of numbers, and its shape. Tapping the name or shape opens the
 * workout (`onOpen`); `actions` (heart, Load) sit beside the name.
 */
export function WorkoutRow({
  name,
  line,
  workout,
  current = false,
  onOpen,
  actions,
}: {
  name: string;
  line: string;
  workout: Workout;
  /** The one loaded or picked, in bold. */
  current?: boolean;
  onOpen: () => void;
  actions?: React.ReactNode;
}) {
  return (
    <li className="py-2.5">
      <div className="flex items-center gap-3">
        <button type="button" onClick={onOpen} className="min-w-0 flex-1 text-left">
          <span className={`block truncate text-[15px] ${current ? "font-medium" : ""}`}>{name}</span>
          <span className="num block text-sm text-muted">{line}</span>
        </button>
        {actions && <span className="flex shrink-0 items-center gap-2">{actions}</span>}
      </div>
      <button type="button" onClick={onOpen} className="mt-2 block w-full" aria-label={`Open ${name}`} tabIndex={-1}>
        <WorkoutProfile workout={workout} height={28} fit />
      </button>
    </li>
  );
}

/**
 * A workout up close: its shape (tap a part for its target), what it's for, and what you can do with
 * it. A sheet from the bottom on a phone, a dialog on a computer; ×, Escape or a tap outside closes it.
 */
export function WorkoutSheet({
  name,
  line,
  workout,
  description,
  ftp,
  onClose,
  children,
}: {
  name: string;
  line: string;
  workout: Workout;
  description?: string;
  ftp?: number | null;
  onClose: () => void;
  /** The buttons along the bottom. */
  children: React.ReactNode;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close.current();
    window.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    panel.current?.focus();
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
    };
  }, []);

  return (
    <div
      className="fixed inset-0 z-40 flex items-end justify-center bg-black/50 sm:items-center sm:px-6"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        ref={panel}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={name}
        className="relative max-h-[90vh] w-full space-y-4 overflow-y-auto rounded-t-2xl border-t border-line bg-surface p-4 pb-[calc(1.25rem+env(safe-area-inset-bottom))] shadow-2xl outline-none sm:max-w-xl sm:rounded-xl sm:border sm:p-6"
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute top-3 right-3 flex h-8 w-8 items-center justify-center rounded-md text-xl text-muted hover:bg-raised hover:text-ink"
        >
          ×
        </button>
        <div className="pr-8">
          <h2 className="text-lg font-semibold">{name}</h2>
          <p className="num text-sm text-muted">{line}</p>
        </div>
        {description && <p className="text-[15px]">{description}</p>}
        <div className="flex flex-wrap items-center gap-2">{children}</div>
        {/* Last, with room below for the details a tap opens. */}
        <WorkoutProfile workout={workout} height={96} details ftp={ftp} className="!mt-6 mb-28" />
      </div>
    </div>
  );
}
