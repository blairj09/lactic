"use client";

import { useState } from "react";
import { useChartWidth } from "./chart-utils";

const MARGIN = { left: 36, right: 8, top: 12, bottom: 22 };

/** 1, 2, 2.5 or 5 times a power of ten: the smallest tidy step at least `raw`. */
function niceStep(raw: number): number {
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  return ([1, 2, 2.5, 5, 10].find((s) => s * magnitude >= raw) ?? 10) * magnitude;
}

const shortDay = (day: string) =>
  new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "short", day: "numeric" }).format(new Date(`${day}T00:00:00Z`));

/**
 * One measure over a run of days: a thin line through the days that have a value (broken where they don't),
 * dots on the latest value and on days that stand alone, and an optional dashed reference line for your normal. Hovering shows the day's value.
 * `days` is every day in the window, oldest first; `values` lines up with it.
 */
export default function TrendChart({
  days,
  values,
  normal,
  unit = "",
  decimals = 0,
  signed = false,
  domain,
  bridge = false,
  normalLabel = "Your usual",
  label,
  height: HEIGHT = 128,
}: {
  days: string[];
  values: (number | null)[];
  normal?: number | null;
  unit?: string;
  decimals?: number;
  /** Show a + on positive values (changes against normal). */
  signed?: boolean;
  /** A fixed y range, such as 0 to 100 for the score. Otherwise it fits the data and the normal. */
  domain?: [number, number];
  /** Join values across empty days (weigh-ins every few days) instead of breaking the line. */
  bridge?: boolean;
  /** The key under the chart for the dashed line. */
  normalLabel?: string;
  /** What the chart shows, for screen readers. */
  label: string;
  /** Chart height in px; the detail views draw it taller. */
  height?: number;
}) {
  const { ref, width } = useChartWidth(320, 240);
  const [hover, setHover] = useState<number | null>(null);
  const format = (v: number) => `${signed && v > 0 ? "+" : ""}${v.toFixed(decimals)}${unit && unit !== "%" && !unit.startsWith("/") ? " " : ""}${unit}`;

  const present = values.flatMap((v, i) => (v === null ? [] : [i]));
  const plotWidth = width - MARGIN.left - MARGIN.right;
  const plotHeight = HEIGHT - MARGIN.top - MARGIN.bottom;
  const x = (i: number) => MARGIN.left + (days.length > 1 ? (i / (days.length - 1)) * plotWidth : plotWidth / 2);

  const known = [...present.map((i) => values[i]!), ...(normal != null ? [normal] : [])];
  let [low, high] = domain ?? (known.length ? [Math.min(...known), Math.max(...known)] : [0, 1]);
  let step = domain ? (high - low) / 2 : 0;
  if (!domain) {
    // Two or three tidy steps that cover the data with a little room.
    step = niceStep(Math.max((high - low) * 1.2, 2 * 10 ** -decimals) / 2);
    low = Math.floor(low / step) * step;
    high = Math.max(Math.ceil(high / step) * step, low + step);
  }
  const y = (v: number) => MARGIN.top + (1 - (v - low) / (high - low)) * plotHeight;
  const ticks = Array.from({ length: Math.round((high - low) / step) + 1 }, (_, i) => low + i * step);

  // Runs of consecutive days with values, so a missing night breaks the line instead of bridging it.
  const runs: number[][] = [];
  for (const i of present) {
    const run = runs.at(-1);
    if (run && (bridge || run.at(-1) === i - 1)) run.push(i);
    else runs.push([i]);
  }

  const onMove = (event: React.PointerEvent<SVGRectElement>) => {
    if (!present.length) return;
    const box = event.currentTarget.getBoundingClientRect();
    const at = ((event.clientX - box.left) / box.width) * (days.length - 1);
    setHover(present.reduce((best, i) => (Math.abs(i - at) < Math.abs(best - at) ? i : best), present[0]));
  };

  return (
    <div ref={ref} className="relative">
      <svg width={width} height={HEIGHT} role="img" aria-label={label} className="block overflow-visible">
        {ticks.map((t, i) => (
          <g key={i}>
            <line x1={MARGIN.left} x2={width - MARGIN.right} y1={y(t)} y2={y(t)} stroke="var(--rule)" />
            <text x={MARGIN.left - 6} y={y(t)} dy="0.32em" textAnchor="end" className="num fill-faint text-[11px]">
              {t.toFixed(step < 1 ? Math.max(decimals, 1) : 0)}
            </text>
          </g>
        ))}
        {normal != null && (
          <g>
            <line x1={MARGIN.left} x2={width - MARGIN.right} y1={y(normal)} y2={y(normal)} stroke="var(--faint)" strokeDasharray="3 3" />
          </g>
        )}
        {runs.map((run) =>
          run.length > 1 ? (
            <path
              key={run[0]}
              d={run.map((i, k) => `${k ? "L" : "M"}${x(i).toFixed(1)},${y(values[i]!).toFixed(1)}`).join("")}
              fill="none"
              stroke="var(--accent)"
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          ) : null,
        )}
        {present
          .filter((i) => i === hover || i === present.at(-1) || runs.some((run) => run.length === 1 && run[0] === i))
          .map((i) => (
            <circle key={i} cx={x(i)} cy={y(values[i]!)} r={4} fill="var(--accent)" stroke="var(--surface)" strokeWidth={2} />
          ))}
        {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={MARGIN.top} y2={HEIGHT - MARGIN.bottom} stroke="var(--faint)" />}
        {[0, days.length - 1].map((i) => (
          <text key={i} x={x(i)} y={HEIGHT - 6} textAnchor={i ? "end" : "start"} className="num fill-faint text-[11px]">
            {shortDay(days[i])}
          </text>
        ))}
        <rect
          x={MARGIN.left}
          y={0}
          width={plotWidth}
          height={HEIGHT}
          fill="transparent"
          onPointerMove={onMove}
          onPointerLeave={() => setHover(null)}
        />
      </svg>
      {normal != null && (
        <div className="mt-1 flex items-center gap-1.5 text-xs text-muted">
          <svg width="14" height="2" aria-hidden>
            <line x1="0" x2="14" y1="1" y2="1" stroke="var(--faint)" strokeDasharray="3 2" />
          </svg>
          <span>
            {normalLabel}, <span className="num">{format(normal)}</span>
          </span>
        </div>
      )}
      {!present.length && <p className="absolute inset-0 flex items-center justify-center text-sm text-muted">No nights yet.</p>}
      {hover !== null && (
        <div
          className="pointer-events-none absolute top-0 z-10 rounded-md border border-line bg-raised px-2 py-1 text-xs whitespace-nowrap shadow-sm"
          style={{ left: Math.min(Math.max(x(hover), 60), width - 60), transform: "translateX(-50%)" }}
        >
          <span className="text-muted">{shortDay(days[hover])}</span> <span className="num font-medium">{format(values[hover]!)}</span>
        </div>
      )}
    </div>
  );
}
