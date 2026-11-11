import { useEffect, useMemo, useRef, useState } from "react";
import { segmentRoles } from "@/lib/engine/segment-roles";
import { intervalAt, powerZone, segmentRange, type Interval, type Workout } from "@/lib/engine/workout";
import { describeTarget, formatTime } from "@/lib/format";
import { ERG_MAX, ERG_MIN, ERG_STEP } from "@/lib/ride/erg";
import { EXTEND_KINDS, type ExtendKind } from "@/lib/ride/extend";
import type { RideTotals } from "@/lib/ride/totals";
import WorkoutChart, { type TracePoint } from "./workout-chart";

/** Everything the in-ride views show, worked out once per second in RideScreen. */
export interface PlayerData {
  workout: Workout;
  ftp: number;
  position: number;
  duration: number;
  current: Interval | null;
  upcoming: Interval[];
  intervalCount: number;
  targetWatts: number | null;
  power?: number;
  /** Power over the last 3 seconds while riding, for judging it against the target. */
  powerAverage?: number;
  heartRate?: number;
  cadence?: number;
  trace: TracePoint[];
  running: boolean;
  elapsed: number;
  intensity: number;
  /** Free ERG: no workout, a target in watts you move while riding. */
  erg: { watts: number } | null;
  /** Paused because you stopped pedaling; pedaling again resumes it. */
  autoPaused: boolean;
  /** ERG holds the target; off, the trainer rides like a road at `grade` and targets are a guide. */
  ergOn: boolean;
  grade: number;
  /** The interval under way is a sprint: no watts to hold, go as hard as you like. */
  allOut: boolean;
  /** Set while ERG has let go for a sprint: the trainer rides like a road at this grade. */
  sprintGrade: number | null;
  /** The interval under way is a free ride: no target, the trainer rides like a road at `grade`. */
  freeRide: boolean;
  /** The workout ran to its end: offer to extend it. */
  finished: boolean;
  /** Pedaling starts the ride by itself. */
  autoStart: boolean;
  /** Seconds until pedaling starts the ride, while it counts down. */
  startIn: number | null;
  /**
   * What Extend adds: a free ride, an ERG hold at `watts` or the workout block named `block`, for
   * `minutes` (a block's at least as long as its main set).
   */
  extend: { kind: ExtendKind; minutes: number; watts: number; block: string };
  /** An ERG hold added at the end is under way: − and + move its watts. */
  holding: boolean;
  /** The ride so far: averages and TSS. */
  totals: RideTotals;
  /** End was pressed: the ride is over and saving or saved. */
  ended: boolean;
}

export interface PlayerControls {
  onPlayPause: () => void;
  onSkip: () => void;
  /** Back to the start of the previous interval. */
  onBack: () => void;
  onIntensity: (delta: number) => void;
  /** Sets the free ERG target. */
  onErg: (watts: number) => void;
  onErgMode: (on: boolean) => void;
  onGrade: (delta: number) => void;
  /** At the end: add a block of the chosen minutes at the extend watts, and ride on. */
  onExtend: () => void;
  /** Stops the ride, saves it, closes the overlay and shows the survey. */
  onEnd: () => void;
  onExtendMinutes: (minutes: number) => void;
  onExtendWatts: (watts: number) => void;
  onExtendKind: (kind: ExtendKind) => void;
  /** Steps through the workout blocks on offer. */
  onExtendBlock: (step: 1 | -1) => void;
  /** Moves an ERG hold's watts by `delta` steps while riding it. */
  onHold: (delta: number) => void;
  canPlay: boolean;
}

export { describeTarget, formatTime };

/** The Target figure: watts, "All out" in a sprint, "Free" in free ride. */
const targetShown = (data: PlayerData) => data.targetWatts ?? (data.allOut ? "All out" : data.current ? "Free" : undefined);

function zoneOf(interval: Interval | null) {
  const range = interval && segmentRange(interval.segment);
  return range ? powerZone((range.low + range.high) / 2) : null;
}

type Tone = "positive" | "warning" | "negative";
const TONE: Record<Tone, string> = { positive: "text-positive", warning: "text-warning", negative: "text-negative" };

/**
 * Power against target, on a 3 second average so it doesn't flicker with each stroke: within 5%
 * is on target (green), under is amber, over is red, each with a word.
 */
function powerVsTarget(data: PlayerData): { tone: Tone; text: string } | null {
  const power = data.powerAverage;
  const target = data.targetWatts;
  if (power === undefined || target === null || target === 0 || !data.running) return null;
  const ratio = power / target;
  if (ratio < 0.95) return { tone: "warning", text: `${Math.round(target - power)} W under` };
  if (ratio > 1.05) return { tone: "negative", text: `${Math.round(power - target)} W over` };
  return { tone: "positive", text: "On target" };
}

/**
 * The workout chart on the page. Hovering it shows that interval: its target, when it starts, and
 * what you rode in it so far.
 */
function HoverChart({ data }: { data: PlayerData }) {
  const [hover, setHover] = useState<number | null>(null);
  const { ftp } = data;
  const roles = useMemo(() => segmentRoles(data.workout), [data.workout]);
  const at = hover === null ? null : hover * data.duration;
  const interval = at === null ? null : intervalAt(data.workout, at);
  const range = interval && segmentRange(interval.segment);
  const ridden = interval ? data.trace.filter(([p]) => p > interval.start && p <= interval.end) : [];
  const mean = (values: number[]) => (values.length ? Math.round(values.reduce((a, b) => a + b, 0) / values.length) : null);
  const avgPower = mean(ridden.map(([, w]) => w));
  const avgHr = mean(ridden.map(([, , h]) => h).filter((h) => h > 0));
  const percent = range && ftp > 0 ? (range.low === range.high ? `${Math.round(range.low * 100)}%` : `${Math.round(range.low * 100)}-${Math.round(range.high * 100)}%`) : null;
  const when = !interval
    ? ""
    : data.position >= interval.end
      ? `Done at ${formatTime(interval.end)}`
      : data.position >= interval.start
        ? `Now · ${formatTime(interval.end - data.position)} left`
        : `Starts at ${formatTime(interval.start)} · in ${formatTime(interval.start - data.position)}`;

  return (
    <div
      className="relative"
      onMouseMove={(e) => {
        const box = e.currentTarget.getBoundingClientRect();
        setHover(Math.min(Math.max((e.clientX - box.left) / box.width, 0), 0.9999));
      }}
      onMouseLeave={() => setHover(null)}
    >
      <WorkoutChart
        workout={data.workout}
        ftp={ftp}
        position={data.position}
        trace={data.trace}
        to={data.duration}
        highlight={interval?.index}
        className="h-44 w-full text-ink sm:h-52"
      />
      {interval && hover !== null && (
        <div
          role="tooltip"
          className="pointer-events-none absolute top-2 z-10 w-max max-w-72 -translate-x-1/2 space-y-1 rounded-md border border-line bg-raised px-3 py-2 text-sm shadow-lg"
          style={{ left: `${Math.min(Math.max(hover * 100, 14), 86)}%` }}
        >
          {!data.erg && (
            <div className="text-muted">
              {roles[interval.index]} · interval {interval.index + 1} of {data.intervalCount}
            </div>
          )}
          <div className="num flex items-center gap-2 font-medium">
            <ZoneDot zone={zoneOf(interval)} />
            {formatTime(interval.end - interval.start)} at {describeTarget(interval, ftp)}
          </div>
          {percent && range && (
            <div className="num text-muted">
              {percent} FTP · zone {powerZone((range.low + range.high) / 2)}
            </div>
          )}
          <div className="num text-muted">{when}</div>
          {avgPower !== null && (
            <div className="num text-muted">
              Ridden: {avgPower} W avg{avgHr !== null && ` · ${avgHr} bpm`}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const Key = ({ color, children }: { color: string; children: React.ReactNode }) => (
  <span className="inline-flex items-center gap-2">
    <span className="inline-block h-0.5 w-4 rounded-full" style={{ background: color }} />
    {children}
  </span>
);

const ZoneDot = ({ zone }: { zone: number | null }) => (
  <span className="inline-block size-2.5 shrink-0 rounded-sm" style={{ background: zone ? `var(--zone-${zone})` : "var(--zone-free)" }} />
);

/** Time left in the interval, or ride time in free ERG. */
const intervalTime = (data: PlayerData) =>
  data.erg ? formatTime(data.elapsed) : data.current ? formatTime(data.current.end - data.position) : undefined;
const intervalLabel = (data: PlayerData, short = false) =>
  data.erg
    ? "Ride time"
    : data.current
      ? short
        ? `Interval ${data.current.index + 1}/${data.intervalCount}`
        : `Interval ${data.current.index + 1} of ${data.intervalCount}`
      : data.position > 0
        ? "Done"
        : "Interval";
/** What's left of the workout. */
const toGo = (data: PlayerData) => formatTime(Math.max(0, data.duration - data.position));

/** The ride so far, as label, value and unit, for the right-hand column. */
function totalsRows(data: PlayerData): [label: string, value: number | string | null, unit: string][] {
  const { totals } = data;
  return [
    ["Avg power", totals.power, "W"],
    ["Avg HR", totals.heartRate, "bpm"],
    ["Avg cadence", totals.cadence, "rpm"],
    ["TSS", totals.tss, ""],
    data.erg ? ["Ride time", formatTime(data.elapsed), ""] : ["To go", toGo(data), ""],
  ];
}

/**
 * The large view on the Ride page, read from the saddle a metre or more away. Like the overlay:
 * this interval on the left, the workout in the middle, the ride so far on the right.
 */
export function PlayerView({ data, controls, extra }: { data: PlayerData; controls: PlayerControls; extra?: React.ReactNode }) {
  const off = powerVsTarget(data);
  const { erg } = data;
  return (
    <section aria-label="Workout" className="space-y-6 rounded-lg bg-surface p-5 sm:p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
        <h2 className="text-xl font-semibold tracking-tight">{data.workout.name}</h2>
        <span className="num text-[15px] text-muted">
          {data.ended
            ? `Ride ended · ${formatTime(data.elapsed)}`
            : erg
              ? "Holds the target until you move it"
              : `${formatTime(data.position)} of ${formatTime(data.duration)}`}
          {!erg && !data.ended && data.intensity !== 100 && ` · ${data.intensity}% intensity`}
          {!data.ended &&
            (data.sprintGrade !== null
              ? ` · Sprint: ERG off, ${data.sprintGrade}% grade`
              : !data.ergOn
                ? ` · ERG off, ${data.grade}% grade`
                : data.freeRide && ` · Free ride: ERG off, ${data.grade}% grade`)}
          {data.startIn !== null && <span className="text-warning"> · Starting in {data.startIn}</span>}
          {data.autoPaused && <span className="text-warning"> · Paused. Pedal to resume</span>}
        </span>
      </div>

      <div className="grid gap-x-8 gap-y-6 lg:grid-cols-[auto_minmax(0,1fr)_auto] lg:items-start">
        <div aria-label="This interval" className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4 lg:grid-cols-2">
          <div className="col-span-2">
            <Big label={intervalLabel(data)} value={intervalTime(data)} unit={!erg && data.current ? "left" : ""} lead />
          </div>
          <Big label="Power" value={data.power} unit="W" lead sub={off?.text ?? null} tone={off?.tone} />
          <Big label="Target" value={targetShown(data)} unit={data.targetWatts !== null ? "W" : ""} lead />
          <Big label="Heart rate" value={data.heartRate} unit="bpm" />
          <Big label="Cadence" value={data.cadence} unit="rpm" />
        </div>

        <div className="min-w-0 space-y-2">
          <HoverChart data={data} />
          <p className="flex flex-wrap gap-x-5 gap-y-1 text-sm text-muted">
            <Key color="var(--trace)">Power</Key>
            <Key color="var(--trace-hr)">Heart rate</Key>
            <Key color="var(--trace-cadence)">Cadence</Key>
          </p>
        </div>

        <dl aria-label="Ride so far" className="grid grid-cols-3 gap-x-6 gap-y-3 sm:grid-cols-5 lg:min-w-44 lg:grid-cols-1">
          {totalsRows(data).map(([label, value, unit]) => (
            <div key={label} className="min-w-0 lg:flex lg:items-baseline lg:justify-between lg:gap-4 lg:border-t lg:border-rule lg:pt-2 lg:first:border-0 lg:first:pt-0">
              <dt className="truncate text-sm text-muted">{label}</dt>
              <dd className="num text-2xl font-medium tracking-tight">
                {value ?? <span className="text-faint">–</span>}
                {unit && value !== null && <span className="ml-1 text-sm font-normal tracking-normal text-muted">{unit}</span>}
              </dd>
            </div>
          ))}
        </dl>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        {erg && !data.ended ? (
          <ErgAdjuster watts={erg.watts} ftp={data.ftp} onErg={controls.onErg} />
        ) : data.finished ? (
          <ExtendOrEnd data={data} controls={controls} />
        ) : data.ended ? (
          <div />
        ) : (
          <UpNext data={data} />
        )}
        <div className="space-y-4">
          <PageControls data={data} controls={controls} />
          {extra}
        </div>
      </div>
    </section>
  );
}

/**
 * The ride on a phone held in one hand (the iPhone's remote for the computer's ride): the numbers
 * on top, what's next in the middle (it scrolls), and the controls pinned at the bottom within
 * reach of a thumb. Intensity moves in 5% steps, so a big change is a couple of taps. No chart:
 * the computer's screen has it.
 */
export function RemoteView({ data, controls, extra, notice }: { data: PlayerData; controls: PlayerControls; extra?: React.ReactNode; notice?: React.ReactNode }) {
  const off = powerVsTarget(data);
  const { erg } = data;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 pb-4">
        {notice}
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="truncate text-lg font-semibold tracking-tight">{data.workout.name}</h2>
          <span className="num flex-none text-sm text-muted">
            {data.ended ? `Ended · ${formatTime(data.elapsed)}` : erg ? "ERG" : `${formatTime(data.position)} of ${formatTime(data.duration)}`}
          </span>
        </div>
        {(data.startIn !== null || data.autoPaused) && (
          <p className="text-sm text-warning">{data.startIn !== null ? `Starting in ${data.startIn}` : "Paused. Pedal to resume"}</p>
        )}
        <div aria-label="This interval" className="grid grid-cols-2 gap-x-6 gap-y-3">
          <div className="col-span-2">
            <Big label={intervalLabel(data)} value={intervalTime(data)} unit={!erg && data.current ? "left" : ""} lead />
          </div>
          <Big label="Power" value={data.power} unit="W" lead sub={off?.text ?? null} tone={off?.tone} />
          <Big label="Target" value={targetShown(data)} unit={data.targetWatts !== null ? "W" : ""} lead />
          <Big label="Heart rate" value={data.heartRate} unit="bpm" />
          <Big label="Cadence" value={data.cadence} unit="rpm" />
        </div>
        {!erg && !data.finished && !data.ended && <UpNext data={data} />}
      </div>
      <div className="space-y-3 border-t border-line bg-ground px-4 pt-3 pb-[max(env(safe-area-inset-bottom),12px)]">
        {erg && !data.ended ? <ErgAdjuster watts={erg.watts} ftp={data.ftp} onErg={controls.onErg} /> : data.finished ? <ExtendOrEnd data={data} controls={controls} /> : null}
        <PageControls data={data} controls={controls} intensityStep={5} />
        {extra}
      </div>
    </div>
  );
}

/** The current interval and the next few. */
function UpNext({ data }: { data: PlayerData }) {
  const { current, ftp } = data;
  return (
    <div className="space-y-4">
      <div>
        <h3 className="mb-2 text-sm text-muted">Now</h3>
        {current ? (
          <p className="num flex items-center gap-2 text-lg">
            <ZoneDot zone={zoneOf(current)} />
            {formatTime(current.end - current.start)} at {describeTarget(current, ftp)}
          </p>
        ) : (
          <p className="text-lg text-muted">{data.position > 0 ? "Workout complete." : "Not started."}</p>
        )}
      </div>
      <div>
        <h3 className="mb-2 text-sm text-muted">Up next</h3>
        {data.upcoming.length ? (
          <ul className="num text-[15px]">
            {data.upcoming.map((i) => (
              <li key={i.index} className="flex items-center gap-3 border-t border-rule py-2">
                <ZoneDot zone={zoneOf(i)} />
                <span className="w-14">{formatTime(i.end - i.start)}</span>
                <span>{describeTarget(i, ftp)}</span>
                <span className="ml-auto text-muted">in {formatTime(i.start - data.position)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[15px] text-muted">Nothing after this.</p>
        )}
      </div>
    </div>
  );
}

/** At the workout's end: extend it with a free ride, an ERG hold or a workout block, or end the ride. */
function ExtendOrEnd({ data, controls }: { data: PlayerData; controls: PlayerControls }) {
  const { ftp, extend } = data;
  const fraction = ftp > 0 ? extend.watts / ftp : null;
  const step = "inline-flex size-10 items-center justify-center rounded-md text-lg text-ink transition-colors hover:bg-active";
  return (
    <div className="space-y-4">
      <div>
        <h3 className="mb-1 text-sm text-muted">Workout complete</h3>
        <p className="text-lg">Keep riding a few more minutes, or end the ride.</p>
      </div>
      <KindPicker kind={extend.kind} onKind={controls.onExtendKind} className="h-11 px-4 text-[15px]" />
      <div className="flex flex-wrap items-center gap-2">
        <MinutesStepper minutes={extend.minutes} onMinutes={controls.onExtendMinutes} />
        {extend.kind === "erg" && (
          <>
            <Stepper
              label="At"
              value={`${extend.watts} W`}
              onDown={() => controls.onExtendWatts(extend.watts - ERG_STEP)}
              onUp={() => controls.onExtendWatts(extend.watts + ERG_STEP)}
              downLabel={`Down ${ERG_STEP} W`}
              upLabel={`Up ${ERG_STEP} W`}
            />
            {fraction !== null && (
              <span className="num inline-flex items-center gap-2 text-[15px] text-muted">
                <ZoneDot zone={powerZone(fraction)} />
                {Math.round(fraction * 100)}% FTP · − and + move it as you ride
              </span>
            )}
          </>
        )}
        {extend.kind === "block" && (
          <div className="flex min-w-0 items-center gap-1 rounded-lg bg-raised py-1 pl-1 pr-1">
            <button className={step} onClick={() => controls.onExtendBlock(-1)} aria-label="Previous block" title="Previous block">
              <Chevron left />
            </button>
            <span className="min-w-0 truncate px-1 text-center text-[15px]">{extend.block}</span>
            <button className={step} onClick={() => controls.onExtendBlock(1)} aria-label="Next block" title="Next block">
              <Chevron />
            </button>
          </div>
        )}
        {extend.kind === "freeRide" && <span className="text-[15px] text-muted">No ERG: the trainer rides like a road, and − and + set the grade.</span>}
      </div>
      <div className="flex gap-2">
        <button
          className="inline-flex h-14 flex-1 items-center justify-center rounded-lg bg-primary px-4 text-lg font-medium text-on-primary transition-opacity hover:opacity-85 disabled:opacity-50"
          disabled={!controls.canPlay}
          onClick={() => controls.onExtend()}
        >
          Extend {extend.minutes} min
        </button>
        <button
          className="inline-flex h-14 flex-1 items-center justify-center rounded-lg bg-raised px-4 text-lg font-medium text-ink transition-colors hover:bg-active"
          onClick={() => controls.onEnd()}
        >
          End ride
        </button>
      </div>
    </div>
  );
}

/** Free ride, ERG hold or workout block, as a row of choices. */
function KindPicker({ kind, onKind, className, wrapClassName = "" }: { kind: ExtendKind; onKind: (kind: ExtendKind) => void; className: string; wrapClassName?: string }) {
  return (
    <div role="radiogroup" aria-label="Extend with" className={`flex gap-1 rounded-lg bg-raised p-1 ${wrapClassName}`}>
      {EXTEND_KINDS.map((k) => (
        <button
          key={k.kind}
          role="radio"
          aria-checked={kind === k.kind}
          onClick={() => onKind(k.kind)}
          className={`inline-flex flex-1 items-center justify-center whitespace-nowrap rounded-md transition-colors ${className} ${kind === k.kind ? "bg-primary font-medium text-on-primary" : "text-muted hover:bg-active hover:text-ink"}`}
        >
          {k.label}
        </button>
      ))}
    </div>
  );
}

const Chevron = ({ left, className = "size-4" }: { left?: boolean; className?: string }) => (
  <svg viewBox="0 0 24 24" aria-hidden className={className} fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
    <path d={left ? "M15 5l-7 7 7 7" : "M9 5l7 7-7 7"} />
  </svg>
);

/** Minutes to extend by: − and + a minute at a time, or type any number. */
function MinutesStepper({ minutes, onMinutes }: { minutes: number; onMinutes: (minutes: number) => void }) {
  const step = "inline-flex size-10 items-center justify-center rounded-md text-lg text-ink transition-colors hover:bg-active";
  return (
    <div className="flex items-center gap-1 rounded-lg bg-raised py-1 pl-3 pr-1">
      <span className="mr-1 text-sm text-muted">Extend by</span>
      <button className={step} onClick={() => onMinutes(minutes - 1)} aria-label="A minute less" title="A minute less">
        <Icon d={ICON_MINUS} className="size-4" />
      </button>
      <label className="flex items-baseline gap-1">
        <input
          type="number"
          min={1}
          value={minutes}
          onChange={(e) => e.target.value !== "" && onMinutes(Number(e.target.value))}
          aria-label="Minutes to extend by"
          className="num w-12 rounded bg-transparent text-center text-[15px] [appearance:textfield] focus:bg-active focus:outline-none [&::-webkit-inner-spin-button]:appearance-none"
        />
        <span className="text-sm text-muted">min</span>
      </label>
      <button className={step} onClick={() => onMinutes(minutes + 1)} aria-label="A minute more" title="A minute more">
        <Icon d={ICON_PLUS} className="size-4" />
      </button>
    </div>
  );
}

const JUMPS = [-25, -10, 10, 25];

/** Free ERG's target: where it sits against FTP, a slider and bigger steps than the −/+ buttons. */
function ErgAdjuster({ watts, ftp, onErg }: { watts: number; ftp: number; onErg: (watts: number) => void }) {
  const fraction = ftp > 0 ? watts / ftp : null;
  return (
    <div className="space-y-4">
      <div>
        <h3 className="mb-2 text-sm text-muted">ERG target</h3>
        <p className="num flex items-center gap-2 text-lg">
          <ZoneDot zone={fraction === null ? null : powerZone(fraction)} />
          {watts} W
          {fraction !== null && (
            <span className="text-muted">
              · {Math.round(fraction * 100)}% FTP · zone {powerZone(fraction)}
            </span>
          )}
        </p>
      </div>
      <input
        type="range"
        min={ERG_MIN}
        max={ergSliderMax(ftp)}
        step={ERG_STEP}
        value={watts}
        onChange={(e) => onErg(Number(e.target.value))}
        aria-label="ERG target"
        className="w-full accent-[var(--accent)]"
      />
      <div className="flex flex-wrap gap-2">
        {JUMPS.map((j) => (
          <button
            key={j}
            onClick={() => onErg(watts + j)}
            className="num inline-flex h-11 min-w-16 items-center justify-center rounded-md bg-raised px-4 text-[15px] text-ink transition-colors hover:bg-active"
          >
            {j > 0 ? `+${j}` : `−${-j}`} W
          </button>
        ))}
      </div>
    </div>
  );
}

/** Top of the ERG slider: well past VO2 max, and never under 500 W. */
export const ergSliderMax = (ftp: number) => Math.min(ERG_MAX, Math.max(500, Math.round((ftp * 1.6) / 50) * 50));

const Icon = ({ d, className = "size-5" }: { d: string; className?: string }) => (
  <svg viewBox="0 0 24 24" aria-hidden className={className} fill="currentColor">
    <path d={d} />
  </svg>
);
const ICON_BACK = "M6 6h2v12H6zM9.5 12 18 6v12z";
const ICON_SKIP = "M16 6h2v12h-2zM6 18l8.5-6L6 6z";
// Arrows out to the corners (bigger) and in from them (smaller), as for a window or full screen.
const ICON_GROW = "M14 4h6v6M20 4l-6 6M10 20H4v-6M4 20l6-6";
const ICON_SHRINK = "M20 10h-6V4M14 10l6-6M4 14h6v6M10 14l-6 6";
const StrokeIcon = ({ d, className = "size-[clamp(14px,6vh,24px)]" }: { d: string; className?: string }) => (
  <svg viewBox="0 0 24 24" aria-hidden className={className} fill="none" stroke="currentColor" strokeWidth={2.25} strokeLinecap="round" strokeLinejoin="round">
    <path d={d} />
  </svg>
);
const ICON_PLAY = "M8 5v14l11-7z";
const ICON_PAUSE = "M6 5h4v14H6zM14 5h4v14h-4z";
const ICON_MINUS = "M5 10.5h14v3H5z";
const ICON_PLUS = "M10.5 5h3v5.5H19v3h-5.5V19h-3v-5.5H5v-3h5.5z";

/** What the play button does now, for its icon and its label for screen readers and hover. */
const playLabel = (data: PlayerData) =>
  data.running ? "Pause" : data.elapsed > 0 ? "Resume" : data.startIn !== null ? `Starting in ${data.startIn}` : data.erg ? "Start ride" : "Start workout";

/** A − value + group with its name, for intensity, grade and the ERG target. */
function Stepper({ label, value, onDown, onUp, downLabel, upLabel }: { label: string; value: string; onDown: () => void; onUp: () => void; downLabel: string; upLabel: string }) {
  const step = "inline-flex size-10 items-center justify-center rounded-md text-lg text-ink transition-colors hover:bg-active";
  return (
    <div className="flex items-center gap-1 rounded-lg bg-raised py-1 pl-3 pr-1">
      <span className="mr-1 text-sm text-muted">{label}</span>
      <button className={step} onClick={onDown} aria-label={downLabel} title={downLabel}>
        <Icon d={ICON_MINUS} className="size-4" />
      </button>
      <span className="num w-14 text-center text-[15px]">{value}</span>
      <button className={step} onClick={onUp} aria-label={upLabel} title={upLabel}>
        <Icon d={ICON_PLUS} className="size-4" />
      </button>
    </div>
  );
}

/**
 * The page's controls, in two rows: Back, Start/Pause and Skip together, big enough for a sweaty
 * hand; then what you adjust while riding (intensity, ERG, grade).
 */
function PageControls({ data, controls, intensityStep = 1 }: { data: PlayerData; controls: PlayerControls; intensityStep?: number }) {
  if (data.finished || data.ended) return null;
  const side =
    "inline-flex size-14 shrink-0 items-center justify-center rounded-lg bg-raised text-ink transition-colors hover:bg-active disabled:opacity-40";
  const showGrade = !data.erg && (!data.ergOn || data.sprintGrade !== null || data.freeRide);
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        {!data.erg && (
          <button className={side} disabled={data.position <= 0} onClick={() => controls.onBack()} aria-label="Back" title="Back to the previous interval">
            <Icon d={ICON_BACK} />
          </button>
        )}
        <button
          className="inline-flex h-14 min-w-0 flex-1 items-center justify-center rounded-lg bg-primary text-lg font-medium text-on-primary transition-opacity hover:opacity-85 disabled:opacity-50"
          disabled={!controls.canPlay}
          onClick={() => controls.onPlayPause()}
          aria-label={playLabel(data)}
          title={!controls.canPlay ? "Connect the trainer first" : data.autoStart && data.elapsed === 0 ? `${playLabel(data)}, or just start pedaling` : playLabel(data)}
        >
          <span className="inline-flex items-center gap-2">
            <Icon d={data.running ? ICON_PAUSE : ICON_PLAY} className="size-7" />
            {data.startIn !== null && <span className="num">{data.startIn}</span>}
          </span>
        </button>
        {!data.erg && (
          <button className={side} disabled={!data.current} onClick={() => controls.onSkip()} aria-label="Skip" title="Skip to the next interval">
            <Icon d={ICON_SKIP} />
          </button>
        )}
      </div>
      {!data.erg && (
        <div className="flex flex-wrap items-center gap-2">
          {data.holding ? (
            <Stepper
              label="Hold"
              value={`${data.targetWatts ?? "–"} W`}
              onDown={() => controls.onHold(-1)}
              onUp={() => controls.onHold(1)}
              downLabel={`Down ${ERG_STEP} W`}
              upLabel={`Up ${ERG_STEP} W`}
            />
          ) : (
            <Stepper
              label="Intensity"
              value={`${data.intensity}%`}
              onDown={() => controls.onIntensity(-intensityStep)}
              onUp={() => controls.onIntensity(intensityStep)}
              downLabel={`Easier by ${intensityStep}%`}
              upLabel={`Harder by ${intensityStep}%`}
            />
          )}
          <button
            role="switch"
            aria-checked={data.ergOn}
            onClick={() => controls.onErgMode(!data.ergOn)}
            title={data.ergOn ? "Turn ERG off and ride the targets yourself" : "Turn ERG on: the trainer holds the target"}
            className="flex h-12 items-center gap-3 rounded-lg bg-raised px-3 text-sm text-muted transition-colors hover:bg-active"
          >
            ERG
            <span className={`relative inline-block h-6 w-10 rounded-full transition-colors ${data.ergOn ? "bg-primary" : "bg-active"}`}>
              <span className={`absolute top-1 size-4 rounded-full transition-all ${data.ergOn ? "left-5 bg-on-primary" : "left-1 bg-muted"}`} />
            </span>
          </button>
          {showGrade && (
            <Stepper
              label={data.sprintGrade !== null ? "Sprint grade" : "Grade"}
              value={`${data.sprintGrade ?? data.grade}%`}
              onDown={() => controls.onGrade(-1)}
              onUp={() => controls.onGrade(1)}
              downLabel="Less resistance"
              upLabel="More resistance"
            />
          )}
        </div>
      )}
    </div>
  );
}

function Big({
  label,
  value,
  unit,
  sub,
  lead,
  tone,
}: {
  label: string;
  value: number | string | undefined;
  unit: string;
  sub?: string | null;
  lead?: boolean;
  tone?: Tone;
}) {
  return (
    <div className="min-w-0">
      <div className="truncate text-sm text-muted">{label}</div>
      <div className={`num font-medium tracking-tight ${lead ? "text-5xl leading-[1.1] sm:text-6xl" : "text-4xl leading-[1.15]"} ${tone ? TONE[tone] : ""}`}>
        {value ?? <span className="text-2xl text-faint">–</span>}
        {unit && value !== undefined && <span className="ml-1.5 text-base font-normal tracking-normal text-muted">{unit}</span>}
      </div>
      {sub !== undefined && <div className={`h-5 text-sm ${tone ? TONE[tone] : "text-muted"}`}>{sub}</div>}
    </div>
  );
}

/** Upcoming minutes shown in the overlay's chart. */
const MINI_AHEAD = 10 * 60;
const MINI_BEHIND = 90;

/** Overlay window sizes, smallest first. Everything inside scales with the window's height. */
export const OVERLAY_SIZES = [
  { width: 900, height: 150 },
  { width: 1200, height: 220 },
  { width: 1500, height: 300 },
  { width: 1900, height: 400 },
];

/** The drawer closes itself after this long without a touch, to give the numbers their room back. */
const DRAWER_IDLE_MS = 10_000;

// Read from the saddle a few feet from a big screen, so the overlay's type follows the window's
// height (vh is the overlay window's own viewport): drag it bigger, or use the shrink and enlarge buttons.
const MINI_VALUE = "text-[clamp(22px,30vh,150px)] leading-[1.05]";
const MINI_VALUE_SMALL = "text-[clamp(18px,22vh,110px)] leading-[1.05]";
const MINI_LABEL = "text-[clamp(11px,7vh,30px)]";
const MINI_H = "h-[clamp(26px,12vh,52px)]";
const MINI_ICON = "size-[clamp(14px,7vh,28px)]";
const MINI_TEXT = "text-[clamp(12px,6vh,22px)]";

/**
 * The compact strip that stays on top of other windows in a Picture-in-Picture window. Always dark. This
 * interval on the left, the workout in the middle, the ride so far on the right; the controls
 * live in a panel that a button at the right edge opens over the strip.
 */
export function MiniPlayer({ data, controls, onResize }: { data: PlayerData; controls: PlayerControls; onResize: (step: 1 | -1) => void }) {
  const { ftp } = data;
  const next = data.upcoming[0];
  const from = Math.max(0, data.position - MINI_BEHIND);
  const off = powerVsTarget(data);
  const [drawer, setDrawer] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  /** Bumped on each touch inside the drawer, restarting its idle timer. */
  const [touched, setTouched] = useState(0);

  // The overlay's own timers: its window stays visible on top, so Chrome doesn't throttle them.
  useEffect(() => {
    const win = root.current?.ownerDocument.defaultView;
    if (!drawer || !win) return;
    const id = win.setTimeout(() => setDrawer(false), DRAWER_IDLE_MS);
    return () => win.clearTimeout(id);
  }, [drawer, touched]);

  return (
    <div ref={root} className="relative flex h-screen select-none items-stretch gap-[6vh] overflow-hidden py-[3vh] pl-[5vh] pr-[calc(clamp(26px,10vh,48px)+3vh)]">
      <section aria-label="This interval" className="flex shrink-0 gap-[6vh]">
        <Mini
          label={data.erg ? "Ride time" : data.current ? intervalLabel(data, true) : data.position > 0 ? "Done" : "Ready"}
          value={intervalTime(data)}
          sub={
            data.autoPaused
              ? "Paused · pedal on"
              : data.startIn !== null
                ? `Starting in ${data.startIn}`
                : data.autoStart
                  ? "Pedal to start"
                  : data.erg
                    ? "Free ERG"
                    : data.current
                      ? `of ${formatTime(data.current.end - data.current.start)}`
                      : null
          }
          tone={data.autoPaused || data.startIn !== null ? "warning" : undefined}
        />
        <Mini label="Power" value={data.power} tone={off?.tone} sub={off?.text} />
        <Mini label="Target" value={targetShown(data)} />
        <Mini label="HR" value={data.heartRate} small />
        <Mini label="Cadence" value={data.cadence} small />
      </section>

      <div className="flex min-w-[20vw] flex-1 flex-col [container:end/size]">
        {data.finished ? (
          <MiniExtendOrEnd data={data} controls={controls} />
        ) : (
          <>
            <WorkoutChart workout={data.workout} ftp={ftp} position={data.position} trace={data.trace} from={from} to={from + MINI_BEHIND + MINI_AHEAD} className="min-h-0 w-full flex-1 text-ink" />
            <div className={`num truncate pt-[1.5vh] text-muted ${MINI_LABEL}`}>
              {data.erg ? (
                ftp > 0 && `${Math.round((data.erg.watts / ftp) * 100)}% FTP · zone ${powerZone(data.erg.watts / ftp)}`
              ) : next ? (
                <span className="inline-flex items-center gap-[0.4em]">
                  <ZoneDot zone={zoneOf(next)} />
                  Next: {formatTime(next.end - next.start)} at {describeTarget(next, ftp)}
                </span>
              ) : (
                "Last interval"
              )}
            </div>
          </>
        )}
      </div>

      <dl aria-label="Ride so far" className="flex shrink-0 flex-col justify-center">
        {totalsRows(data).map(([label, value]) => (
          <div key={label} className="flex items-baseline justify-between gap-[3vh]">
            <dt className={`whitespace-nowrap text-muted ${MINI_LABEL}`}>{label}</dt>
            <dd className="num text-[clamp(13px,13vh,56px)] font-medium leading-[1.12] tracking-tight">{value ?? <span className="text-faint">–</span>}</dd>
          </div>
        ))}
      </dl>

      {/* Controls: a full-height grey rail at the right edge (same width and grey as the panel's close column) opens a panel over the strip; the rest dims behind it. */}
      {!drawer && (
        <button
          className="absolute inset-y-0 right-0 z-20 flex w-[clamp(26px,10vh,48px)] items-center justify-center border-l border-line bg-raised text-muted transition-colors hover:bg-active hover:text-ink"
          onClick={() => setDrawer(true)}
          aria-expanded={false}
          aria-label="Show controls"
          title="Controls: pause, skip, intensity, ERG, end"
        >
          <SlidersIcon />
        </button>
      )}
      {drawer && (
        <>
          <div className="absolute inset-0 z-10 bg-black/60" onClick={() => setDrawer(false)} aria-hidden />
          <div
            className="absolute inset-y-0 right-0 z-20 flex max-w-full items-stretch border-l border-line bg-surface shadow-2xl animate-[drawer-in_160ms_ease-out]"
            onPointerDown={() => setTouched((n) => n + 1)}
            role="dialog"
            aria-label="Ride controls"
          >
            <div className="flex items-center overflow-x-auto px-[5vh] py-[2.5vh]">
              <DrawerControls data={data} controls={controls} onResize={onResize} />
            </div>
            <button
              className="flex w-[clamp(26px,10vh,48px)] shrink-0 items-center justify-center border-l border-line bg-raised text-muted transition-colors hover:bg-active hover:text-ink"
              onClick={() => setDrawer(false)}
              aria-label="Hide controls"
              title="Hide controls"
            >
              <svg viewBox="0 0 24 24" aria-hidden className={MINI_ICON} fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round">
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          </div>
          <style>{"@keyframes drawer-in{from{transform:translateX(100%)}to{transform:translateX(0)}}"}</style>
        </>
      )}
    </div>
  );
}

/** Sliders: the usual sign for controls you adjust. */
const SlidersIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden className={MINI_ICON} fill="none" stroke="currentColor" strokeWidth={2.25} strokeLinecap="round">
    <path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1" />
    <circle cx="15" cy="6" r="2" />
    <circle cx="9" cy="12" r="2" />
    <circle cx="17" cy="18" r="2" />
  </svg>
);

/** A small name over a group of the drawer's controls. */
const Group = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div className="flex flex-col justify-center gap-[1.2vh]">
    <div className={`whitespace-nowrap text-muted ${MINI_GROUP}`}>{label}</div>
    {children}
  </div>
);
const MINI_GROUP = "text-[clamp(10px,5.5vh,22px)] leading-none";
// The drawer's controls fill the panel's height in two rows, so they're big enough to hit from the saddle.
const D_H = "h-[clamp(28px,30vh,110px)]";
const D_ICON = "size-[clamp(16px,13vh,44px)]";
const D_TEXT = "text-[clamp(13px,11vh,36px)]";

/**
 * The overlay's controls, in the drawer, as icons read from the saddle, each group named: the
 * workout (back, play/pause, skip), intensity (or the free ERG target, or an ERG hold's watts),
 * the trainer (ERG switch, and the grade when it's on the road), the overlay's size, and End.
 */
function DrawerControls({ data, controls, onResize }: { data: PlayerData; controls: PlayerControls; onResize: (step: 1 | -1) => void }) {
  const base = `inline-flex ${D_H} items-center justify-center rounded-md transition-colors disabled:opacity-40`;
  const button = `${base} min-w-[clamp(34px,26vh,96px)] flex-1 bg-raised text-ink hover:bg-active`;
  const primary = `${base} min-w-[clamp(48px,38vh,140px)] flex-[1.6] bg-primary text-on-primary hover:opacity-85`;
  const value = `num min-w-[3.2em] text-center ${D_TEXT}`;
  const step = (delta: number) =>
    data.erg ? controls.onErg(data.erg.watts + delta * ERG_STEP) : data.holding ? controls.onHold(delta) : controls.onIntensity(delta);
  const showGrade = !data.erg && (!data.ergOn || data.sprintGrade !== null || data.freeRide);
  // End mid-ride takes a second tap, so a sweaty miss doesn't end the ride.
  const [confirmEnd, setConfirmEnd] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const win = ref.current?.ownerDocument.defaultView;
    if (!confirmEnd || !win) return;
    const id = win.setTimeout(() => setConfirmEnd(false), 4000);
    return () => win.clearTimeout(id);
  }, [confirmEnd]);

  return (
    <div ref={ref} className="flex flex-col gap-[4vh]">
      <div className="flex gap-[5vh]">
      <Group label={data.erg ? "Ride" : "Workout"}>
        <div className="flex gap-1.5">
          {!data.erg && (
            <button className={button} disabled={data.position <= 0} onClick={() => controls.onBack()} aria-label="Back" title="Back to the previous interval">
              <Icon d={ICON_BACK} className={D_ICON} />
            </button>
          )}
          <button className={primary} disabled={!controls.canPlay} onClick={() => controls.onPlayPause()} aria-label={playLabel(data)} title={controls.canPlay ? playLabel(data) : "Connect the trainer first"}>
            <Icon d={data.running ? ICON_PAUSE : ICON_PLAY} className={D_ICON} />
            {data.startIn !== null && <span className={`num ml-[0.3em] ${D_TEXT}`}>{data.startIn}</span>}
          </button>
          {!data.erg && (
            <button className={button} disabled={!data.current} onClick={() => controls.onSkip()} aria-label="Skip" title="Skip to the next interval">
              <Icon d={ICON_SKIP} className={D_ICON} />
            </button>
          )}
        </div>
      </Group>

      <Group label={data.erg ? "ERG target" : data.holding ? "Hold" : "Intensity"}>
        <div className="flex items-center gap-1.5">
          <button className={button} onClick={() => step(-1)} aria-label={data.erg || data.holding ? `Down ${ERG_STEP} W` : "Easier by 1%"} title="Easier">
            <Icon d={ICON_MINUS} className={D_ICON} />
          </button>
          <span className={value}>{data.erg ? `${data.erg.watts} W` : data.holding ? `${data.targetWatts ?? "–"} W` : `${data.intensity}%`}</span>
          <button className={button} onClick={() => step(1)} aria-label={data.erg || data.holding ? `Up ${ERG_STEP} W` : "Harder by 1%"} title="Harder">
            <Icon d={ICON_PLUS} className={D_ICON} />
          </button>
        </div>
      </Group>
      </div>

      <div className="flex gap-[5vh]">
      {!data.erg && (
        <Group label="Trainer">
          <div className="flex items-center gap-1.5">
            <ErgSwitch on={data.ergOn} onChange={controls.onErgMode} size={`${D_H} ${D_TEXT}`} />
            {showGrade && (
              <div className="flex items-center gap-1.5" title={data.sprintGrade !== null ? "Sprint resistance, kept for the next sprint" : "Grade"}>
                <button className={button} onClick={() => controls.onGrade(-1)} aria-label="Grade down 1%" title="Less resistance">
                  <Icon d={ICON_MINUS} className={D_ICON} />
                </button>
                <span className={value}>{data.sprintGrade ?? data.grade}%</span>
                <button className={button} onClick={() => controls.onGrade(1)} aria-label="Grade up 1%" title="More resistance">
                  <Icon d={ICON_PLUS} className={D_ICON} />
                </button>
              </div>
            )}
          </div>
        </Group>
      )}

      <Group label="Overlay">
        <div className="flex gap-1.5">
          <button className={button} onClick={() => onResize(-1)} title="Make the overlay smaller" aria-label="Smaller overlay">
            <StrokeIcon d={ICON_SHRINK} className={D_ICON} />
          </button>
          <button className={button} onClick={() => onResize(1)} title="Make the overlay bigger" aria-label="Bigger overlay">
            <StrokeIcon d={ICON_GROW} className={D_ICON} />
          </button>
        </div>
      </Group>

      {data.elapsed > 0 && (
        <Group label="Ride">
          <button
            className={`${base} whitespace-nowrap px-[0.8em] ${D_TEXT} font-medium ${confirmEnd ? "bg-negative text-on-primary hover:opacity-85" : "bg-raised text-ink hover:bg-active"}`}
            onClick={() => (confirmEnd ? controls.onEnd() : setConfirmEnd(true))}
            title="End the ride and save it"
          >
            {confirmEnd ? "Tap to end" : "End ride"}
          </button>
        </Group>
      )}
      </div>
    </div>
  );
}

/** ERG as a switch: the knob sits right and lit when ERG holds the target. */
function ErgSwitch({ on, onChange, size = `${MINI_H} ${MINI_TEXT}` }: { on: boolean; onChange: (on: boolean) => void; size?: string }) {
  return (
    <button
      role="switch"
      aria-checked={on}
      onClick={() => onChange(!on)}
      title={on ? "ERG on: turn it off and ride the targets yourself" : "ERG off: turn it on so the trainer holds the target"}
      className={`inline-flex ${size} items-center gap-[0.6em] rounded-md bg-raised px-[0.7em] font-medium text-ink transition-colors hover:bg-active`}
    >
      ERG
      <span className={`relative inline-block h-[1.2em] w-[2.1em] rounded-full transition-colors ${on ? "bg-primary" : "bg-active"}`}>
        <span className={`absolute top-[0.15em] size-[0.9em] rounded-full transition-all ${on ? "left-[1.05em] bg-on-primary" : "left-[0.15em] bg-muted"}`} />
      </span>
      <span className="w-[1.6em] text-left text-muted">{on ? "On" : "Off"}</span>
    </button>
  );
}

/**
 * The overlay at the workout's end, in place of the chart: what to extend with (free ride, ERG
 * hold or a workout block) and for how long, then Extend or End. Three rows; when the overlay is
 * stretched short and wide, one row with bigger buttons (the `end-wide` container variant).
 */
function MiniExtendOrEnd({ data, controls }: { data: PlayerData; controls: PlayerControls }) {
  const { extend } = data;
  // Wide: as tall as the strip comfortably allows, so they're easy to hit from the saddle.
  const h = `${MINI_H} end-wide:h-[clamp(28px,34vh,72px)]`;
  const text = `${MINI_TEXT} end-wide:text-[clamp(13px,11vh,26px)]`;
  const icon = `${MINI_ICON} end-wide:size-[clamp(14px,12vh,30px)]`;
  const base = `inline-flex ${h} items-center justify-center rounded-md transition-colors disabled:opacity-40`;
  const step = `${base} w-[clamp(26px,11vh,48px)] end-wide:w-[clamp(28px,34vh,72px)] shrink-0 bg-raised text-ink hover:bg-active`;
  const value = `num min-w-[3.6em] shrink-0 text-center ${text}`;
  return (
    <div className="flex h-full min-w-0 flex-col justify-center gap-[2vh] end-wide:flex-row end-wide:flex-wrap end-wide:content-center end-wide:items-center end-wide:gap-x-[4vh]">
      <KindPicker kind={extend.kind} onKind={controls.onExtendKind} className={`${h} px-[0.6em] end-wide:px-[0.9em] ${text}`} wrapClassName="end-wide:shrink-0" />
      <div className="flex min-w-0 items-center gap-1.5 end-wide:gap-x-[4vh]">
        <div className="flex shrink-0 items-center gap-1.5">
          <button className={step} onClick={() => controls.onExtendMinutes(extend.minutes - 1)} aria-label="A minute less" title="A minute less">
            <Icon d={ICON_MINUS} className={icon} />
          </button>
          <span className={value}>{extend.minutes} min</span>
          <button className={step} onClick={() => controls.onExtendMinutes(extend.minutes + 1)} aria-label="A minute more" title="A minute more">
            <Icon d={ICON_PLUS} className={icon} />
          </button>
        </div>
        {extend.kind === "erg" && (
          <div className="ml-[2vh] flex shrink-0 items-center gap-1.5 end-wide:ml-0">
            <button className={step} onClick={() => controls.onExtendWatts(extend.watts - ERG_STEP)} aria-label={`Down ${ERG_STEP} W`}>
              <Icon d={ICON_MINUS} className={icon} />
            </button>
            <span className={value}>{extend.watts} W</span>
            <button className={step} onClick={() => controls.onExtendWatts(extend.watts + ERG_STEP)} aria-label={`Up ${ERG_STEP} W`}>
              <Icon d={ICON_PLUS} className={icon} />
            </button>
          </div>
        )}
        {extend.kind === "block" && (
          <div className="ml-[2vh] flex min-w-0 flex-1 items-center gap-1.5 end-wide:ml-0 end-wide:max-w-[20em]">
            <button className={step} onClick={() => controls.onExtendBlock(-1)} aria-label="Previous block" title="Previous block">
              <Chevron left className={icon} />
            </button>
            <span className={`min-w-0 flex-1 truncate text-center ${text}`}>{extend.block}</span>
            <button className={step} onClick={() => controls.onExtendBlock(1)} aria-label="Next block" title="Next block">
              <Chevron className={icon} />
            </button>
          </div>
        )}
      </div>
      <div className="flex gap-1.5 end-wide:ml-auto end-wide:shrink-0">
        <button
          className={`${base} flex-1 bg-primary px-[0.8em] end-wide:flex-none end-wide:px-[1.4em] ${text} font-medium text-on-primary hover:opacity-85`}
          disabled={!controls.canPlay}
          onClick={() => controls.onExtend()}
        >
          Extend {extend.minutes} min
        </button>
        <button
          className={`${base} flex-1 bg-raised px-[0.8em] end-wide:flex-none end-wide:px-[1.4em] ${text} font-medium text-ink hover:bg-active`}
          onClick={() => controls.onEnd()}
          title="End the ride and save it"
        >
          End
        </button>
      </div>
    </div>
  );
}

function Mini({ label, value, tone, sub, small }: { label: string; value: number | string | undefined; tone?: Tone; sub?: string | null; small?: boolean }) {
  return (
    <div className="flex shrink-0 flex-col justify-center">
      <div className={`whitespace-nowrap text-muted ${MINI_LABEL}`}>{label}</div>
      <div className={`num font-medium tracking-tight ${small ? MINI_VALUE_SMALL : MINI_VALUE} ${tone ? TONE[tone] : ""}`}>{value ?? <span className="text-faint">–</span>}</div>
      <div className={`num whitespace-nowrap ${MINI_LABEL} ${tone ? TONE[tone] : "text-muted"}`}>{sub ?? " "}</div>
    </div>
  );
}
