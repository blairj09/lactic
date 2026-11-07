"use client";

import { useState } from "react";
import { powerDistribution, type DistributionBin } from "@/lib/engine/analysis";
import { POWER_ZONE_LIMITS } from "@/lib/engine/workout";
import { hoursMinutes, niceCeil, SeriesKey, useChartWidth } from "./chart-utils";
import { useBrush } from "./use-brush";

export interface DistributionSeries {
  label: string;
  /** Seconds per 10 W bin. */
  histogram: number[];
  /** Seconds in zones 1 to 7. */
  zones: number[];
}

const MARGIN = { left: 44, right: 16, top: 22, bottom: 24 };
const HEIGHT = 240;
const COLORS = ["var(--series-1)", "var(--series-2)"];
const WIDTHS = [10, 20, 50];
const ZONE_NAMES = ["Active recovery", "Endurance", "Tempo", "Threshold", "VO2 max", "Anaerobic", "Neuromuscular"];

/**
 * Share of riding time per power bin. The first range is bars; a compared range is a step line over
 * them, so both read at once. Shares rather than hours, so ranges of different lengths compare.
 * Zone boundaries (from today's FTP) are marked; drag across to zoom into a span of watts.
 */
export default function PowerDistributionChart({ series, ftp }: { series: DistributionSeries[]; ftp: number | null }) {
  const { ref, width } = useChartWidth();
  const [binWidth, setBinWidth] = useState(20);
  const [coasting, setCoasting] = useState(false);
  const [zoom, setZoom] = useState<[number, number] | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  const plotWidth = width - MARGIN.left - MARGIN.right;

  const dists = series.map((s) => powerDistribution(s.histogram, binWidth, { includeCoasting: coasting }));
  const full: [number, number] = [0, defaultMax(dists, binWidth)];
  const [w0, w1] = zoom ?? full;
  const brush = useBrush(MARGIN.left, plotWidth, (from, to) => {
    const a = Math.floor((w0 + from * (w1 - w0)) / binWidth) * binWidth;
    const b = Math.ceil((w0 + to * (w1 - w0)) / binWidth) * binWidth;
    if (b - a >= 3 * binWidth) setZoom([a, b]);
  });

  if (!series.some((s) => s.histogram.length)) {
    return (
      <p className="text-sm text-muted">
        No power distribution for this range yet.
      </p>
    );
  }

  const x = (w: number) => MARGIN.left + ((w - w0) / (w1 - w0)) * plotWidth;
  const visible = (d: DistributionBin[]) => d.filter((b) => b.from + binWidth > w0 && b.from < w1);
  const yMax = niceCeil(Math.max(0.01, ...dists.flatMap((d) => visible(d).map((b) => b.share))) * 100) / 100;
  const y = (share: number) => MARGIN.top + (1 - share / yMax) * (HEIGHT - MARGIN.top - MARGIN.bottom);
  const base = y(0);
  const step = (d: DistributionBin[]) => {
    const bins = visible(d);
    if (!bins.length) return "";
    return (
      `M${x(Math.max(w0, bins[0].from)).toFixed(1)},${base}` +
      bins.map((b) => `V${y(b.share).toFixed(1)}H${x(Math.min(w1, b.from + binWidth)).toFixed(1)}`).join("") +
      `V${base}`
    );
  };
  const barWidth = Math.max(1, x(binWidth) - x(0) - 2);
  const zoneLines = ftp ? POWER_ZONE_LIMITS.map((f, i) => ({ watts: f * ftp, zone: i + 2 })).filter((z) => z.watts > w0 && z.watts < w1) : [];
  const ticks = wattTicks(w0, w1);

  const onPointer = (e: React.PointerEvent<SVGSVGElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    const watts = w0 + ((e.clientX - box.left - MARGIN.left) / plotWidth) * (w1 - w0);
    setHover(watts >= w0 && watts < w1 ? Math.floor(watts / binWidth) * binWidth : null);
    brush.handlers.onPointerMove?.(e);
  };
  const binAt = (d: DistributionBin[], from: number) => d.find((b) => b.from === from);
  const totalCounted = (d: DistributionBin[]) => d.reduce((sum, b) => sum + b.seconds, 0);
  const segment =
    "h-8 rounded px-2.5 text-sm text-muted transition-colors hover:text-ink aria-pressed:bg-surface aria-pressed:font-medium aria-pressed:text-ink aria-pressed:shadow-[0_0_0_1px_var(--line)]";

  return (
    <div ref={ref} className="space-y-2">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
        <div role="group" aria-label="Bin width" className="flex gap-0.5 rounded-md bg-raised p-0.5">
          {WIDTHS.map((w) => (
            <button key={w} type="button" aria-pressed={binWidth === w} className={segment} onClick={() => setBinWidth(w)}>
              {w} W
            </button>
          ))}
        </div>
        <label className="flex items-center gap-1.5 text-muted">
          <input type="checkbox" checked={coasting} onChange={(e) => setCoasting(e.target.checked)} />
          Include coasting (under 10 W)
        </label>
        {zoom && (
          <button type="button" className="ml-auto text-muted underline" onClick={() => setZoom(null)}>
            Show all power
          </button>
        )}
      </div>

      <div className="flex min-h-5 flex-wrap items-baseline gap-x-4 gap-y-1 text-sm tabular-nums">
        {hover !== null ? (
          <>
            <span className="text-muted">
              {hover}–{hover + binWidth} W
            </span>
            {dists.map((d, i) => {
              const b = binAt(d, hover);
              return (
                <SeriesKey key={i} color={COLORS[i]}>
                  <strong className="font-semibold">{b ? `${(b.share * 100).toFixed(1)}%` : "0%"}</strong>
                  <span className="text-muted">{b ? hoursMinutes(b.seconds) : "0m"}</span>
                </SeriesKey>
              );
            })}
          </>
        ) : (
          series.map((s, i) => (
            <SeriesKey key={i} color={COLORS[i]}>
              <span className="text-muted">
                {s.label}: {hoursMinutes(totalCounted(dists[i]))} with power
              </span>
            </SeriesKey>
          ))
        )}
      </div>

      <svg
        width={width}
        height={HEIGHT}
        role="img"
        aria-label="Power distribution: share of riding time in each power band"
        {...brush.handlers}
        onPointerMove={onPointer}
        onPointerLeave={() => setHover(null)}
        className="cursor-crosshair touch-none select-none"
      >
        {[0, yMax / 2, yMax].map((v) => (
          <g key={v}>
            <line x1={MARGIN.left} x2={width - MARGIN.right} y1={y(v)} y2={y(v)} className="stroke-[var(--grid)]" />
            <text x={MARGIN.left - 6} y={y(v) + 4} textAnchor="end" className="fill-muted text-[11px]">
              {Math.round(v * 1000) / 10}%
            </text>
          </g>
        ))}
        {ticks.map((t) => (
          <text key={t} x={x(t)} y={HEIGHT - 6} textAnchor="middle" className="fill-muted text-[11px]">
            {t} W
          </text>
        ))}
        {zoneLines.map((z) => (
          <g key={z.zone}>
            <line x1={x(z.watts)} x2={x(z.watts)} y1={MARGIN.top - 8} y2={base} className="stroke-control" strokeDasharray="2 3" />
            <text x={x(z.watts) + 3} y={MARGIN.top - 10} className="fill-muted text-[10px]">
              Z{z.zone}
            </text>
          </g>
        ))}
        {visible(dists[0]).map((b) => {
          const left = x(Math.max(w0, b.from)) + 1;
          const top = y(b.share);
          return (
            <rect
              key={b.from}
              x={left}
              width={Math.max(1, Math.min(barWidth, x(w1) - left))}
              y={top}
              height={Math.max(0, base - top)}
              rx={Math.min(2, barWidth / 2)}
              fill={COLORS[0]}
              opacity={hover === null || hover === b.from ? 1 : 0.55}
            />
          );
        })}
        {dists[1] && <path d={step(dists[1])} fill="none" stroke={COLORS[1]} strokeWidth={2} strokeLinejoin="round" />}
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
        <line x1={MARGIN.left} x2={width - MARGIN.right} y1={base} y2={base} className="stroke-control" />
      </svg>

      <ZoneTable series={series} ftp={ftp} />
    </div>
  );
}

/** Time in each zone per range, each ride against the FTP in effect that day. */
function ZoneTable({ series, ftp }: { series: DistributionSeries[]; ftp: number | null }) {
  const totals = series.map((s) => s.zones.reduce((a, b) => a + b, 0));
  if (!totals.some((t) => t > 0)) return <p className="text-sm text-muted">Time in zones needs an FTP on the days ridden.</p>;
  const limits = ftp ? [0, ...POWER_ZONE_LIMITS.map((f) => Math.round(f * ftp))] : null;
  return (
    <table className="w-full text-right text-sm tabular-nums">
      <thead className="text-muted">
        <tr>
          <th className="text-left font-normal">Zone</th>
          {series.map((s, i) => (
            <th key={i} className="font-normal" colSpan={2}>
              <span className="inline-flex justify-end">
                <SeriesKey color={COLORS[i]}>{s.label}</SeriesKey>
              </span>
            </th>
          ))}
          {series.length > 1 && <th className="font-normal">Change</th>}
        </tr>
      </thead>
      <tbody>
        {ZONE_NAMES.map((name, z) => {
          const shares = series.map((s, i) => (totals[i] ? s.zones[z] / totals[i] : 0));
          const range = limits ? (z < 6 ? `${limits[z]}–${limits[z + 1]} W` : `${limits[6]}+ W`) : "";
          return (
            <tr key={z} className="border-t border-rule">
              <td className="py-1 text-left">
                Z{z + 1} {name}
                {range && <span className="ml-2 text-xs text-muted">{range}</span>}
              </td>
              {series.map((s, i) => (
                <FragmentCells key={i} seconds={s.zones[z]} share={shares[i]} />
              ))}
              {series.length > 1 && (
                <td className="text-muted">
                  {shares[0] - shares[1] >= 0 ? "+" : "−"}
                  {Math.abs((shares[0] - shares[1]) * 100).toFixed(1)} pts
                </td>
              )}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function FragmentCells({ seconds, share }: { seconds: number; share: number }) {
  return (
    <>
      <td>{hoursMinutes(seconds)}</td>
      <td className="w-14 text-muted">{(share * 100).toFixed(1)}%</td>
    </>
  );
}

/** Upper watts that covers 99.5% of the counted time in every series, so a few sprints don't flatten the rest. */
function defaultMax(dists: DistributionBin[][], binWidth: number): number {
  let max = binWidth * 10;
  for (const d of dists) {
    let seen = 0;
    const total = d.reduce((sum, b) => sum + b.seconds, 0);
    for (const b of d) {
      seen += b.seconds;
      if (seen >= total * 0.995) {
        max = Math.max(max, b.from + binWidth);
        break;
      }
    }
  }
  return Math.ceil((max * 1.1) / 50) * 50;
}

function wattTicks(from: number, to: number): number[] {
  const span = to - from;
  const step = [25, 50, 100, 200, 250, 500].find((s) => span / s <= 8) ?? 1000;
  const ticks: number[] = [];
  for (let t = Math.ceil(from / step) * step; t <= to; t += step) ticks.push(t);
  return ticks;
}
