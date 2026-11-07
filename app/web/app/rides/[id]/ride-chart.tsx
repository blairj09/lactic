"use client";

import { useEffect, useState } from "react";
import { niceCeil, SeriesKey, shortDuration, useChartWidth } from "@/components/chart-utils";
import { useBrush } from "@/components/use-brush";
import type { ChartStream } from "@/lib/engine/ride-detail";

const MARGIN = { left: 44, right: 12, top: 8, bottom: 22 };

/** Ride seconds, from and to. */
export type Span = [number, number];

/**
 * Power over the ride with the target behind it, then heart rate and cadence, on one time axis.
 * Hover reads every channel at that moment; drag across to zoom to a span (`zoom`, null for the
 * whole ride) and double-click to go back to the whole ride. `onSelecting` follows the span while
 * it's being dragged. `highlight` shades a span, such as a best effort.
 */
export default function RideChart({
  stream,
  targetLabel,
  zoom,
  onZoom,
  onSelecting,
  highlight,
}: {
  stream: ChartStream;
  targetLabel: string;
  zoom: Span | null;
  onZoom: (span: Span | null) => void;
  onSelecting?: (span: Span | null) => void;
  highlight: Span | null;
}) {
  const { ref, width } = useChartWidth();
  const [hover, setHover] = useState<number | null>(null);
  const length = Math.max(stream.watts?.length ?? 0, stream.heartRate?.length ?? 0, stream.cadence?.length ?? 0, stream.target?.length ?? 0);
  const plotWidth = width - MARGIN.left - MARGIN.right;
  // The points in view, as indexes into the stream.
  const first = zoom ? Math.max(0, Math.floor(zoom[0] / stream.step)) : 0;
  const last = zoom ? Math.min(length - 1, Math.ceil(zoom[1] / stream.step)) : length - 1;
  const toSpan = (from: number, to: number): Span => [Math.round(first + from * (last - first)) * stream.step, Math.round(first + to * (last - first)) * stream.step];
  const brush = useBrush(MARGIN.left, plotWidth, (from, to) => {
    const span = toSpan(from, to);
    // At least a few points, so a zoom never shows an empty chart.
    if (span[1] - span[0] >= 3 * stream.step) onZoom(span);
  });
  const dragFrom = brush.selection?.from ?? null;
  const dragTo = brush.selection?.to ?? null;
  const dragSpan = dragFrom !== null && dragTo !== null && dragTo > dragFrom ? toSpan(dragFrom, dragTo) : null;
  const dragKey = dragSpan ? `${dragSpan[0]}-${dragSpan[1]}` : "";
  useEffect(() => {
    onSelecting?.(dragSpan);
    // dragKey stands for dragSpan, which is a new array every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dragKey, onSelecting]);
  if (length < 2) return <p className="text-sm text-muted">No readings stored for this ride.</p>;

  const x = (i: number) => MARGIN.left + ((i - first) / Math.max(1, last - first)) * plotWidth;
  const at = hover ?? null;
  const read = (values: (number | null)[] | null) => (values && at !== null ? values[at] : null);
  const ticks = timeTicks(first * stream.step, last * stream.step);
  const view = <T,>(values: T[]) => values.map((v, i) => (i >= first && i <= last ? v : null));

  const onPointer = (e: React.PointerEvent<SVGSVGElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    const i = first + Math.round(((e.clientX - box.left - MARGIN.left) / plotWidth) * (last - first));
    setHover(Math.min(last, Math.max(first, i)));
    brush.handlers.onPointerMove?.(e);
  };

  const charts: { key: string; label: string; unit: string; values: (number | null)[]; color: string; height: number; target?: (number | null)[] | null }[] = [];
  if (stream.watts || stream.target) charts.push({ key: "power", label: "Power", unit: "W", values: stream.watts ?? [], color: "var(--series-1)", height: 200, target: stream.target });
  if (stream.heartRate) charts.push({ key: "hr", label: "Heart rate", unit: "bpm", values: stream.heartRate, color: "var(--trace-hr)", height: 90 });
  if (stream.cadence) charts.push({ key: "cadence", label: "Cadence", unit: "rpm", values: stream.cadence, color: "var(--trace-cadence)", height: 90 });

  // Average and max of each channel over what's in view (max of the 5 s means).
  const stats = charts.flatMap((chart) => {
    const shown = chart.values.slice(first, last + 1).filter((v): v is number => v !== null);
    const counted = chart.key === "power" ? shown : shown.filter((v) => v > 0);
    if (!counted.length || !counted.some((v) => v > 0)) return [];
    return [{ key: chart.key, label: chart.label, unit: chart.unit, color: chart.color, avg: Math.round(counted.reduce((a, b) => a + b, 0) / counted.length), max: Math.max(...counted) }];
  });

  return (
    <div ref={ref} className="space-y-2">
      <dl className="num grid grid-cols-1 gap-px overflow-hidden rounded-md border border-line bg-line text-sm sm:grid-cols-3">
        {stats.map((s) => (
          <div key={s.key} className="bg-surface px-3 py-2">
            <dt className="text-muted">
              <SeriesKey color={s.color}>{s.label}{zoom ? ", selection" : ""}</SeriesKey>
            </dt>
            <dd>
              <span className="text-base font-medium">{s.avg}</span> <span className="text-muted">{s.unit} avg</span>
              <span className="ml-3 text-base font-medium">{s.max}</span> <span className="text-muted">max</span>
            </dd>
          </div>
        ))}
      </dl>
      <div className="num flex min-h-5 flex-wrap gap-x-4 gap-y-1 text-sm text-muted">
        {at === null ? (
          <span>{zoom ? `${clock(zoom[0])} to ${clock(zoom[1])}. Double-click for the whole ride.` : "Hover to read the chart; drag across it to zoom in."}</span>
        ) : (
          <>
            <span className="text-ink">{clock(at * stream.step)}</span>
            {stream.watts && <SeriesKey color="var(--series-1)">{read(stream.watts)} W</SeriesKey>}
            {stream.target && <SeriesKey color="var(--zone-3)">{read(stream.target) ?? "free"}{read(stream.target) !== null && " W"} {targetLabel.toLowerCase()}</SeriesKey>}
            {stream.heartRate && <SeriesKey color="var(--trace-hr)">{read(stream.heartRate) || "–"} bpm</SeriesKey>}
            {stream.cadence && <SeriesKey color="var(--trace-cadence)">{read(stream.cadence)} rpm</SeriesKey>}
          </>
        )}
        {zoom && (
          <button type="button" className="ml-auto text-muted underline hover:text-ink" onClick={() => onZoom(null)}>
            Whole ride
          </button>
        )}
      </div>
      {charts.map((chart, n) => {
        const lastChart = n === charts.length - 1;
        const height = chart.height + (lastChart ? MARGIN.bottom : 0);
        const bottom = MARGIN.top + chart.height - 4;
        const values = view(chart.values);
        const target = chart.target ? view(chart.target) : null;
        const nonZero = values.filter((v): v is number => v !== null && v > 0);
        const targetMax = Math.max(0, ...(target ?? []).map((v) => v ?? 0));
        const yMax = niceCeil(Math.max(chart.key === "hr" ? 120 : 50, ...nonZero, targetMax) * 1.05);
        const yMin = chart.key !== "power" && nonZero.length ? Math.max(0, Math.floor((Math.min(...nonZero) - 10) / 10) * 10) : 0;
        const y = (v: number) => MARGIN.top + (1 - (v - yMin) / (yMax - yMin)) * (chart.height - MARGIN.top - 4);
        return (
          <svg
            key={chart.key}
            width={width}
            height={height}
            className="block cursor-crosshair touch-none select-none"
            role="img"
            aria-label={`${chart.label} over the ride`}
            {...brush.handlers}
            onPointerMove={onPointer}
            onPointerLeave={() => setHover(null)}
            onDoubleClick={() => zoom && onZoom(null)}
          >
            {highlight && highlight[1] >= first * stream.step && highlight[0] <= last * stream.step && (
              <rect
                x={Math.max(MARGIN.left, x(highlight[0] / stream.step))}
                width={Math.max(2, Math.min(width - MARGIN.right, x(highlight[1] / stream.step)) - Math.max(MARGIN.left, x(highlight[0] / stream.step)))}
                y={MARGIN.top}
                height={bottom - MARGIN.top}
                fill="var(--warning)"
                opacity={0.18}
              />
            )}
            {brush.selection && (
              <rect x={MARGIN.left + brush.selection.from * plotWidth} width={(brush.selection.to - brush.selection.from) * plotWidth} y={MARGIN.top} height={bottom - MARGIN.top} fill="var(--series-1)" opacity={0.12} />
            )}
            {[yMin, (yMin + yMax) / 2, yMax].map((v) => (
              <g key={v}>
                <line x1={MARGIN.left} x2={width - MARGIN.right} y1={y(v)} y2={y(v)} stroke="var(--grid)" />
                <text x={MARGIN.left - 6} y={y(v) + 4} textAnchor="end" className="num fill-muted text-[11px]">
                  {Math.round(v)}
                </text>
              </g>
            ))}
            <text x={MARGIN.left + 4} y={MARGIN.top + 12} className="fill-muted text-[11px]">
              {chart.label} ({chart.unit})
            </text>
            {target && <path d={area(target, x, y, bottom)} fill="var(--zone-2)" opacity={0.55} />}
            <path d={line(values, x, y, chart.key === "hr")} fill="none" stroke={chart.color} strokeWidth={1.25} strokeLinejoin="round" />
            {at !== null && <line x1={x(at)} x2={x(at)} y1={MARGIN.top} y2={bottom} stroke="var(--muted)" strokeDasharray="2 3" />}
            {lastChart &&
              ticks.map((t) => (
                <text key={t} x={x(t / stream.step)} y={chart.height + 14} textAnchor="middle" className="num fill-muted text-[11px]">
                  {shortDuration(t)}
                </text>
              ))}
          </svg>
        );
      })}
    </div>
  );
}

/** A line through the points; zeros break it when `gaps` (a dropped heart rate strap). */
function line(values: (number | null)[], x: (i: number) => number, y: (v: number) => number, gaps: boolean): string {
  let d = "";
  let pen = false;
  values.forEach((v, i) => {
    if (v === null || (gaps && v <= 0)) {
      pen = false;
      return;
    }
    d += `${pen ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`;
    pen = true;
  });
  return d;
}

/** The target as a filled step shape down to the axis; free ride leaves a gap. */
function area(values: (number | null)[], x: (i: number) => number, y: (v: number) => number, bottom: number): string {
  let d = "";
  let open = -1;
  const close = (i: number) => {
    if (open < 0) return;
    d += `L${x(i).toFixed(1)},${bottom}L${x(open).toFixed(1)},${bottom}Z`;
    open = -1;
  };
  values.forEach((v, i) => {
    if (v === null || v <= 0) return close(i);
    if (open < 0) {
      open = i;
      d += `M${x(i).toFixed(1)},${y(v).toFixed(1)}`;
    } else d += `L${x(i).toFixed(1)},${y(v).toFixed(1)}`;
  });
  close(values.length - 1);
  return d;
}

function timeTicks(from: number, to: number): number[] {
  const step = [15, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200].find((s) => (to - from) / s <= 7) ?? 7200;
  const ticks: number[] = [];
  for (let t = Math.ceil(from / step) * step; t <= to; t += step) ticks.push(t);
  return ticks;
}

const clock = (seconds: number) => {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return `${h ? `${h}:${String(m).padStart(2, "0")}` : m}:${String(s).padStart(2, "0")}`;
};
