import { intervals, powerZone, segmentRange, type Workout } from "@/lib/engine/workout";

/** What was ridden at a workout position (seconds): power, heart rate and cadence (0 when missing). */
export type TracePoint = [position: number, watts: number, heartRate: number, cadence: number];

/** Heart rate and cadence get their own fixed scales, drawn in the chart's lower part. */
const HR_RANGE = [60, 200] as const;
const CADENCE_RANGE = [0, 140] as const;

const zoneFill = (fraction: number) => `var(--zone-${powerZone(fraction)})`;

/**
 * The workout profile, colored by zone, with ridden power on top and a playhead. `from`/`to` crop it
 * to a window of the workout (the overlay shows the next few minutes).
 */
export default function WorkoutChart({
  workout,
  ftp,
  position,
  trace,
  from = 0,
  to,
  highlight,
  className,
}: {
  workout: Workout;
  ftp: number;
  position: number;
  trace: TracePoint[];
  from?: number;
  to: number;
  /** Index of an interval to outline (the one under the pointer). */
  highlight?: number;
  className?: string;
}) {
  const all = intervals(workout);
  const peak = Math.max(1.2, ...workout.segments.map((s) => segmentRange(s)?.high ?? 0)) * 1.08;
  const y = (fraction: number) => 100 - (Math.min(fraction, peak) / peak) * 100;
  const span = Math.max(to - from, 1);
  const shown = all.filter((i) => i.end > from && i.start < to);
  const step = Math.max(1, Math.round(span / 400));
  const scaled = ([low, high]: readonly [number, number]) => (v: number) => 100 - Math.min(Math.max((v - low) / (high - low), 0), 1) * 90;
  // One line per stretch of riding; a skip, a jump back or a missing reading leaves a gap rather than a line across it.
  const linesOf = (value: (point: TracePoint) => number | null) => {
    const lines: string[][] = [];
    let last = -Infinity;
    trace.forEach((point, i) => {
      const p = point[0];
      if (p < from || p > to || i % step !== 0) return;
      const v = value(point);
      if (v === null) return void (last = -Infinity);
      // A jump back starts a new line too, drawn over what was ridden there before.
      if (p - last > step || p < last) lines.push([]);
      lines[lines.length - 1].push(`${p},${v.toFixed(2)}`);
      last = p;
    });
    return lines;
  };
  const hrY = scaled(HR_RANGE);
  const cadenceY = scaled(CADENCE_RANGE);
  const series = [
    { key: "cadence", color: "var(--trace-cadence)", width: 1, opacity: 0.7, lines: linesOf(([, , , c]) => (c > 0 ? cadenceY(c) : null)) },
    { key: "hr", color: "var(--trace-hr)", width: 1.25, opacity: 0.85, lines: linesOf(([, , h]) => (h > 0 ? hrY(h) : null)) },
    { key: "power", color: "var(--trace)", width: 1.5, opacity: 1, lines: linesOf(([, w]) => y(ftp > 0 ? w / ftp : 0)) },
  ];

  return (
    <svg viewBox={`${from} 0 ${span} 100`} preserveAspectRatio="none" className={className} role="img" aria-label="Workout profile">
      {shown.map(({ index, start, end, segment }) => {
        const done = end <= position;
        const opacity = done ? 0.45 : 0.9;
        if (segment.kind === "freeRide")
          return <rect key={index} x={start} width={end - start} y={y(0.5)} height={100 - y(0.5)} fill="var(--zone-free)" opacity={opacity} />;
        if (segment.kind === "steady")
          return <rect key={index} x={start} width={end - start} y={y(segment.target)} height={100 - y(segment.target)} fill={zoneFill(segment.target)} opacity={opacity} />;
        return (
          <polygon
            key={index}
            points={`${start},100 ${start},${y(segment.from)} ${end},${y(segment.to)} ${end},100`}
            fill={zoneFill((segment.from + segment.to) / 2)}
            opacity={opacity}
          />
        );
      })}
      {shown
        .filter((i) => i.index === highlight)
        .map(({ index, start, end }) => (
          <rect key={`h${index}`} x={start} width={end - start} y={0} height={100} fill="currentColor" fillOpacity={0.08} />
        ))}
      <line x1={from} x2={to} y1={y(1)} y2={y(1)} stroke="currentColor" strokeOpacity={0.35} strokeDasharray="4 4" vectorEffect="non-scaling-stroke" />
      {series.flatMap(({ key, color, width, opacity, lines }) =>
        lines.map((line, i) => (
          <polyline key={`${key}${i}`} points={line.join(" ")} fill="none" stroke={color} strokeWidth={width} strokeOpacity={opacity} vectorEffect="non-scaling-stroke" />
        )),
      )}
      <line x1={position} x2={position} y1={0} y2={100} stroke="currentColor" strokeWidth={2} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
