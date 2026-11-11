"use client";

import { formatHours } from "@/lib/engine/hours";
import { useEffect, useRef, useState } from "react";

/** A container ref and its current width, for SVG charts that fill their column. */
export function useChartWidth(initial = 640, min = 280) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(initial);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.max(min, entry.contentRect.width)));
    observer.observe(el);
    return () => observer.disconnect();
  }, [min]);
  return { ref, width };
}

/** Rounds up to a tidy axis maximum (10, 20, 25, 50, 100...). */
export function niceCeil(value: number): number {
  if (value <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const step = [1, 2, 2.5, 5, 10].find((s) => s * magnitude >= value) ?? 10;
  return step * magnitude;
}

/** "45s", "5m", "1h", "1h30m": seconds as a short duration label. */
export function shortDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  return m ? `${h}h${String(m).padStart(2, "0")}m` : `${h}h`;
}

/** "3h 20m": time spent, for hours of riding. */
export function hoursMinutes(seconds: number): string {
  return formatHours(seconds / 3600);
}

/** A short colored stroke and a label, as legends and readouts key their series. */
export function SeriesKey({ color, children }: { color: string; children: React.ReactNode }) {
  return (
    <span className="flex items-baseline gap-1.5">
      <span className="inline-block h-0.5 w-3 self-center rounded" style={{ background: color }} />
      {children}
    </span>
  );
}
