"use client";

import { useEffect, useRef, useState } from "react";
import { niceCeil } from "./chart-utils";
import { useBrush } from "./use-brush";

export interface ChartDay {
  date: string;
  fitness: number;
  fatigue: number;
  form: number;
}

const MARGIN = { left: 36, right: 64, top: 12, bottom: 22 };
const TOP_HEIGHT = 190;
const FORM_HEIGHT = 110;

export interface ChartMarker {
  date: string;
  label: string;
}

/**
 * Fitness and fatigue on one chart, form on its own below (it centers on zero, so it gets its own
 * axis rather than a second scale). One crosshair drives both. From `forecastFrom` on, lines are
 * dashed: a projection, not history. Markers (events) are labeled vertical lines. With `onZoom`,
 * dragging across either chart selects a span of days to zoom to.
 */
export default function FitnessChart({
  days,
  label = "over the last 90 days",
  forecastFrom,
  markers = [],
  onZoom,
}: {
  days: ChartDay[];
  label?: string;
  forecastFrom?: string;
  markers?: ChartMarker[];
  /** Called with the first and last day (YYYY-MM-DD) of a dragged selection. */
  onZoom?: (from: string, to: string) => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(640);
  const [hoverIndex, setHover] = useState<number | null>(null);
  const plotWidth = width - MARGIN.left - MARGIN.right;
  const brush = useBrush(
    MARGIN.left,
    plotWidth,
    onZoom &&
      ((from, to) => {
        const last = days.length - 1;
        onZoom(days[Math.round(from * last)].date, days[Math.round(to * last)].date);
      }),
  );

  useEffect(() => {
    const el = container.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.max(280, entry.contentRect.width)));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  if (days.length < 2) return <p className="text-sm text-muted">Fitness shows up once you have a few rides.</p>;

  const x = (i: number) => MARGIN.left + (i / (days.length - 1)) * plotWidth;
  const topMax = niceCeil(Math.max(10, ...days.map((d) => Math.max(d.fitness, d.fatigue))));
  const formExtent = niceCeil(Math.max(10, ...days.map((d) => Math.abs(d.form))));
  const yTop = (v: number) => MARGIN.top + (1 - v / topMax) * (TOP_HEIGHT - MARGIN.top - MARGIN.bottom);
  const yForm = (v: number) => MARGIN.top + ((formExtent - v) / (2 * formExtent)) * (FORM_HEIGHT - MARGIN.top - MARGIN.bottom);
  const path = (values: number[], y: (v: number) => number, from = 0, to = values.length - 1) =>
    values
      .slice(from, to + 1)
      .map((v, i) => `${i ? "L" : "M"}${x(from + i).toFixed(1)},${y(v).toFixed(1)}`)
      .join("");
  const split = forecastFrom ? days.findIndex((d) => d.date >= forecastFrom) : -1;
  // History solid, forecast dashed, sharing the point where they meet.
  const line = (values: number[], y: (v: number) => number, color: string) =>
    split > 0 ? (
      <>
        <path d={path(values, y, 0, split)} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" />
        <path d={path(values, y, split)} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeDasharray="5 4" />
      </>
    ) : (
      <path d={path(values, y)} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeDasharray={split === 0 ? "5 4" : undefined} />
    );
  const markerLines = (height: number, labels: boolean) =>
    markers.flatMap((m) => {
      const i = days.findIndex((d) => d.date === m.date);
      if (i < 0) return [];
      return [
        <g key={m.date + m.label}>
          <line x1={x(i)} x2={x(i)} y1={MARGIN.top} y2={height - MARGIN.bottom} className="stroke-faint" strokeDasharray="2 3" />
          {labels && (
            <text x={x(i) - 4} y={MARGIN.top + 10} textAnchor="end" className="fill-muted text-[11px]">
              {m.label}
            </text>
          )}
        </g>,
      ];
    });

  const last = days.length - 1;
  // A hover from before the days changed (a zoom) may point past the end.
  const hover = hoverIndex !== null && hoverIndex <= last ? hoverIndex : null;
  const shown = hover ?? last;
  const day = days[shown];
  const monthTicks = axisTicks(days.map((d) => d.date));

  const onPointer = (e: React.PointerEvent<SVGSVGElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    const fraction = (e.clientX - box.left - MARGIN.left) / plotWidth;
    setHover(Math.min(last, Math.max(0, Math.round(fraction * last))));
    brush.handlers.onPointerMove?.(e);
  };
  const pointerProps = {
    ...brush.handlers,
    onPointerMove: onPointer,
    onPointerLeave: () => setHover(null),
    className: `touch-none select-none ${onZoom ? "cursor-crosshair" : ""}`,
  };
  const selectionBand = (height: number) =>
    brush.selection && (
      <rect
        x={MARGIN.left + brush.selection.from * plotWidth}
        width={(brush.selection.to - brush.selection.from) * plotWidth}
        y={MARGIN.top}
        height={height - MARGIN.top - MARGIN.bottom}
        fill="var(--series-1)"
        opacity={0.12}
      />
    );

  const crosshair = (height: number) =>
    hover !== null && <line x1={x(hover)} x2={x(hover)} y1={MARGIN.top} y2={height - MARGIN.bottom} className="stroke-faint" strokeWidth={1} />;

  const axisLabels = (height: number) =>
    monthTicks.map((i) => (
      <text key={i} x={x(i)} y={height - 6} textAnchor="middle" className="fill-muted text-[11px]">
        {tickLabel(days[i].date, days.length)}
      </text>
    ));

  return (
    <div ref={container} className="viz space-y-1">
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-sm tabular-nums">
        <span className="text-muted">{formatDate(day.date)}</span>
        <Key color="var(--series-1)" label="Fitness" value={day.fitness} />
        <Key color="var(--series-2)" label="Fatigue" value={day.fatigue} />
        <Key color="var(--series-3)" label="Form" value={day.form} signed />
      </div>

      <svg
        width={width}
        height={TOP_HEIGHT}
        role="img"
        aria-label={`Fitness and fatigue ${label}`}
        {...pointerProps}
      >
        {selectionBand(TOP_HEIGHT)}
        {[0, topMax / 2, topMax].map((v) => (
          <g key={v}>
            <line x1={MARGIN.left} x2={width - MARGIN.right} y1={yTop(v)} y2={yTop(v)} className="stroke-[var(--grid)]" />
            <text x={MARGIN.left - 6} y={yTop(v) + 4} textAnchor="end" className="fill-muted text-[11px]">
              {v}
            </text>
          </g>
        ))}
        {axisLabels(TOP_HEIGHT)}
        {markerLines(TOP_HEIGHT, true)}
        {line(days.map((d) => d.fatigue), yTop, "var(--series-2)")}
        {line(days.map((d) => d.fitness), yTop, "var(--series-1)")}
        <text x={x(last) + 6} y={yTop(days[last].fitness) + 4} className="fill-ink text-[11px]">
          Fitness
        </text>
        <text x={x(last) + 6} y={yTop(days[last].fatigue) + (days[last].fatigue > days[last].fitness ? -2 : 12)} className="fill-ink text-[11px]">
          Fatigue
        </text>
        {crosshair(TOP_HEIGHT)}
        {hover !== null && (
          <>
            <circle cx={x(hover)} cy={yTop(day.fatigue)} r={4} fill="var(--series-2)" className="stroke-[var(--background)]" strokeWidth={2} />
            <circle cx={x(hover)} cy={yTop(day.fitness)} r={4} fill="var(--series-1)" className="stroke-[var(--background)]" strokeWidth={2} />
          </>
        )}
      </svg>

      <svg
        width={width}
        height={FORM_HEIGHT}
        role="img"
        aria-label={`Form ${label}`}
        {...pointerProps}
      >
        {selectionBand(FORM_HEIGHT)}
        {[-formExtent, 0, formExtent].map((v) => (
          <g key={v}>
            <line
              x1={MARGIN.left}
              x2={width - MARGIN.right}
              y1={yForm(v)}
              y2={yForm(v)}
              className={v === 0 ? "stroke-control" : "stroke-[var(--grid)]"}
            />
            <text x={MARGIN.left - 6} y={yForm(v) + 4} textAnchor="end" className="fill-muted text-[11px]">
              {v > 0 ? `+${v}` : v}
            </text>
          </g>
        ))}
        {axisLabels(FORM_HEIGHT)}
        {markerLines(FORM_HEIGHT, false)}
        {line(days.map((d) => d.form), yForm, "var(--series-3)")}
        <text x={x(last) + 6} y={yForm(days[last].form) + 4} className="fill-ink text-[11px]">
          Form
        </text>
        {crosshair(FORM_HEIGHT)}
        {hover !== null && <circle cx={x(hover)} cy={yForm(day.form)} r={4} fill="var(--series-3)" className="stroke-[var(--background)]" strokeWidth={2} />}
      </svg>

      {!forecastFrom && (
        <details className="text-sm">
          <summary className="cursor-pointer text-muted">Show the last 14 days as a table</summary>
          <table className="mt-2 w-full max-w-md text-right tabular-nums">
            <thead className="text-muted">
              <tr>
                <th className="text-left font-normal">Day</th>
                <th className="font-normal">Fitness</th>
                <th className="font-normal">Fatigue</th>
                <th className="font-normal">Form</th>
              </tr>
            </thead>
            <tbody>
              {days.slice(-14).reverse().map((d) => (
                <tr key={d.date}>
                  <td className="text-left">{formatDate(d.date)}</td>
                  <td>{Math.round(d.fitness)}</td>
                  <td>{Math.round(d.fatigue)}</td>
                  <td>{signed(d.form)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}
    </div>
  );
}

function Key({ color, label, value, signed: showSign }: { color: string; label: string; value: number; signed?: boolean }) {
  return (
    <span className="flex items-baseline gap-1.5">
      <span className="inline-block h-0.5 w-3 self-center rounded" style={{ background: color }} />
      <strong className="font-semibold">{showSign ? signed(value) : Math.round(value)}</strong>
      <span className="text-muted">{label}</span>
    </span>
  );
}

const signed = (v: number) => {
  const r = Math.round(v);
  return r > 0 ? `+${r}` : String(r);
};

const formatDate = (iso: string) =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });

/** Tick positions for a span of days: weekly (Mondays) under ~10 weeks, monthly under ~1.5 years, else quarterly. */
function axisTicks(dates: string[]): number[] {
  const n = dates.length;
  const weekday = (d: string) => new Date(`${d}T12:00:00Z`).getUTCDay();
  if (n <= 70) return dates.flatMap((d, i) => (weekday(d) === 1 ? [i] : []));
  const months = n <= 550 ? ["01", "02", "03", "04", "05", "06", "07", "08", "09", "10", "11", "12"] : ["01", "04", "07", "10"];
  return dates.flatMap((d, i) => (d.endsWith("-01") && months.includes(d.slice(5, 7)) ? [i] : []));
}

function tickLabel(date: string, span: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  if (span <= 70) return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  // January carries the year once a span crosses one.
  if (span > 300 && date.slice(5, 7) === "01") return String(d.getUTCFullYear());
  return d.toLocaleString("en-US", { month: "short", timeZone: "UTC" });
}
