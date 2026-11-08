"use client";

import { useMemo, useState } from "react";
import { useChartWidth } from "@/components/chart-utils";
import type { SoloReport } from "@/lib/engine/race/solo";
import { distanceIn, distanceUnit, type UnitSystem } from "@/lib/units";

const M = { left: 44, right: 12 };
const ROW = { ele: 150, power: 92, hr: 72, gap: 130 };
const GAP_Y = 40;
export const SERIES = ["var(--series-1)", "var(--series-2)", "var(--series-3)"];

function niceStep(raw: number) {
  const mag = 10 ** Math.floor(Math.log10(Math.max(raw, 1e-6)));
  return ([1, 2, 2.5, 5, 10].find((s) => s * mag >= raw) ?? 10) * mag;
}

function ticksFor(lo: number, hi: number, n = 3) {
  const step = niceStep((hi - lo) / n || 1);
  const out: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(Math.round(v));
  return out;
}

const mins = (s: number) => {
  const m = Math.round(Math.abs(s) / 60);
  return m >= 60 ? `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m` : `${m} min`;
};

/**
 * The race along the road: elevation with the climbs marked and the stops pinned under it, then power
 * and heart rate (each on its own scale, every 5 km), then the gap to any past editions or other riders.
 * One crosshair runs through all of them.
 */
export default function SoloChart({ report, units, highlight, onHover }: { report: SoloReport; units: UnitSystem; highlight: number[]; onHover?: (section: number | null) => void }) {
  const { ref, width } = useChartWidth();
  const [hoverX, setHoverX] = useState<number | null>(null);
  const total = report.meters;
  const w = width - M.left - M.right;
  const X = (m: number) => M.left + (m / total) * w;
  const unit = distanceUnit(units);

  const rows = useMemo(() => {
    const out: { key: "ele" | "power" | "hr" | "gap"; top: number; h: number }[] = [];
    let y = 22;
    const add = (key: "ele" | "power" | "hr" | "gap", h: number) => {
      out.push({ key, top: y, h });
      y += h + GAP_Y;
    };
    add("ele", ROW.ele);
    if (report.hasPower) add("power", ROW.power);
    if (report.hasHr) add("hr", ROW.hr);
    if (report.comparisons.length) add("gap", ROW.gap);
    return { list: out, height: y - GAP_Y + 22 };
  }, [report]);
  const row = (k: string) => rows.list.find((r) => r.key === k);

  // Elevation.
  const eLo = Math.min(...report.profile);
  const eHi = Math.max(...report.profile);
  const ePad = (eHi - eLo) * 0.08 || 10;
  const er = row("ele")!;
  const EY = (e: number) => er.top + er.h - ((e - (eLo - ePad)) / (eHi + ePad - (eLo - ePad))) * er.h;
  const eleAt = (i: number) => i * 500;
  const elePath = report.profile.map((e, i) => `${i ? "L" : "M"}${X(Math.min(total, eleAt(i))).toFixed(1)},${EY(e).toFixed(1)}`).join("");
  const eleArea = `${elePath}L${X(total).toFixed(1)},${er.top + er.h}L${X(0)},${er.top + er.h}Z`;

  // A line through 5 km points, for power or heart rate.
  const traceRow = (key: "power" | "hr") => {
    const r = row(key);
    if (!r) return null;
    const vals = report.trace.map((t) => (key === "power" ? t.watts : t.hr));
    const ok = vals.filter((v): v is number => v !== null);
    const lo = key === "power" ? 0 : Math.floor(Math.min(...ok) / 10) * 10;
    const hi = Math.max(...ok, report.ftp && key === "power" ? report.ftp * 0.9 : 0) * 1.05;
    const Y = (v: number) => r.top + r.h - ((v - lo) / (hi - lo || 1)) * r.h;
    let d = "";
    report.trace.forEach((t, i) => {
      const v = vals[i];
      if (v === null) return;
      d += `${d ? "L" : "M"}${X(t.x).toFixed(1)},${Y(v).toFixed(1)}`;
    });
    return { r, Y, d, ticks: ticksFor(lo, hi, 2), lo, hi };
  };
  const power = traceRow("power");
  const hr = traceRow("hr");

  // Gaps.
  const gr = row("gap");
  const gapAll = report.comparisons.flatMap((c) => c.gap.map((g) => g.gap));
  const gLo = Math.min(0, ...gapAll);
  const gHi = Math.max(0, ...gapAll);
  // Minutes on this axis, so steps of 5, 10, 15, 30 minutes.
  const gStep = ([1, 2, 5, 10, 15, 20, 30, 60, 120].find((m) => m * 60 * 3 >= gHi - gLo) ?? 180) * 60;
  const gMin = Math.floor(gLo / gStep) * gStep;
  const gMax = Math.max(gStep, Math.ceil(gHi / gStep) * gStep);
  const GY = (g: number) => (gr ? gr.top + ((gMax - g) / (gMax - gMin)) * gr.h : 0);

  const sectionAt = (m: number) => report.sections.find((s) => m >= s.from && m <= s.to) ?? null;
  const nearest = <T extends { x: number }>(list: T[], m: number, within: number) => {
    let best: T | null = null;
    for (const p of list) if (!best || Math.abs(p.x - m) < Math.abs(best.x - m)) best = p;
    return best && Math.abs(best.x - m) <= within ? best : null;
  };

  const move = (e: React.PointerEvent<SVGSVGElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    const m = ((e.clientX - box.left - M.left) / w) * total;
    if (m < 0 || m > total) {
      setHoverX(null);
      onHover?.(null);
      return;
    }
    setHoverX(m);
    onHover?.(sectionAt(m)?.id ?? null);
  };

  const xTicks: number[] = [];
  const xStep = niceStep(distanceIn(total, units) / 6);
  for (let v = 0; v <= distanceIn(total, units); v += xStep) xTicks.push(v);

  const hs = hoverX !== null ? sectionAt(hoverX) : null;
  const ht = hoverX !== null ? nearest(report.trace, hoverX, 3000) : null;
  const he = hoverX !== null ? report.profile[Math.min(report.profile.length - 1, Math.round(hoverX / 500))] : null;
  // Labels that would run into the one before them shorten to their first word, or drop.
  const placed: { from: number; to: number; y: number }[] = [];
  const fits = (x: number, y: number, text: string) => {
    const half = text.length * 3.2;
    return !placed.some((p) => Math.abs(p.y - y) < 12 && x - half < p.to + 4 && x + half > p.from - 4);
  };
  const climbLabels = report.sections
    .filter((s) => s.kind === "climb")
    .flatMap((s) => {
      const x = X((s.from + s.to) / 2);
      const y = Math.max(er.top + 10, EY(s.eleTo) - 8);
      const text = [s.label, s.label.split(" ")[0]].find((t) => fits(x, y, t));
      if (!text) return [];
      placed.push({ from: x - text.length * 3.2, to: x + text.length * 3.2, y });
      return [{ id: s.id, x, y, text }];
    });
  const named: { x: number; seconds: number }[] = [];
  for (const s of report.stops.filter((st) => st.seconds >= 120)) {
    const x = X(s.at);
    if (named.every((n) => Math.abs(n.x - x) > 40)) named.push({ x, seconds: s.seconds });
  }

  return (
    <div ref={ref} className="relative">
      <svg
        width={width}
        height={rows.height}
        className="block touch-none"
        onPointerMove={move}
        onPointerLeave={() => {
          setHoverX(null);
          onHover?.(null);
        }}
        role="img"
        aria-label="The race along the road: elevation, power, heart rate and gaps"
      >
        {/* Elevation, climbs and stops */}
        {report.sections
          .filter((s) => s.kind === "climb")
          .map((s) => (
            <rect key={s.id} x={X(s.from)} y={er.top} width={Math.max(1, X(s.to) - X(s.from))} height={er.h} fill={highlight.includes(s.id) ? "var(--accent-soft)" : "var(--raised)"} />
          ))}
        {highlight
          .map((id) => report.sections[id])
          .filter((s) => s && s.kind !== "climb")
          .map((s) => (
            <rect key={`h${s.id}`} x={X(s.from)} y={er.top} width={Math.max(1, X(s.to) - X(s.from))} height={er.h} fill="var(--accent-soft)" />
          ))}
        {ticksFor(eLo - ePad, eHi + ePad).map((t) => (
          <g key={`e${t}`}>
            <line x1={M.left} x2={width - M.right} y1={EY(t)} y2={EY(t)} stroke="var(--grid)" />
            <text x={M.left - 6} y={EY(t)} dy="0.32em" textAnchor="end" className="num fill-muted text-[11px]">
              {units === "imperial" ? Math.round(t * 3.28084).toLocaleString() : t.toLocaleString()}
            </text>
          </g>
        ))}
        <path d={eleArea} fill="var(--faint)" opacity={0.2} />
        <path d={elePath} fill="none" stroke="var(--muted)" strokeWidth={1.5} strokeLinejoin="round" />
        {climbLabels.map((l) => (
          <text key={`l${l.id}`} x={l.x} y={l.y} textAnchor="middle" className="fill-ink text-[11px] font-medium" style={{ paintOrder: "stroke", stroke: "var(--surface)", strokeWidth: 3 }}>
            {l.text}
          </text>
        ))}
        {report.stops.map((s, i) => (
          <g key={`s${i}`}>
            <path d={`M${X(s.at)},${er.top + er.h - 1}l-4,7h8z`} fill="var(--ink)" />
          </g>
        ))}
        {named.map((s, i) => (
          <text key={`sn${i}`} x={s.x} y={er.top + er.h + 16} textAnchor="middle" className="fill-muted text-[10px]">
            {mins(s.seconds)}
          </text>
        ))}
        <text x={M.left + 4} y={er.top - 8} className="fill-muted text-[11px]">
          Elevation, {units === "imperial" ? "ft" : "m"} · ▲ stops
        </text>

        {/* Power and heart rate */}
        {[
          { t: power, label: "Power, W (5 km average)", color: "var(--trace)" },
          { t: hr, label: "Heart rate, bpm", color: "var(--trace-hr)" },
        ].map(({ t, label, color }) =>
          t ? (
            <g key={label}>
              {t.ticks.map((v) => (
                <g key={v}>
                  <line x1={M.left} x2={width - M.right} y1={t.Y(v)} y2={t.Y(v)} stroke="var(--grid)" />
                  <text x={M.left - 6} y={t.Y(v)} dy="0.32em" textAnchor="end" className="num fill-muted text-[11px]">
                    {v}
                  </text>
                </g>
              ))}
              {label.startsWith("Power") && report.ftp && report.ftp * 0.75 < t.hi && <line x1={M.left} x2={width - M.right} y1={t.Y(report.ftp * 0.75)} y2={t.Y(report.ftp * 0.75)} stroke="var(--muted)" strokeDasharray="3 3" />}
              <path d={t.d} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" />
              <text x={M.left + 4} y={t.r.top - 6} className="fill-muted text-[11px]">
                {label}
                {label.startsWith("Power") && report.ftp ? " · dashed: 75% of FTP" : ""}
              </text>
            </g>
          ) : null,
        )}

        {/* Gaps to past editions and other riders */}
        {gr && (
          <g>
            {Array.from({ length: Math.round((gMax - gMin) / gStep) + 1 }, (_, i) => gMin + i * gStep).map((v) => (
              <g key={`g${v}`}>
                <line x1={M.left} x2={width - M.right} y1={GY(v)} y2={GY(v)} stroke={v === 0 ? "var(--muted)" : "var(--grid)"} />
                <text x={M.left - 6} y={GY(v)} dy="0.32em" textAnchor="end" className="num fill-muted text-[11px]">
                  {v === 0 ? "0" : `${v > 0 ? "+" : "−"}${Math.round(Math.abs(v) / 60)}m`}
                </text>
              </g>
            ))}
            {report.comparisons.map((c, i) => (
              <path
                key={c.id}
                d={c.gap.map((g, k) => `${k ? "L" : "M"}${X(g.x).toFixed(1)},${GY(g.gap).toFixed(1)}`).join("")}
                fill="none"
                stroke={SERIES[i % SERIES.length]}
                strokeWidth={2}
                strokeLinejoin="round"
              />
            ))}
            <text x={M.left + 4} y={gr.top - 6} className="fill-muted text-[11px]">
              Minutes behind (+) or ahead (−) of each
            </text>
          </g>
        )}

        {/* Distance axis */}
        {xTicks.map((v) => {
          const m = units === "imperial" ? v * 1609.344 : v * 1000;
          return (
            <text key={`x${v}`} x={X(m)} y={rows.height - 6} textAnchor="middle" className="num fill-muted text-[11px]">
              {v}
              {v === 0 ? ` ${unit}` : ""}
            </text>
          );
        })}

        {hoverX !== null && <line x1={X(hoverX)} x2={X(hoverX)} y1={4} y2={rows.height - 20} stroke="var(--muted)" />}
      </svg>
      {hoverX !== null && (
        <div className="pointer-events-none absolute top-1 rounded-md border border-line bg-surface px-2.5 py-1.5 text-xs shadow-sm" style={{ left: Math.min(Math.max(X(hoverX) + 10, 0), width - 210) }}>
          <div className="font-medium">
            {unit === "mi" ? "Mile" : "Km"} {distanceIn(hoverX, units).toFixed(0)}
            {hs ? ` · ${hs.kind === "flat" ? "roads between climbs" : hs.label}` : ""}
          </div>
          {he !== null && <div className="num text-muted">{units === "imperial" ? `${Math.round(he * 3.28084).toLocaleString()} ft` : `${he.toLocaleString()} m`}</div>}
          {ht?.watts != null && <div className="num">{ht.watts} W</div>}
          {ht?.hr != null && <div className="num">{ht.hr} bpm</div>}
          {report.comparisons.map((c, i) => {
            const g = nearest(c.gap, hoverX, 1500);
            if (!g) return null;
            return (
              <div key={c.id} className="num flex items-center gap-1.5">
                <span className="inline-block h-0.5 w-3" style={{ background: SERIES[i % SERIES.length] }} />
                {c.name}: {g.gap === 0 ? "level" : `${mins(g.gap)} ${g.gap > 0 ? "behind" : "ahead"}`}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
