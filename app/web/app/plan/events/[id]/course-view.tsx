"use client";

import { useEffect, useRef, useState } from "react";
import type * as Leaflet from "leaflet";
import "leaflet/dist/leaflet.css";
import { useChartWidth } from "@/components/chart-utils";
import { STEP, type CourseProfile } from "@/lib/engine/course/profile";
import type { Pacing } from "@/lib/engine/course/pacing";
import { clockAt } from "@/lib/engine/raceday";
import { distanceIn, distanceUnit, elevationIn, elevationUnit, type UnitSystem } from "@/lib/units";
import { useUnits } from "@/lib/use-units";

const M = { left: 44, right: 12, top: 22, bottom: 24 };
const H = 190;

function niceStep(raw: number) {
  const mag = 10 ** Math.floor(Math.log10(Math.max(raw, 1e-6)));
  return ([1, 2, 2.5, 5, 10].find((s) => s * mag >= raw) ?? 10) * mag;
}

const duration = (s: number) => {
  const m = Math.round(s / 60);
  return m >= 60 ? `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")}` : `${m} min`;
};

/**
 * The course: its profile with the climbs shaded and numbered, the map with them drawn bold, and the
 * climbs with how long each takes and the power to hold. Picking a climb in any of the three shows it
 * in the others.
 */
export default function CourseView({ profile, pacing, start }: { profile: CourseProfile; pacing: Pacing; start: string | null }) {
  const units = useUnits();
  const [selected, setSelected] = useState<number | null>(null);
  return (
    <div className="space-y-5">
      <ProfileChart profile={profile} pacing={pacing} units={units} start={start} selected={selected} onSelect={setSelected} />
      <CourseMap profile={profile} selected={selected} />
      {pacing.climbs.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
            <thead>
              <tr className="border-b border-rule text-left text-xs text-muted">
                <th className="py-2 pr-3 font-normal">Climb</th>
                <th className="py-2 pr-3 font-normal">Starts</th>
                <th className="py-2 pr-3 font-normal">Length</th>
                <th className="py-2 pr-3 font-normal">Gain</th>
                <th className="py-2 pr-3 font-normal">Grade</th>
                <th className="py-2 pr-3 font-normal">Time</th>
                <th className="py-2 pr-3 font-normal">Hold</th>
                {start && <th className="py-2 font-normal">At about</th>}
              </tr>
            </thead>
            <tbody>
              {pacing.climbs.map((c) => (
                <tr
                  key={c.n}
                  className={`num cursor-pointer border-b border-rule ${selected === c.n ? "bg-accent-soft" : "hover:bg-raised"}`}
                  onClick={() => setSelected(selected === c.n ? null : c.n)}
                  onMouseEnter={() => setSelected(c.n)}
                >
                  <td className="py-2 pr-3 font-medium">{c.n}</td>
                  <td className="py-2 pr-3">
                    {distanceIn(c.from, units).toFixed(1)} {distanceUnit(units)}
                  </td>
                  <td className="py-2 pr-3">
                    {distanceIn(c.to - c.from, units).toFixed(1)} {distanceUnit(units)}
                  </td>
                  <td className="py-2 pr-3">
                    {Math.round(elevationIn(c.gain, units))} {elevationUnit(units)}
                  </td>
                  <td className="py-2 pr-3">
                    {(c.grade * 100).toFixed(1)}%<span className="text-muted"> (max {(c.maxGrade * 100).toFixed(0)}%)</span>
                  </td>
                  <td className="py-2 pr-3">{duration(c.seconds)}</td>
                  <td className="py-2 pr-3">
                    {c.watts[0]}-{c.watts[1]} W<span className="text-muted"> · {Math.round(c.fraction * 100)}%</span>
                  </td>
                  {start && <td className="py-2">{clockAt(start, Math.round(c.startsAt / 60))}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function ProfileChart({
  profile,
  pacing,
  units,
  start,
  selected,
  onSelect,
}: {
  profile: CourseProfile;
  pacing: Pacing;
  units: UnitSystem;
  start: string | null;
  selected: number | null;
  onSelect: (n: number | null) => void;
}) {
  const { ref, width } = useChartWidth();
  const [hover, setHover] = useState<number | null>(null);
  const total = profile.meters;
  const w = width - M.left - M.right;
  const X = (m: number) => M.left + (Math.min(m, total) / total) * w;
  const lo = Math.min(...profile.ele);
  const hi = Math.max(...profile.ele);
  const pad = (hi - lo) * 0.1 || 10;
  const Y = (e: number) => M.top + H - ((e - (lo - pad)) / (hi + pad - (lo - pad))) * H;
  const line = profile.ele.map((e, k) => `${k ? "L" : "M"}${X(k * STEP).toFixed(1)},${Y(e).toFixed(1)}`).join("");
  const area = `${line}L${X(total).toFixed(1)},${M.top + H}L${X(0)},${M.top + H}Z`;
  const eStep = niceStep((elevationIn(hi + pad, units) - elevationIn(lo - pad, units)) / 3);
  const eTicks: number[] = [];
  for (let v = Math.ceil(elevationIn(lo - pad, units) / eStep) * eStep; v <= elevationIn(hi + pad, units); v += eStep) eTicks.push(v);
  const xStep = niceStep(distanceIn(total, units) / 6);
  const xTicks: number[] = [];
  for (let v = 0; v <= distanceIn(total, units) + 1e-9; v += xStep) xTicks.push(v);
  const toMeters = (v: number) => (units === "imperial" ? v * 1609.344 : v * 1000);
  const fromElevation = (v: number) => (units === "imperial" ? v / 3.28084 : v);

  const k = hover !== null ? Math.min(profile.ele.length - 1, Math.round(hover / STEP)) : null;
  const climbAt = (m: number) => pacing.climbs.find((c) => m >= c.from && m <= c.to) ?? null;

  return (
    <div ref={ref} className="relative">
      <svg
        width={width}
        height={M.top + H + M.bottom}
        className="block touch-none"
        role="img"
        aria-label="The course's elevation profile, with its climbs numbered"
        onPointerMove={(e) => {
          const box = e.currentTarget.getBoundingClientRect();
          const m = ((e.clientX - box.left - M.left) / w) * total;
          setHover(m >= 0 && m <= total ? m : null);
          const c = m >= 0 && m <= total ? climbAt(m) : null;
          if (c) onSelect(c.n);
        }}
        onPointerLeave={() => setHover(null)}
      >
        {pacing.climbs.map((c) => (
          <rect key={c.n} x={X(c.from)} y={M.top} width={Math.max(1, X(c.to) - X(c.from))} height={H} fill={selected === c.n ? "var(--accent-soft)" : "var(--raised)"} />
        ))}
        {eTicks.map((t) => (
          <g key={t}>
            <line x1={M.left} x2={width - M.right} y1={Y(fromElevation(t))} y2={Y(fromElevation(t))} stroke="var(--grid)" />
            <text x={M.left - 6} y={Y(fromElevation(t))} dy="0.32em" textAnchor="end" className="num fill-muted text-[11px]">
              {Math.round(t).toLocaleString()}
            </text>
          </g>
        ))}
        <path d={area} fill="var(--faint)" opacity={0.2} />
        <path d={line} fill="none" stroke="var(--muted)" strokeWidth={1.5} strokeLinejoin="round" />
        {pacing.climbs.map((c) => {
          const a = Math.floor(c.from / STEP);
          const b = Math.min(profile.ele.length - 1, Math.ceil(c.to / STEP));
          const d = profile.ele
            .slice(a, b + 1)
            .map((e, i) => `${i ? "L" : "M"}${X((a + i) * STEP).toFixed(1)},${Y(e).toFixed(1)}`)
            .join("");
          return <path key={`c${c.n}`} d={d} fill="none" stroke="var(--accent)" strokeWidth={selected === c.n ? 3 : 2} strokeLinejoin="round" />;
        })}
        {pacing.climbs.map((c) => (
          <text
            key={`n${c.n}`}
            x={X((c.from + c.to) / 2)}
            y={Math.max(M.top + 10, Y(c.top) - 8)}
            textAnchor="middle"
            className="num fill-ink text-[11px] font-medium"
            style={{ paintOrder: "stroke", stroke: "var(--surface)", strokeWidth: 3 }}
          >
            {c.n}
          </text>
        ))}
        <text x={M.left + 4} y={M.top - 8} className="fill-muted text-[11px]">
          Elevation, {elevationUnit(units)} · climbs numbered
        </text>
        {xTicks.map((v) => (
          <text key={`x${v}`} x={X(toMeters(v))} y={M.top + H + 16} textAnchor="middle" className="num fill-muted text-[11px]">
            {Number.isInteger(v) ? v : v.toFixed(1)}
            {v === 0 ? ` ${distanceUnit(units)}` : ""}
          </text>
        ))}
        {hover !== null && k !== null && (
          <g pointerEvents="none">
            <line x1={X(hover)} x2={X(hover)} y1={M.top} y2={M.top + H} stroke="var(--ink)" strokeOpacity={0.4} />
            <circle cx={X(hover)} cy={Y(profile.ele[k])} r={3.5} fill="var(--ink)" />
          </g>
        )}
      </svg>
      {hover !== null && k !== null && (
        <div
          className="num pointer-events-none absolute top-0 rounded-md border border-line bg-ground px-2 py-1 text-xs shadow-sm"
          style={{ left: Math.min(Math.max(X(hover) - 70, 0), Math.max(0, width - 150)) }}
        >
          {distanceIn(hover, units).toFixed(1)} {distanceUnit(units)} · {Math.round(elevationIn(profile.ele[k], units))} {elevationUnit(units)} · {(profile.grade[Math.min(k, profile.grade.length - 1)] * 100).toFixed(1)}%
          <span className="text-muted">
            {" "}
            · {start ? clockAt(start, Math.round((pacing.at[k] ?? 0) / 60)) : `${duration(pacing.at[k] ?? 0)} in`}
          </span>
        </div>
      )}
    </div>
  );
}

const cssColor = (name: string, fallback: string) => (typeof window === "undefined" ? fallback : getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback);

/** The course on OpenStreetMap, climbs drawn bold, the picked one boldest. */
function CourseMap({ profile, selected }: { profile: CourseProfile; selected: number | null }) {
  const box = useRef<HTMLDivElement>(null);
  const [map, setMap] = useState<{ L: typeof Leaflet; map: Leaflet.Map; climbs: Map<number, Leaflet.Polyline> } | null>(null);

  useEffect(() => {
    let made: Leaflet.Map | undefined;
    let cancelled = false;
    import("leaflet").then((L) => {
      if (cancelled || !box.current) return;
      made = L.map(box.current, { scrollWheelZoom: true });
      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      }).addTo(made);
      const points = profile.lat.map((lat, k) => [lat, profile.lng[k]] as [number, number]);
      const accent = cssColor("--accent", "#2b55d6");
      const route = L.polyline(points, { color: cssColor("--muted", "#6b6f76"), weight: 3, opacity: 0.8 }).addTo(made);
      const climbs = new Map<number, Leaflet.Polyline>();
      for (const c of profile.climbs) {
        const part = points.slice(Math.floor(c.from / STEP), Math.ceil(c.to / STEP) + 1);
        climbs.set(c.n, L.polyline(part, { color: accent, weight: 5, opacity: 0.9 }).bindTooltip(`Climb ${c.n}`).addTo(made));
      }
      L.circleMarker(points[0], { radius: 6, color: "#ffffff", weight: 2, fillColor: "#247b50", fillOpacity: 1 }).bindTooltip("Start").addTo(made);
      L.circleMarker(points[points.length - 1], { radius: 6, color: "#ffffff", weight: 2, fillColor: "#b8232a", fillOpacity: 1 }).bindTooltip("Finish").addTo(made);
      made.fitBounds(route.getBounds(), { padding: [24, 24] });
      setMap({ L, map: made, climbs });
    });
    return () => {
      cancelled = true;
      made?.remove();
      setMap(null);
    };
  }, [profile]);

  useEffect(() => {
    if (!map) return;
    for (const [n, line] of map.climbs) {
      line.setStyle({ weight: n === selected ? 8 : 5, opacity: selected === null || n === selected ? 0.95 : 0.55 });
      if (n === selected) line.bringToFront();
    }
  }, [map, selected]);

  return <div ref={box} className="h-72 w-full overflow-hidden rounded-lg border border-line sm:h-80" aria-label="Map of the course" />;
}
