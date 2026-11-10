"use client";

import { useMemo } from "react";
import { useChartWidth } from "@/components/chart-utils";
import type { Comparison } from "@/lib/engine/race/report";
import type { Section } from "@/lib/engine/race/sections";

/**
 * The lap drawn from the GPS line, each section colored by the time it cost (red) or gained (green)
 * against the rider compared. Corners carry their numbers. No map tiles: a cyclocross course is a
 * few hundred meters across, and the shape is what matters.
 */
export default function CourseMap({
  line,
  sections,
  comparison,
  gate,
  highlight,
  selected,
  onSelect,
}: {
  line: [number, number][];
  sections: Section[];
  comparison: Comparison;
  gate: [number, number];
  highlight: number[];
  selected: number | null;
  onSelect: (id: number | null) => void;
}) {
  const { ref, width } = useChartWidth(560);
  const geo = useMemo(() => {
    const lat0 = line[0][0];
    const k = Math.cos((lat0 * Math.PI) / 180);
    const xs = line.map((p) => p[1] * k);
    const ys = line.map((p) => -p[0]);
    return { k, minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
  }, [line]);
  const pad = 22;
  const spanX = geo.maxX - geo.minX || 1e-6;
  const spanY = geo.maxY - geo.minY || 1e-6;
  const scale = Math.min((width - pad * 2) / spanX, (Math.min(width * 0.8, 520) - pad * 2) / spanY);
  const height = spanY * scale + pad * 2;
  const P = ([lat, lng]: [number, number]) => [pad + (lng * geo.k - geo.minX) * scale + ((width - pad * 2) - spanX * scale) / 2, pad + (-lat - geo.minY) * scale] as const;
  const STEP = 3;
  const totals = new Map(comparison.sections.map((r) => [r.id, r.total]));
  const worst = Math.max(1, ...comparison.sections.map((r) => Math.abs(r.total)));
  const color = (id: number) => {
    const t = totals.get(id) ?? 0;
    if (Math.abs(t) < 0.3) return "var(--series-2)";
    const strength = 0.35 + 0.65 * Math.min(1, Math.abs(t) / worst);
    return `color-mix(in srgb, ${t > 0 ? "var(--negative)" : "var(--positive)"} ${Math.round(strength * 100)}%, var(--surface))`;
  };
  const pathFor = (s: Section) => {
    const pts = line.slice(Math.floor(s.from / STEP), Math.ceil(s.to / STEP) + 1);
    return pts.map((p, i) => `${i ? "L" : "M"}${P(p)[0].toFixed(1)},${P(p)[1].toFixed(1)}`).join("");
  };
  const g = P(gate);
  const marked = new Set(highlight);

  return (
    <div ref={ref}>
      <svg width={width} height={height} className="block" role="img" aria-label="The lap, colored by time lost or gained in each section">
        {sections.map((s) => (
          <path key={`c${s.id}`} d={pathFor(s)} fill="none" stroke="var(--surface)" strokeWidth={marked.has(s.id) || selected === s.id ? 13 : 9} strokeLinecap="round" strokeLinejoin="round" />
        ))}
        {sections.map((s) => (
          <path
            key={s.id}
            d={pathFor(s)}
            fill="none"
            stroke={color(s.id)}
            strokeWidth={marked.has(s.id) || selected === s.id ? 8 : 5}
            strokeLinecap="round"
            strokeLinejoin="round"
            className="cursor-pointer"
            onClick={() => onSelect(selected === s.id ? null : s.id)}
          >
            <title>{s.label}</title>
          </path>
        ))}
        {(marked.size > 0 || selected !== null) &&
          sections
            .filter((s) => marked.has(s.id) || selected === s.id)
            .map((s) => <path key={`h${s.id}`} d={pathFor(s)} fill="none" stroke="var(--ink)" strokeWidth={1.5} strokeDasharray="4 3" pointerEvents="none" />)}
        <g transform={`translate(${g[0]},${g[1]})`}>
          <rect x={-7} y={-7} width={14} height={14} rx={3} fill="var(--ink)" />
          <path d="M-3.5 -3.5h3.5v3.5h3.5v3.5h-3.5v-3.5h-3.5z" fill="var(--surface)" />
        </g>
        {sections
          .filter((s) => s.kind === "corner")
          .map((s) => {
            const [x, y] = P(s.at);
            const on = marked.has(s.id) || selected === s.id;
            return (
              <g key={`n${s.id}`} transform={`translate(${x},${y})`} className="cursor-pointer" onClick={() => onSelect(selected === s.id ? null : s.id)}>
                <circle r={on ? 10 : 8} fill={on ? "var(--ink)" : "var(--surface)"} stroke="var(--ink)" strokeWidth={1} />
                <text textAnchor="middle" dy="0.35em" className={`num text-[10px] font-medium ${on ? "fill-surface" : "fill-ink"}`}>
                  {s.label.replace("Corner ", "")}
                </text>
              </g>
            );
          })}
      </svg>
    </div>
  );
}
