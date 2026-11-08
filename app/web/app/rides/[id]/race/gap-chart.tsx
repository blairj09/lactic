"use client";

import { useState } from "react";
import { useChartWidth } from "@/components/chart-utils";
import type { Comparison } from "@/lib/engine/race/report";
import type { Section } from "@/lib/engine/race/sections";

const M = { left: 40, right: 10, top: 14, bottom: 24 };
const H = 220;

function niceStep(raw: number) {
  const mag = 10 ** Math.floor(Math.log10(Math.max(raw, 1e-6)));
  return ([1, 2, 2.5, 5, 10].find((s) => s * mag >= raw) ?? 10) * mag;
}

/**
 * The gap to the rider compared, through the race: above the line you're behind, below it you're ahead.
 * Lap lines mark each lap; hovering names the place and the section, which the map highlights.
 */
export default function GapChart({
  comparison,
  sections,
  lapMeters,
  lapCount,
  onHover,
}: {
  comparison: Comparison;
  sections: Section[];
  lapMeters: number;
  lapCount: number;
  onHover?: (section: number | null) => void;
}) {
  const { ref, width } = useChartWidth();
  const [hover, setHover] = useState<{ x: number; gap: number } | null>(null);
  const pts = comparison.gap;
  const total = lapMeters * lapCount;
  const lo = Math.min(0, ...pts.map((p) => p.gap));
  const hi = Math.max(0, ...pts.map((p) => p.gap));
  const step = niceStep((hi - lo) / 4 || 1);
  const yMin = Math.floor(lo / step) * step;
  const yMax = Math.max(step, Math.ceil(hi / step) * step);
  const w = width - M.left - M.right;
  const h = H - M.top - M.bottom;
  const X = (x: number) => M.left + (x / total) * w;
  const Y = (g: number) => M.top + ((yMax - g) / (yMax - yMin)) * h;

  // Broken where a lap's data is missing (more than 50 m between points).
  const paths: string[] = [];
  let d = "";
  pts.forEach((p, i) => {
    const gapBefore = i > 0 && p.x - pts[i - 1].x > 50;
    d += `${!d || gapBefore ? "M" : "L"}${X(p.x).toFixed(1)},${Y(p.gap).toFixed(1)}`;
    if (gapBefore) {
      paths.push(d.slice(0, d.lastIndexOf("M")));
      d = d.slice(d.lastIndexOf("M"));
    }
  });
  if (d) paths.push(d);

  const ticks: number[] = [];
  for (let v = yMin; v <= yMax + 1e-9; v += step) ticks.push(Math.round(v * 10) / 10);

  const sectionAt = (x: number) => {
    const m = x % lapMeters;
    return sections.find((s) => m >= s.from && m <= s.to) ?? null;
  };
  const move = (e: React.PointerEvent<SVGSVGElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - box.left - M.left) / w) * total;
    let best = pts[0];
    for (const p of pts) if (Math.abs(p.x - x) < Math.abs(best.x - x)) best = p;
    if (!best || Math.abs(best.x - x) > 60) {
      setHover(null);
      onHover?.(null);
      return;
    }
    setHover(best);
    onHover?.(sectionAt(best.x)?.id ?? null);
  };
  const hs = hover ? sectionAt(hover.x) : null;
  const who = comparison.id === "best-lap" ? "your best lap" : comparison.name.split(" ")[0];

  return (
    <div ref={ref} className="relative">
      <svg
        width={width}
        height={H}
        className="block touch-none"
        onPointerMove={move}
        onPointerLeave={() => {
          setHover(null);
          onHover?.(null);
        }}
        role="img"
        aria-label={`Gap to ${who} through the race`}
      >
        {ticks.map((t) => (
          <g key={t}>
            <line x1={M.left} x2={width - M.right} y1={Y(t)} y2={Y(t)} stroke={t === 0 ? "var(--muted)" : "var(--grid)"} strokeWidth={t === 0 ? 1 : 1} />
            <text x={M.left - 6} y={Y(t)} dy="0.32em" textAnchor="end" className="num fill-muted text-[11px]">
              {t > 0 ? `+${t}` : t}
            </text>
          </g>
        ))}
        {Array.from({ length: lapCount }, (_, k) => (
          <g key={k}>
            {k > 0 && <line x1={X(k * lapMeters)} x2={X(k * lapMeters)} y1={M.top} y2={H - M.bottom} stroke="var(--line)" strokeDasharray="3 3" />}
            <text x={X(k * lapMeters + lapMeters / 2)} y={H - 6} textAnchor="middle" className="fill-muted text-[11px]">
              Lap {k + 1}
            </text>
          </g>
        ))}
        {paths.map((p, i) => (
          <path key={i} d={p} fill="none" stroke="var(--negative)" strokeWidth={2} strokeLinejoin="round" />
        ))}
        {hover && (
          <g>
            <line x1={X(hover.x)} x2={X(hover.x)} y1={M.top} y2={H - M.bottom} stroke="var(--muted)" />
            <circle cx={X(hover.x)} cy={Y(hover.gap)} r={4} fill="var(--negative)" stroke="var(--surface)" strokeWidth={2} />
          </g>
        )}
        <text x={M.left + 4} y={M.top + 2} dy="0.7em" className="fill-muted text-[11px]">
          Seconds behind {who}
        </text>
      </svg>
      {hover && (
        <div
          className="pointer-events-none absolute top-1 rounded-md border border-line bg-surface px-2.5 py-1.5 text-xs shadow-sm"
          style={{ left: Math.min(Math.max(X(hover.x) + 10, 0), width - 190) }}
        >
          <div className="font-medium">
            Lap {Math.floor(hover.x / lapMeters) + 1}
            {hs ? `, ${hs.label}` : ""}
          </div>
          <div className="num text-muted">
            {hover.gap >= 0 ? `${hover.gap.toFixed(1)} s behind` : `${Math.abs(hover.gap).toFixed(1)} s ahead`}
          </div>
        </div>
      )}
    </div>
  );
}
