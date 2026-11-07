"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { segmentRoles } from "@/lib/engine/segment-roles";
import { intervalAt, isAllOut, powerZone, segmentRange, type Interval, type Workout } from "@/lib/engine/workout";
import { describeTarget, formatTime } from "@/lib/format";

/** One hue that strengthens with the zone (the --zone-N tokens), as on the Ride page. */
const color = (target: number) => `var(--zone-${powerZone(target)})`;

const pct = (fraction: number) => Math.round(fraction * 100);

/** "121% FTP" ("45-70% FTP" for a ramp) and its zone; null for free ride. */
function percentOf(interval: Interval) {
  const range = segmentRange(interval.segment);
  if (!range) return null;
  const percent = range.low === range.high ? `${pct(range.low)}% FTP` : `${pct(range.low)}-${pct(range.high)}% FTP`;
  return { percent, zone: powerZone((range.low + range.high) / 2) };
}

/**
 * A block chart of a workout: width is time, height and color are intensity. With `details`,
 * hovering (or tapping, on a phone) a part shows what it is: its place in the workout, how long,
 * the target in watts (with `ftp`) and % FTP, and when it starts.
 */
export default function WorkoutProfile({
  workout,
  height = 40,
  className = "",
  details = false,
  ftp,
}: {
  workout: Workout;
  height?: number;
  className?: string;
  details?: boolean;
  ftp?: number | null;
}) {
  const [at, setAt] = useState<number | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const roles = useMemo(() => (details ? segmentRoles(workout) : []), [details, workout]);
  const total = workout.segments.reduce((t, s) => t + s.duration, 0);

  // A tap elsewhere closes the details a tap opened.
  useEffect(() => {
    if (at === null) return;
    const close = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) setAt(null);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [at]);

  if (total <= 0) return null;
  const top = 1.3;
  const y = (target: number) => height * (1 - Math.min(target, top) / top);
  let start = 0;
  const shapes = workout.segments.map((s, i) => {
    const x0 = (start / total) * 1000;
    const x1 = ((start + s.duration) / total) * 1000;
    start += s.duration;
    if (s.kind === "freeRide") return <rect key={i} x={x0} y={y(0.5)} width={x1 - x0} height={height - y(0.5)} fill="var(--zone-free)" />;
    const from = s.kind === "ramp" ? s.from : s.target;
    const to = s.kind === "ramp" ? s.to : s.target;
    return <polygon key={i} points={`${x0},${height} ${x0},${y(from)} ${x1},${y(to)} ${x1},${height}`} fill={color(Math.max(from, to))} />;
  });
  const svg = (
    <svg viewBox={`0 0 1000 ${height}`} preserveAspectRatio="none" className={`block w-full ${details ? "" : className}`} style={{ height }} role="img" aria-label={workout.name}>
      {shapes}
      {details && at !== null && <Highlight workout={workout} at={at} total={total} height={height} />}
    </svg>
  );
  if (!details) return svg;

  const interval = at === null ? null : intervalAt(workout, at);
  const fractionAt = (e: React.PointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return Math.min(Math.max((e.clientX - rect.left) / rect.width, 0), 0.9999);
  };
  const left = at === null ? 50 : Math.min(Math.max((at / total) * 100, 12), 88);
  const percent = interval && percentOf(interval);

  return (
    <div
      ref={box}
      className={`relative cursor-crosshair touch-pan-y select-none ${className}`}
      onPointerMove={(e) => {
        if (e.pointerType === "mouse" || e.buttons) setAt(fractionAt(e) * total);
      }}
      onPointerDown={(e) => {
        if (e.pointerType === "mouse") return;
        const next = fractionAt(e) * total;
        // Tapping the part that's open closes it.
        const same = interval && next >= interval.start && next < interval.end;
        setAt(same ? null : next);
      }}
      onPointerLeave={(e) => {
        if (e.pointerType === "mouse") setAt(null);
      }}
    >
      {svg}
      {interval && (
        <div
          role="tooltip"
          className="pointer-events-none absolute top-full z-10 mt-2 w-max max-w-72 -translate-x-1/2 space-y-1 rounded-md border border-line bg-raised px-3 py-2 text-sm shadow-lg"
          style={{ left: `${left}%` }}
        >
          <div className="text-muted">{roles[interval.index]}</div>
          <div className="num flex items-center gap-2 font-medium">
            <span
              className="inline-block size-2.5 shrink-0 rounded-sm"
              style={{ background: percent ? `var(--zone-${percent.zone})` : "var(--zone-free)" }}
            />
            {formatTime(interval.end - interval.start)} {isAllOut(interval.segment) ? "all out" : `at ${ftp ? describeTarget(interval, ftp) : (percent?.percent ?? "free ride")}`}
          </div>
          {percent && (
            <div className="num text-muted">
              {ftp ? `${percent.percent} · ` : ""}zone {percent.zone}
            </div>
          )}
          <div className="num text-muted">Starts at {formatTime(interval.start)}</div>
        </div>
      )}
    </div>
  );
}

/** A light wash over the part under the pointer. */
function Highlight({ workout, at, total, height }: { workout: Workout; at: number; total: number; height: number }) {
  const interval = intervalAt(workout, at);
  if (!interval) return null;
  const x = (interval.start / total) * 1000;
  const width = ((interval.end - interval.start) / total) * 1000;
  return <rect x={x} width={width} y={0} height={height} fill="currentColor" fillOpacity={0.14} className="text-ink" />;
}
