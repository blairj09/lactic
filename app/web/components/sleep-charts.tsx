"use client";

import { formatHours } from "@/lib/engine/hours";
import { useState } from "react";
import type { SleepSegment, SleepStage } from "@/lib/engine/health-import";
import { niceCeil, useChartWidth } from "./chart-utils";

/** Stage colours: deeper sleep is darker (lighter on dark), awake stands out. */
const COLOR: Record<SleepStage, string> = {
  deep: "var(--zone-7)",
  core: "var(--zone-5)",
  rem: "var(--zone-3)",
  asleep: "var(--zone-free)",
  awake: "var(--warning)",
};
const NAME: Record<SleepStage, string> = { deep: "Deep", core: "Core", rem: "REM", asleep: "Asleep", awake: "Awake" };
/** Hypnogram lanes, top to bottom. Unlabelled "asleep" shares the core lane. */
const LANES: { label: string; stages: SleepStage[] }[] = [
  { label: "Awake", stages: ["awake"] },
  { label: "REM", stages: ["rem"] },
  { label: "Core", stages: ["core", "asleep"] },
  { label: "Deep", stages: ["deep"] },
];

const hoursMinutes = formatHours;

function Legend({ stages }: { stages: SleepStage[] }) {
  return (
    <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted">
      {stages.map((s) => (
        <span key={s} className="flex items-center gap-1.5">
          <span className="inline-block size-2.5 rounded-sm" style={{ background: COLOR[s] }} aria-hidden />
          {NAME[s]}
        </span>
      ))}
    </div>
  );
}

const LANE_HEIGHT = 26;
const H_MARGIN = { left: 44, right: 8, top: 4, bottom: 22 };

/** Last night as a hypnogram: one lane per stage, time across. Hovering shows the stretch. */
export function Hypnogram({ segments, timeZone }: { segments: SleepSegment[]; timeZone: string }) {
  const { ref, width } = useChartWidth(640, 280);
  const [hover, setHover] = useState<number | null>(null);
  const start = segments[0].start;
  const end = segments.at(-1)!.end;
  const plotWidth = width - H_MARGIN.left - H_MARGIN.right;
  const height = H_MARGIN.top + LANES.length * LANE_HEIGHT + H_MARGIN.bottom;
  const x = (t: number) => H_MARGIN.left + ((t - start) / Math.max(end - start, 1)) * plotWidth;
  const lane = (stage: SleepStage) => LANES.findIndex((l) => l.stages.includes(stage));
  const time = (unix: number) => new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", minute: "2-digit" }).format(new Date(unix * 1000));
  const hourLabel = (unix: number) => new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric" }).format(new Date(unix * 1000));

  // A tick on each whole hour (every second hour when narrow).
  const every = width < 480 ? 7200 : 3600;
  const ticks: number[] = [];
  for (let t = Math.ceil(start / 3600) * 3600; t <= end; t += 3600) if (t % every === 0 || every === 3600) ticks.push(t);

  const onMove = (event: React.PointerEvent<SVGRectElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    const t = start + ((event.clientX - box.left) / box.width) * (end - start);
    const i = segments.findIndex((s) => s.start <= t && s.end >= t);
    setHover(i < 0 ? null : i);
  };
  const shown = new Set(segments.map((s) => s.stage));
  const hovered = hover !== null ? segments[hover] : null;

  return (
    <div ref={ref} className="relative">
      <svg width={width} height={height} role="img" aria-label={`Sleep stages from ${time(start)} to ${time(end)}`} className="block overflow-visible">
        {LANES.map((l, i) => (
          <g key={l.label}>
            <line x1={H_MARGIN.left} x2={width - H_MARGIN.right} y1={H_MARGIN.top + (i + 0.5) * LANE_HEIGHT} y2={H_MARGIN.top + (i + 0.5) * LANE_HEIGHT} stroke="var(--rule)" />
            <text x={H_MARGIN.left - 6} y={H_MARGIN.top + (i + 0.5) * LANE_HEIGHT} dy="0.32em" textAnchor="end" className="fill-faint text-[11px]">
              {l.label}
            </text>
          </g>
        ))}
        {segments.map((s, i) => {
          const y = H_MARGIN.top + lane(s.stage) * LANE_HEIGHT + 4;
          return (
            <rect
              key={i}
              x={x(s.start)}
              y={y}
              width={Math.max(x(s.end) - x(s.start), 1)}
              height={LANE_HEIGHT - 8}
              rx={2}
              fill={COLOR[s.stage]}
              opacity={hover === null || hover === i ? 1 : 0.6}
            />
          );
        })}
        {ticks.map((t) => (
          <text key={t} x={x(t)} y={height - 6} textAnchor="middle" className="num fill-faint text-[11px]">
            {hourLabel(t)}
          </text>
        ))}
        <rect x={H_MARGIN.left} y={0} width={plotWidth} height={height} fill="transparent" onPointerMove={onMove} onPointerLeave={() => setHover(null)} />
      </svg>
      <Legend stages={(["deep", "core", "rem", "asleep", "awake"] as SleepStage[]).filter((s) => shown.has(s))} />
      {hovered && (
        <div
          className="pointer-events-none absolute top-0 z-10 rounded-md border border-line bg-raised px-2 py-1 text-xs whitespace-nowrap shadow-sm"
          style={{ left: Math.min(Math.max(x((hovered.start + hovered.end) / 2), 80), width - 80), transform: "translateX(-50%)" }}
        >
          <span className="font-medium">{NAME[hovered.stage]}</span>{" "}
          <span className="num text-muted">
            {time(hovered.start)} to {time(hovered.end)}, {hoursMinutes((hovered.end - hovered.start) / 3600)}
          </span>
        </div>
      )}
    </div>
  );
}

export interface StageBarDay {
  day: string;
  deepHours: number | null;
  coreHours: number | null;
  remHours: number | null;
  awakeHours: number | null;
}

const B_HEIGHT = 160;
const B_MARGIN = { left: 36, right: 8, top: 12, bottom: 22 };
const STACK: { stage: SleepStage; pick: (d: StageBarDay) => number | null }[] = [
  { stage: "deep", pick: (d) => d.deepHours },
  { stage: "core", pick: (d) => d.coreHours },
  { stage: "rem", pick: (d) => d.remHours },
  { stage: "awake", pick: (d) => d.awakeHours },
];

const shortDay = (day: string) =>
  new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "short", day: "numeric" }).format(new Date(`${day}T00:00:00Z`));

/** Hours in each stage per night, stacked: deep at the bottom, awake on top. `days` is every day in the window. */
export function StageBars({ days, nights, sleepNeedHours }: { days: string[]; nights: StageBarDay[]; sleepNeedHours: number }) {
  const { ref, width } = useChartWidth(640, 280);
  const [hover, setHover] = useState<number | null>(null);
  const byDay = new Map(nights.map((n) => [n.day, n]));
  const total = (d: StageBarDay) => STACK.reduce((sum, s) => sum + (s.pick(d) ?? 0), 0);
  const high = niceCeil(Math.max(sleepNeedHours, ...nights.map(total), 1));
  const step = high <= 6 ? 2 : high <= 12 ? 4 : 5;
  const ticks = Array.from({ length: Math.floor(high / step) + 1 }, (_, i) => i * step);
  const plotWidth = width - B_MARGIN.left - B_MARGIN.right;
  const plotHeight = B_HEIGHT - B_MARGIN.top - B_MARGIN.bottom;
  const slot = plotWidth / days.length;
  const barWidth = Math.max(Math.min(slot * 0.7, 18), 2);
  const y = (h: number) => B_MARGIN.top + (1 - h / high) * plotHeight;
  const cx = (i: number) => B_MARGIN.left + (i + 0.5) * slot;

  const onMove = (event: React.PointerEvent<SVGRectElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    const i = Math.floor(((event.clientX - box.left) / box.width) * days.length);
    setHover(byDay.has(days[i]) ? i : null);
  };
  const hovered = hover !== null ? byDay.get(days[hover])! : null;

  return (
    <div ref={ref} className="relative">
      <svg width={width} height={B_HEIGHT} role="img" aria-label="Hours in each sleep stage by night" className="block overflow-visible">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={B_MARGIN.left} x2={width - B_MARGIN.right} y1={y(t)} y2={y(t)} stroke="var(--rule)" />
            <text x={B_MARGIN.left - 6} y={y(t)} dy="0.32em" textAnchor="end" className="num fill-faint text-[11px]">
              {t}h
            </text>
          </g>
        ))}
        <line x1={B_MARGIN.left} x2={width - B_MARGIN.right} y1={y(sleepNeedHours)} y2={y(sleepNeedHours)} stroke="var(--faint)" strokeDasharray="3 3" />
        {days.map((day, i) => {
          const night = byDay.get(day);
          if (!night) return null;
          let base = 0;
          return (
            <g key={day} opacity={hover === null || hover === i ? 1 : 0.6}>
              {STACK.map(({ stage, pick }) => {
                const h = pick(night) ?? 0;
                if (h <= 0) return null;
                const top = y(base + h);
                const rect = <rect key={stage} x={cx(i) - barWidth / 2} y={top} width={barWidth} height={Math.max(y(base) - top - 1, 0.5)} fill={COLOR[stage]} />;
                base += h;
                return rect;
              })}
            </g>
          );
        })}
        {[0, days.length - 1].map((i) => (
          <text key={i} x={cx(i)} y={B_HEIGHT - 6} textAnchor={i ? "end" : "start"} className="num fill-faint text-[11px]">
            {shortDay(days[i])}
          </text>
        ))}
        <rect x={B_MARGIN.left} y={0} width={plotWidth} height={B_HEIGHT} fill="transparent" onPointerMove={onMove} onPointerLeave={() => setHover(null)} />
      </svg>
      <div className="flex flex-wrap items-center justify-between gap-x-4">
        <Legend stages={["deep", "core", "rem", "awake"]} />
        <div className="mt-2 flex items-center gap-1.5 text-xs text-muted">
          <svg width="14" height="2" aria-hidden>
            <line x1="0" x2="14" y1="1" y2="1" stroke="var(--faint)" strokeDasharray="3 2" />
          </svg>
          <span>
            Your sleep need, <span className="num">{hoursMinutes(sleepNeedHours)}</span>
          </span>
        </div>
      </div>
      {!nights.length && <p className="absolute inset-0 flex items-center justify-center text-sm text-muted">No staged nights yet.</p>}
      {hovered && hover !== null && (
        <div
          className="pointer-events-none absolute top-0 z-10 rounded-md border border-line bg-raised px-2 py-1 text-xs whitespace-nowrap shadow-sm"
          style={{ left: Math.min(Math.max(cx(hover), 110), width - 110), transform: "translateX(-50%)" }}
        >
          <span className="text-muted">{shortDay(days[hover])}</span>{" "}
          <span className="num">
            {STACK.flatMap(({ stage, pick }) => {
              const h = pick(hovered);
              return h ? [`${NAME[stage]} ${hoursMinutes(h)}`] : [];
            }).join(" · ")}
          </span>
        </div>
      )}
    </div>
  );
}

/** Last night in one bar: each stage in its colour across the night, with bed and wake times under it. */
export function SleepStrip({ segments, timeZone }: { segments: SleepSegment[]; timeZone: string }) {
  const start = segments[0].start;
  const end = segments.at(-1)!.end;
  const span = Math.max(end - start, 1);
  const time = (unix: number) => new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", minute: "2-digit" }).format(new Date(unix * 1000));
  const shown = new Set(segments.map((s) => s.stage));
  return (
    <div>
      <div className="relative h-5 overflow-hidden rounded bg-raised" role="img" aria-label={`Sleep stages from ${time(start)} to ${time(end)}`}>
        {segments.map((s, i) => (
          <span
            key={i}
            className="absolute inset-y-0"
            style={{ left: `${((s.start - start) / span) * 100}%`, width: `${Math.max(((s.end - s.start) / span) * 100, 0.3)}%`, background: COLOR[s.stage] }}
          />
        ))}
      </div>
      <div className="num mt-1 flex justify-between text-xs text-faint">
        <span>{time(start)}</span>
        <span>{time(end)}</span>
      </div>
      <Legend stages={(["deep", "core", "rem", "asleep", "awake"] as SleepStage[]).filter((s) => shown.has(s))} />
    </div>
  );
}
