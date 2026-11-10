"use client";

import { useRef, useState } from "react";
import type { PowerCurve } from "@/lib/engine/power";
import { niceCeil, SeriesKey, shortDuration, useChartWidth } from "./chart-utils";
import { spaceTicks } from "./chart-ticks";
import { useBrush } from "./use-brush";

export interface CurveSeries {
  label: string;
  curve: PowerCurve;
}

const MARGIN = { left: 44, right: 16, top: 12, bottom: 24 };
const HEIGHT = 240;
const FULL: [number, number] = [1, 3600];
const TICKS = [1, 5, 15, 30, 60, 120, 300, 600, 1200, 1800, 3600];
const COLORS = ["var(--series-1)", "var(--series-2)"];

/**
 * Best power for each duration, on a log time axis, for a range and optionally a range to compare
 * against. Hover reads both at a duration; drag across to zoom into a span of durations.
 */
export default function PowerCurveChart({
  series,
  picked = null,
  onPick,
}: {
  series: CurveSeries[];
  /** A duration chosen with a click, marked on the chart. */
  picked?: number | null;
  /** With this, a click (not a drag) picks the duration under the pointer. */
  onPick?: (duration: number) => void;
}) {
  const downX = useRef<number | null>(null);
  const { ref, width } = useChartWidth();
  const [domain, setDomain] = useState<[number, number]>(FULL);
  const [hover, setHover] = useState<number | null>(null);
  const plotWidth = width - MARGIN.left - MARGIN.right;
  const [lo, hi] = domain.map(Math.log);
  const brush = useBrush(MARGIN.left, plotWidth, (from, to) => {
    const next: [number, number] = [Math.exp(lo + from * (hi - lo)), Math.exp(lo + to * (hi - lo))];
    // Keep at least two standard durations in view.
    if (durationsIn(series, next).length >= 2) setDomain(next);
  });

  const durations = durationsIn(series, domain);
  if (!series.some((s) => Object.keys(s.curve).length)) {
    return <p className="text-sm text-muted">No rides with power in this range.</p>;
  }

  const x = (d: number) => MARGIN.left + ((Math.log(d) - lo) / (hi - lo)) * plotWidth;
  const yMax = niceCeil(Math.max(100, ...series.flatMap((s) => durations.map((d) => s.curve[d] ?? 0))) * 1.05);
  const y = (w: number) => MARGIN.top + (1 - w / yMax) * (HEIGHT - MARGIN.top - MARGIN.bottom);
  const path = (curve: PowerCurve) =>
    durations
      .filter((d) => curve[d] !== undefined)
      .map((d, i) => `${i ? "L" : "M"}${x(d).toFixed(1)},${y(curve[d]).toFixed(1)}`)
      .join("");
  const shown = hover ?? durations.find((d) => d >= 1200) ?? durations.at(-1)!;
  const zoomed = domain[0] !== FULL[0] || domain[1] !== FULL[1];

  const onPointer = (e: React.PointerEvent<SVGSVGElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    const at = Math.exp(lo + ((e.clientX - box.left - MARGIN.left) / plotWidth) * (hi - lo));
    setHover(durations.reduce((best, d) => (Math.abs(Math.log(d / at)) < Math.abs(Math.log(best / at)) ? d : best), durations[0]));
    brush.handlers.onPointerMove?.(e);
  };

  const [a, b] = series;
  const va = a?.curve[shown];
  const vb = b?.curve[shown];

  return (
    <div ref={ref} className="space-y-1">
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-sm tabular-nums">
        <span className="w-10 text-muted">{shortDuration(shown)}</span>
        {series.map((s, i) => (
          <SeriesKey key={i} color={COLORS[i]}>
            <strong className="font-semibold">{s.curve[shown] !== undefined ? `${Math.round(s.curve[shown])} W` : "–"}</strong>
            <span className="text-muted">{s.label}</span>
          </SeriesKey>
        ))}
        {va !== undefined && vb !== undefined && vb > 0 && (
          <span className="text-muted">
            {va >= vb ? "+" : "−"}
            {Math.abs(Math.round(va - vb))} W ({va >= vb ? "+" : "−"}
            {Math.abs(((va - vb) / vb) * 100).toFixed(1)}%)
          </span>
        )}
        {zoomed && (
          <button type="button" className="ml-auto text-muted underline" onClick={() => setDomain(FULL)}>
            Show all durations
          </button>
        )}
      </div>

      <svg
        width={width}
        height={HEIGHT}
        role="img"
        aria-label="Power curve: best average power for each duration"
        {...brush.handlers}
        onPointerDown={(e) => {
          downX.current = e.clientX;
          brush.handlers.onPointerDown?.(e);
        }}
        onClick={(e) => {
          if (onPick && hover !== null && downX.current !== null && Math.abs(e.clientX - downX.current) < 6) onPick(hover);
        }}
        onPointerMove={onPointer}
        onPointerLeave={() => setHover(null)}
        className="cursor-crosshair touch-none select-none"
      >
        {[0, yMax / 2, yMax].map((v) => (
          <g key={v}>
            <line x1={MARGIN.left} x2={width - MARGIN.right} y1={y(v)} y2={y(v)} className="stroke-[var(--grid)]" />
            <text x={MARGIN.left - 6} y={y(v) + 4} textAnchor="end" className="fill-muted text-[11px]">
              {v} W
            </text>
          </g>
        ))}
        {spaceTicks(TICKS.filter((t) => t >= domain[0] - 1e-9 && t <= domain[1] + 1e-9), x, shortDuration).map((t) => (
          <text key={t} x={x(t)} y={HEIGHT - 6} textAnchor="middle" className="fill-muted text-[11px]">
            {shortDuration(t)}
          </text>
        ))}
        {brush.selection && (
          <rect
            x={MARGIN.left + brush.selection.from * plotWidth}
            width={(brush.selection.to - brush.selection.from) * plotWidth}
            y={MARGIN.top}
            height={HEIGHT - MARGIN.top - MARGIN.bottom}
            fill="var(--series-1)"
            opacity={0.12}
          />
        )}
        {[...series].reverse().map((s, ri) => {
          const i = series.length - 1 - ri;
          return <path key={i} d={path(s.curve)} fill="none" stroke={COLORS[i]} strokeWidth={2} strokeLinejoin="round" />;
        })}
        {picked !== null && picked >= domain[0] && picked <= domain[1] && (
          <line x1={x(picked)} x2={x(picked)} y1={MARGIN.top} y2={HEIGHT - MARGIN.bottom} stroke="var(--warning)" strokeWidth={2} />
        )}
        {hover !== null && (
          <>
            <line x1={x(hover)} x2={x(hover)} y1={MARGIN.top} y2={HEIGHT - MARGIN.bottom} className="stroke-faint" />
            {series.map((s, i) =>
              s.curve[hover] === undefined ? null : (
                <circle key={i} cx={x(hover)} cy={y(s.curve[hover])} r={4} fill={COLORS[i]} className="stroke-[var(--background)]" strokeWidth={2} />
              ),
            )}
          </>
        )}
      </svg>

      <details className="text-sm">
        <summary className="cursor-pointer text-muted">Show as a table</summary>
        <table className="mt-2 w-full max-w-md text-right tabular-nums">
          <thead className="text-muted">
            <tr>
              <th className="text-left font-normal">Duration</th>
              {series.map((s, i) => (
                <th key={i} className="font-normal">
                  {s.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {durationsIn(series, FULL).map((d) => (
              <tr key={d}>
                <td className="text-left">{shortDuration(d)}</td>
                {series.map((s, i) => (
                  <td key={i}>{s.curve[d] !== undefined ? `${Math.round(s.curve[d])} W` : "–"}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}

/** Durations any series has, inside the domain, ascending. */
function durationsIn(series: CurveSeries[], [from, to]: [number, number]): number[] {
  const all = new Set(series.flatMap((s) => Object.keys(s.curve).map(Number)));
  return [...all].filter((d) => d >= from - 1e-9 && d <= to + 1e-9).sort((p, q) => p - q);
}
