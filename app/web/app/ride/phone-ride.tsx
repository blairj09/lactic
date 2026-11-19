// The ride on a phone, full screen and fixed like the overlay: the workout map with where you are,
// this interval, the ride so far and the controls never scroll away. Swipe the middle for the
// rider's field pages and what's up next. Turned sideways it lays out like the desktop overlay.
// The same screen runs a ride on the phone and the remote for the computer's ride.

import { useEffect, useMemo, useRef, useState } from "react";
import { segmentRoles } from "@/lib/engine/segment-roles";
import { describeTarget, formatTime } from "@/lib/format";
import { powerZone } from "@/lib/engine/workout";
import { ERG_STEP } from "@/lib/ride/erg";
import type { RidePage } from "@/lib/sdk/layout";
import { Big, PluginMark, TONE, type Shown } from "./field-grid";
import {
  AdaptBanner,
  AdaptiveSwitch,
  ExtendOrEnd,
  ICON_BACK,
  ICON_MINUS,
  ICON_PAUSE,
  ICON_PLAY,
  ICON_PLUS,
  ICON_SKIP,
  ICON_STOP,
  Icon,
  ZoneDot,
  fieldsOf,
  intervalLabel,
  intervalTime,
  pageShown,
  pausedMidRide,
  playLabel,
  powerVsTarget,
  targetShown,
  trainerOwner,
  zoneOf,
  type PlayerControls,
  type PlayerData,
} from "./player";
import WorkoutChart from "./workout-chart";
import { useSafeArea } from "~/platform/safe-area";

/** One swipe page: the ride (always first), one of the rider's field pages, or what's up next. */
type PhonePage = { kind: "ride"; name: string } | { kind: "fields"; name: string; page: RidePage } | { kind: "next"; name: string };

/** The phone's pages for this ride. The standard field page is the Ride page here, so it isn't repeated. */
export function phonePages(data: PlayerData): PhonePage[] {
  const fields = fieldsOf(data).pages.filter((p) => p.template !== "standard");
  const workout = !data.erg && !data.appTrainer;
  return [
    { kind: "ride", name: "Ride" },
    ...fields.map((page) => ({ kind: "fields" as const, name: page.name, page })),
    ...(workout ? [{ kind: "next" as const, name: "Up next" }] : []),
  ];
}

/** Sideways on a phone. */
function useLandscape(): boolean {
  const query = "(orientation: landscape)";
  const [landscape, setLandscape] = useState(() => typeof window !== "undefined" && window.matchMedia?.(query).matches === true);
  useEffect(() => {
    const media = window.matchMedia?.(query);
    if (!media) return;
    const on = () => setLandscape(media.matches);
    on();
    media.addEventListener("change", on);
    return () => media.removeEventListener("change", on);
  }, []);
  return landscape;
}

/**
 * A sideways swipe steps through the pages. The start is kept in a ref, so the screen redrawing
 * each second mid-swipe doesn't lose it.
 */
function useSwipe(onStep: (step: 1 | -1) => void) {
  const start = useRef<{ x: number; y: number } | null>(null);
  return {
    onTouchStart: (e: React.TouchEvent) => {
      const t = e.touches[0];
      start.current = t ? { x: t.clientX, y: t.clientY } : null;
    },
    onTouchEnd: (e: React.TouchEvent) => {
      const t = e.changedTouches[0];
      const s = start.current;
      start.current = null;
      if (!s || !t) return;
      const dx = t.clientX - s.x;
      const dy = t.clientY - s.y;
      if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) onStep(dx < 0 ? 1 : -1);
    },
  };
}

export function PhoneRide({
  data,
  controls,
  sub,
  onHide,
  notice,
}: {
  data: PlayerData;
  controls: PlayerControls;
  /** Under the workout's name before the time, e.g. "On James's Mac". */
  sub?: string;
  /** ⌄: tucks the ride screen away. */
  onHide: () => void;
  notice?: React.ReactNode;
}) {
  const landscape = useLandscape();
  // The web view's own safe area goes stale when the phone turns (see safe-area.ts).
  useSafeArea(true);
  const pages = phonePages(data);
  const [index, setIndex] = useState(0);
  const at = Math.min(index, pages.length - 1);
  const page = pages[at];
  const step = (s: 1 | -1) => setIndex(Math.min(Math.max(at + s, 0), pages.length - 1));
  const swipe = useSwipe(step);
  // Nothing behind it scrolls while it's up.
  useEffect(() => {
    const was = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => void (document.body.style.overflow = was);
  }, []);
  const props = { data, controls, pages, at, page, onHide, notice, sub, swipe, onDot: setIndex };
  return (
    <div role="dialog" aria-label="Ride" className="fixed inset-0 z-50 flex select-none flex-col overflow-hidden overscroll-none bg-ground text-ink">
      {landscape ? <Landscape {...props} /> : <Portrait {...props} />}
    </div>
  );
}

interface LayoutProps {
  data: PlayerData;
  controls: PlayerControls;
  pages: PhonePage[];
  at: number;
  page: PhonePage;
  onHide: () => void;
  notice?: React.ReactNode;
  sub?: string;
  swipe: ReturnType<typeof useSwipe>;
  onDot: (i: number) => void;
}

/** Ride time against the workout's length, or the ride time with no workout. */
const progress = (data: PlayerData) =>
  data.ended ? `Ended · ${formatTime(data.elapsed)}` : data.erg || data.appTrainer ? formatTime(data.elapsed) : `${formatTime(data.position)} of ${formatTime(data.duration)}`;

// Upright, the web view's env() insets are right, so the app's answer (--safe-*) only ever adds to
// them: a stale or empty answer can't put the header under the status bar.
function Portrait({ data, controls, pages, at, page, onHide, notice, sub, swipe, onDot }: LayoutProps) {
  return (
    <>
      <div className="flex flex-none items-center gap-3 px-4 pb-2 pt-[calc(max(var(--safe-top,0px),env(safe-area-inset-top))+8px)]">
        <HideButton onHide={onHide} />
        <div className="min-w-0 flex-1">
          <div className="truncate font-semibold">{data.workout.name}</div>
          <div className="num truncate text-sm text-muted">{[sub, progress(data)].filter(Boolean).join(" · ")}</div>
        </div>
        <EndButton data={data} controls={controls} />
      </div>

      <div className="flex-none px-4">
        <RideMap data={data} className="h-[clamp(56px,12vh,128px)] w-full text-ink" />
      </div>

      <div className="flex min-h-0 flex-1 flex-col" {...swipe}>
        {notice && <div className="px-4 pt-2">{notice}</div>}
        {data.adapt && (
          <div className="px-4 pt-2">
            <AdaptBanner data={data} controls={controls} />
          </div>
        )}
        {data.finished && !data.ended ? (
          <div className="min-h-0 flex-1 overflow-y-auto px-4 pt-4">
            <ExtendOrEnd data={data} controls={controls} />
          </div>
        ) : data.ended ? (
          <Ended data={data} />
        ) : page.kind === "ride" ? (
          <>
            <IntervalBlock data={data} />
            <Totals data={data} />
          </>
        ) : (
          <>
            <IntervalStrip data={data} />
            {page.kind === "fields" ? <FieldPage data={data} page={page.page} columns={2} /> : <UpNext data={data} />}
          </>
        )}
        {!data.ended && !data.finished && <Dots pages={pages} at={at} onDot={onDot} />}
      </div>

      {!data.ended && !data.finished && (
        <div aria-label="Ride controls" className="flex-none space-y-2.5 border-t border-line bg-surface px-4 pt-3 pb-[max(var(--safe-bottom,0px),env(safe-area-inset-bottom),12px)]">
          <TransportRow data={data} controls={controls} />
          <AdjustRow data={data} controls={controls} />
        </div>
      )}
    </>
  );
}

function Landscape({ data, controls, pages, at, page, onHide, notice, swipe, onDot }: LayoutProps) {
  const sides = "pl-[calc(var(--safe-left,env(safe-area-inset-left))+16px)] pr-[calc(var(--safe-right,env(safe-area-inset-right))+16px)]";
  return (
    <>
      {notice && <div className={`flex-none pt-2 ${sides}`}>{notice}</div>}
      <div className={`flex min-h-0 flex-1 gap-5 pt-[max(var(--safe-top,env(safe-area-inset-top)),12px)] ${sides}`} {...swipe}>
        {data.ended ? (
          <Ended data={data} />
        ) : (
          <>
            <div className="flex w-[clamp(200px,32vw,300px)] flex-none flex-col">
              <IntervalBlock data={data} compact />
            </div>
            <div aria-hidden className="w-px flex-none bg-line" />
            {data.finished ? (
              <div className="min-h-0 min-w-0 flex-1 overflow-y-auto">
                <ExtendOrEnd data={data} controls={controls} />
              </div>
            ) : data.adapt ? (
              <div className="min-w-0 flex-1 space-y-3">
                <RideMap data={data} className="h-16 w-full text-ink" />
                <AdaptBanner data={data} controls={controls} />
              </div>
            ) : page.kind === "ride" ? (
              <>
                <div className="flex min-w-0 flex-1 flex-col">
                  <RideMap data={data} className="min-h-0 w-full flex-1 text-ink" />
                  <NextLine data={data} />
                </div>
                <div aria-hidden className="w-px flex-none bg-line" />
                <Totals data={data} column />
              </>
            ) : (
              <div className="flex min-w-0 flex-1 flex-col">
                <RideMap data={data} className="h-14 w-full flex-none text-ink" />
                {page.kind === "fields" ? <FieldPage data={data} page={page.page} columns={3} /> : <UpNext data={data} />}
              </div>
            )}
          </>
        )}
      </div>
      <div aria-label="Ride controls" className={`flex flex-none items-center gap-2 pt-2 pb-[max(var(--safe-bottom,env(safe-area-inset-bottom)),10px)] ${sides}`}>
        <HideButton onHide={onHide} />
        <div className="flex min-w-0 flex-1 items-center gap-2 overflow-x-auto">
          {!data.ended && !data.finished && (
            <>
              <TransportRow data={data} controls={controls} compact />
              <AdjustRow data={data} controls={controls} compact />
            </>
          )}
        </div>
        {!data.ended && !data.finished && <Dots pages={pages} at={at} onDot={onDot} bare />}
        <EndButton data={data} controls={controls} />
      </div>
    </>
  );
}

function HideButton({ onHide }: { onHide: () => void }) {
  return (
    <button
      type="button"
      onClick={onHide}
      aria-label="Hide ride screen"
      title="Hide ride screen"
      className="inline-flex size-10 flex-none items-center justify-center rounded-lg bg-raised text-ink transition-colors hover:bg-active hc:outline hc:outline-1 hc:outline-line"
    >
      <svg viewBox="0 0 24 24" aria-hidden className="size-5" fill="none" stroke="currentColor" strokeWidth={2.25} strokeLinecap="round" strokeLinejoin="round">
        <path d="M6 9l6 6 6-6" />
      </svg>
    </button>
  );
}

/** End mid-ride takes a second tap, so a sweaty miss doesn't end the ride. */
function EndButton({ data, controls }: { data: PlayerData; controls: PlayerControls }) {
  const [sure, setSure] = useState(false);
  useEffect(() => {
    if (!sure) return;
    const id = window.setTimeout(() => setSure(false), 4000);
    return () => window.clearTimeout(id);
  }, [sure]);
  if (data.ended || data.finished || data.elapsed === 0) return null;
  return (
    <button
      type="button"
      onClick={() => (sure ? controls.onEnd() : setSure(true))}
      className={`inline-flex h-10 flex-none items-center rounded-lg border px-4 text-[15px] transition-colors ${sure ? "border-negative bg-negative text-on-primary" : "border-control text-ink hover:bg-raised"}`}
    >
      {sure ? "End ride?" : "End"}
    </button>
  );
}

/** The whole workout, colored by zone, with what you rode and where you are. */
function RideMap({ data, className }: { data: PlayerData; className: string }) {
  return (
    <div aria-label="Workout map" className={className}>
      <WorkoutChart workout={data.workout} ftp={data.ftp} position={data.position} trace={data.trace} to={Math.max(data.duration, 1)} className="h-full w-full text-ink" />
    </div>
  );
}

/** Next interval, the free ERG target against FTP, or who has the trainer. */
function NextLine({ data, className = "" }: { data: PlayerData; className?: string }) {
  const next = data.upcoming[0];
  const { ftp } = data;
  return (
    <div className={`num flex min-w-0 items-center gap-2 pt-2 text-[15px] text-muted ${className}`}>
      {data.erg && !data.ergOn ? (
        `${data.grade}% grade · shift to set your effort`
      ) : data.erg ? (
        ftp > 0 && (
          <>
            <ZoneDot zone={powerZone(data.erg.watts / ftp)} />
            {Math.round((data.erg.watts / ftp) * 100)}% FTP · zone {powerZone(data.erg.watts / ftp)}
          </>
        )
      ) : data.appTrainer ? (
        trainerOwner(data)
      ) : next ? (
        <>
          <ZoneDot zone={zoneOf(next)} />
          <span className="truncate">
            Next {formatTime(next.end - next.start)} at {describeTarget(next, ftp)}
          </span>
        </>
      ) : data.current ? (
        "Last interval"
      ) : null}
    </div>
  );
}

const Unit = ({ children }: { children: React.ReactNode }) => <span className="ml-1 text-[0.32em] font-normal tracking-normal text-muted">{children}</span>;
const Label = ({ children }: { children: React.ReactNode }) => <div className="truncate text-sm text-muted">{children}</div>;
const Dash = () => <span className="text-faint">–</span>;

/**
 * This interval: time left, power against target, heart rate and cadence. With no workout, ride
 * time and power (and the ERG target in free ERG). Sizes follow the screen's height, so an SE fits.
 */
function IntervalBlock({ data, compact }: { data: PlayerData; compact?: boolean }) {
  const off = powerVsTarget(data);
  const status = data.startIn !== null ? `Starting in ${data.startIn}` : data.autoPaused ? "Paused · pedal to resume" : null;
  const noTarget = data.appTrainer;
  const time = compact ? "text-[min(22vh,10vw,104px)]" : "text-[clamp(44px,11vh,112px)]";
  const main = compact ? "text-[min(13vh,5.6vw,64px)]" : "text-[clamp(32px,6.8vh,72px)]";
  const small = compact ? "text-[clamp(22px,8vh,36px)]" : "text-[clamp(22px,4vh,40px)]";
  const num = "num font-semibold leading-[0.95] tracking-tight";
  const label = intervalLabel(data);
  const roles = useMemo(() => segmentRoles(data.workout), [data.workout]);
  return (
    <div className={`flex min-h-0 flex-col overflow-hidden ${compact ? "" : "flex-1 justify-center px-5 py-2"}`}>
      <div className="flex items-baseline gap-2 text-sm text-muted">
        <span className="truncate">{data.current && !data.erg && !data.appTrainer && roles[data.current.index] ? `${label} · ${roles[data.current.index]}` : label}</span>
      </div>
      <div className={`${num} ${time} mt-1`}>{intervalTime(data) ?? "0:00"}</div>
      {status && <div className="mt-1 text-sm text-warning">{status}</div>}
      <div className={`grid grid-cols-2 gap-x-4 ${compact ? "mt-3" : "mt-[clamp(8px,2vh,20px)]"}`}>
        <div className="min-w-0">
          <Label>Power</Label>
          <div className={`${num} ${main} ${off ? TONE[off.tone] : ""}`}>
            {data.power ?? <Dash />}
            {data.power !== undefined && <Unit>W</Unit>}
          </div>
          {off && <div className={`truncate text-sm ${TONE[off.tone]}`}>{off.text}</div>}
        </div>
        {noTarget ? (
          <div className="min-w-0">
            <Label>Heart rate</Label>
            <div className={`${num} ${main}`}>
              {data.heartRate ?? <Dash />}
              {data.heartRate !== undefined && <Unit>bpm</Unit>}
            </div>
          </div>
        ) : (
          <div className="min-w-0">
            <Label>Target</Label>
            <div className={`${num} ${main}`}>
              {targetShown(data) ?? <Dash />}
              {data.targetWatts !== null && <Unit>W</Unit>}
            </div>
          </div>
        )}
      </div>
      <div className={`grid grid-cols-2 gap-x-4 ${compact ? "mt-2" : "mt-[clamp(6px,1.6vh,16px)]"}`}>
        {!noTarget && (
          <div className="min-w-0">
            <Label>{compact ? "HR" : "Heart rate"}</Label>
            <div className={`${num} ${small}`}>
              {data.heartRate ?? <Dash />}
              {data.heartRate !== undefined && !compact && <Unit>bpm</Unit>}
            </div>
          </div>
        )}
        <div className="min-w-0">
          <Label>Cadence</Label>
          <div className={`${num} ${small}`}>
            {data.cadence ?? <Dash />}
            {data.cadence !== undefined && !compact && <Unit>rpm</Unit>}
          </div>
        </div>
      </div>
      {!compact && <NextLine data={data} className="mt-[clamp(4px,1.5vh,14px)] [@media(max-height:700px)]:hidden" />}
    </div>
  );
}

/** One line for the other pages: this interval's time, power and target. */
function IntervalStrip({ data }: { data: PlayerData }) {
  const off = powerVsTarget(data);
  return (
    <div className="num flex flex-none items-baseline gap-3 border-b border-rule px-5 py-2 hc:border-line">
      <span className="self-center text-sm text-muted">{intervalLabel(data, true)}</span>
      <span className="text-[28px] font-semibold tracking-tight">{intervalTime(data) ?? "0:00"}</span>
      <span className="flex-1" />
      <span className={`text-[28px] font-semibold tracking-tight ${off ? TONE[off.tone] : ""}`}>{data.power ?? "–"}</span>
      {!data.appTrainer && <span className="text-muted">/ {targetShown(data) ?? "–"}{data.targetWatts !== null && " W"}</span>}
    </div>
  );
}

/** The ride so far: averages, stress, and time to go in a workout. */
function Totals({ data, column }: { data: PlayerData; column?: boolean }) {
  const t = data.totals;
  const workout = !data.erg && !data.appTrainer;
  const items: [string, string | number | null][] = [
    ["Avg power", t.power],
    ["Avg HR", t.heartRate],
    workout ? ["TSS", t.tss] : ["Avg cadence", t.cadence],
    workout ? ["To go", formatTime(Math.max(0, data.duration - data.position))] : ["TSS", t.tss],
  ];
  return (
    <dl
      aria-label="Ride so far"
      className={
        column
          ? "num flex w-[clamp(96px,16vw,150px)] flex-none flex-col justify-center gap-[clamp(4px,2.5vh,14px)]"
          : "num grid flex-none grid-cols-4 gap-2 border-y border-rule px-5 py-3 hc:border-line"
      }
    >
      {items.map(([label, value]) => (
        <div key={label} className="min-w-0">
          <dt className="truncate text-[13px] text-muted">{label}</dt>
          <dd className={`font-semibold tracking-tight ${column ? "text-[clamp(18px,7vh,28px)] leading-tight" : "text-[21px]"}`}>{value ?? <Dash />}</dd>
        </div>
      ))}
    </dl>
  );
}

/** One of the rider's field pages, plugin fields included. Tap a "–" to see why it's empty. */
function FieldPage({ data, page, columns }: { data: PlayerData; page: RidePage; columns: 2 | 3 }) {
  const fields = fieldsOf(data);
  const shown = pageShown(page, { ...data, fields }).filter((f): f is Shown => !!f);
  const [why, setWhy] = useState<Shown | null>(null);
  const few = shown.length <= 2;
  const size =
    columns === 3
      ? "text-[clamp(24px,10vh,40px)] leading-[1.05]"
      : few
        ? "text-[clamp(56px,11vh,96px)] leading-[1.05]"
        : shown.length <= 4
          ? "text-[clamp(40px,7.5vh,64px)] leading-[1.05]"
          : "text-[clamp(28px,5.2vh,44px)] leading-[1.08]";
  const cols = few && columns === 2 ? "grid-cols-1" : columns === 3 ? "grid-cols-3" : "grid-cols-2";
  return (
    <div className={`min-h-0 flex-1 overflow-hidden ${columns === 3 ? "pt-3" : "px-5 pt-3"}`}>
      <div aria-label="Ride fields" className={`grid ${cols} gap-x-5 gap-y-[clamp(6px,1.8vh,16px)]`}>
        {shown.map((f, i) => (
          <button
            type="button"
            key={i}
            className={`min-w-0 text-left ${f.wide && !(few && columns === 2) ? "col-span-2" : ""}`}
            onClick={() => setWhy(f.value === undefined && f.reason ? f : null)}
            aria-label={f.value === undefined && f.reason ? `${f.label}: ${f.reason}` : undefined}
          >
            <Big label={f.label} value={f.value} unit={f.unit} sub={columns === 3 ? undefined : f.sub} tone={f.tone} size={size} plugin={f.plugin} chart={f.chart} compact={columns === 3} values={f.values} wide={f.wide} look={f.look} />
          </button>
        ))}
      </div>
      {why && (
        <div role="status" className="mt-3 flex items-start justify-between gap-3 rounded-lg bg-raised px-3 py-2 text-sm">
          <span>
            {why.plugin && <PluginMark />} <span className="font-medium">{why.label}:</span> {why.reason}
          </span>
          <button type="button" className="text-muted underline underline-offset-2" onClick={() => setWhy(null)}>
            OK
          </button>
        </div>
      )}
    </div>
  );
}

/** This interval and the rest of the workout. */
function UpNext({ data }: { data: PlayerData }) {
  const { current, ftp } = data;
  const rows = [...(current ? [current] : []), ...data.upcoming];
  return (
    <ul aria-label="Up next" className="num min-h-0 flex-1 overflow-hidden px-5 pt-2 text-base">
      {rows.length === 0 && <li className="py-3 text-muted">Nothing after this.</li>}
      {rows.map((i) => {
        const now = i === current;
        return (
          <li key={i.index} className={`flex items-center gap-3 border-b border-rule py-2.5 hc:border-line ${now ? "font-semibold" : ""}`}>
            <ZoneDot zone={zoneOf(i)} />
            <span className="w-14">{formatTime(i.end - i.start)}</span>
            <span className="truncate">{describeTarget(i, ftp)}</span>
            <span className={`ml-auto flex-none ${now ? "" : "text-muted"}`}>{now ? `${formatTime(i.end - data.position)} left` : `in ${formatTime(i.start - data.position)}`}</span>
          </li>
        );
      })}
    </ul>
  );
}

function Ended({ data }: { data: PlayerData }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
      <div className="text-lg font-semibold">Ride ended</div>
      <div className="num text-muted">{formatTime(data.elapsed)}</div>
    </div>
  );
}

/** Which page, as dots; tapping a dot goes there. */
function Dots({ pages, at, onDot, bare }: { pages: PhonePage[]; at: number; onDot: (i: number) => void; bare?: boolean }) {
  if (pages.length < 2) return null;
  return (
    <div className={`flex flex-none items-center justify-center gap-1.5 ${bare ? "" : "py-2"}`} aria-label={`Page ${at + 1} of ${pages.length}: ${pages[at].name}`}>
      {pages.map((p, i) => (
        <button
          type="button"
          key={i}
          onClick={() => onDot(i)}
          aria-label={p.name}
          aria-current={i === at ? "page" : undefined}
          className={`h-2 rounded-full transition-all ${i === at ? "w-5 bg-ink" : "w-2 bg-control"}`}
        />
      ))}
      {!bare && <span className="ml-1.5 text-xs text-muted">{pages[at].name}</span>}
    </div>
  );
}

const side =
  "inline-flex flex-none items-center justify-center rounded-xl bg-raised text-ink transition-colors hover:bg-active disabled:opacity-40 hc:outline hc:outline-1 hc:outline-line";

/** Back, play/pause and skip: big enough for a sweaty thumb. No workout: play/pause only. */
function TransportRow({ data, controls, compact }: { data: PlayerData; controls: PlayerControls; compact?: boolean }) {
  const noWorkout = !!data.erg || data.appTrainer;
  const h = compact ? "h-12" : "h-14";
  const paused = pausedMidRide(data);
  return (
    <div className={`flex items-center gap-2.5 ${compact ? "flex-none" : ""}`}>
      {!noWorkout && !paused && (
        <button className={`${side} ${h} ${compact ? "w-12" : "w-16"}`} disabled={data.position <= 0} onClick={() => controls.onBack()} aria-label="Back" title="Back to the previous interval">
          <Icon d={ICON_BACK} />
        </button>
      )}
      <button
        className={`inline-flex ${h} min-w-0 items-center justify-center rounded-xl bg-primary text-lg font-medium text-on-primary transition-opacity hover:opacity-85 disabled:opacity-50 ${compact ? "w-[clamp(72px,12vw,112px)] flex-none" : "flex-1"}`}
        disabled={!controls.canPlay}
        onClick={() => controls.onPlayPause()}
        aria-label={playLabel(data)}
        title={playLabel(data)}
      >
        <span className="inline-flex items-center gap-2">
          <Icon d={data.running ? ICON_PAUSE : ICON_PLAY} className="size-7" />
          {data.startIn !== null && <span className="num">{data.startIn}</span>}
          {paused && !compact && "Resume"}
        </span>
      </button>
      {paused && (
        <button
          className={`inline-flex ${h} min-w-0 items-center justify-center gap-2 rounded-xl bg-raised text-lg font-medium text-ink transition-colors hover:bg-active hc:outline hc:outline-1 hc:outline-line ${compact ? "w-[clamp(72px,12vw,112px)] flex-none" : "flex-1"}`}
          onClick={() => controls.onEnd()}
          aria-label="End ride"
          title="End the ride and save it"
        >
          <Icon d={ICON_STOP} className="size-6" />
          {!compact && "End"}
        </button>
      )}
      {!noWorkout && !paused && (
        <button className={`${side} ${h} ${compact ? "w-12" : "w-16"}`} disabled={!data.current} onClick={() => controls.onSkip()} aria-label="Skip" title="Skip to the next interval">
          <Icon d={ICON_SKIP} />
        </button>
      )}
    </div>
  );
}

/**
 * What you adjust while riding: intensity (or an ERG hold's watts, or a free ride's ERG target or grade), the
 * ERG switch, the grade when the trainer rides like a road, and adaptive when it applies. Sideways
 * (compact) it sits in the controls bar, which scrolls if it all doesn't fit. Labels stack over their
 * values so intensity, ERG and adaptive share one row upright on the narrowest iPhone; upright it
 * wraps to a second row rather than hiding anything off the edge.
 */
function AdjustRow({ data, controls, compact }: { data: PlayerData; controls: PlayerControls; compact?: boolean }) {
  if (data.appTrainer) return null;
  const showGrade = !data.erg && (!data.ergOn || data.sprintGrade !== null || data.freeRide);
  const Step = StackedStepper;
  const wrap = compact ? "w-40 flex-none [&>div]:w-full" : "min-w-[9.5rem] flex-1 [&>div]:w-full";
  const pill =
    "flex h-12 flex-none flex-col items-center justify-center gap-1 rounded-lg bg-raised px-3 text-xs text-muted transition-colors hover:bg-active hc:outline hc:outline-1 hc:outline-line";
  return (
    <div className={compact ? "flex flex-none items-center gap-2 overflow-x-auto" : "flex flex-wrap items-center gap-2"}>
      {data.erg && !data.ergOn ? (
        <div className={wrap}>
          <Step label="Grade" value={`${data.grade}%`} onDown={() => controls.onGrade(-1)} onUp={() => controls.onGrade(1)} downLabel="Less resistance" upLabel="More resistance" />
        </div>
      ) : data.erg ? (
        <div className={wrap}>
          <Step
            label="Target"
            value={`${data.erg.watts} W`}
            onDown={() => controls.onErg(data.erg!.watts - 2 * ERG_STEP)}
            onUp={() => controls.onErg(data.erg!.watts + 2 * ERG_STEP)}
            downLabel={`Down ${2 * ERG_STEP} W`}
            upLabel={`Up ${2 * ERG_STEP} W`}
          />
        </div>
      ) : (
        <div className={wrap}>
          {data.holding ? (
            <Step label="Hold" value={`${data.targetWatts ?? "–"} W`} onDown={() => controls.onHold(-1)} onUp={() => controls.onHold(1)} downLabel={`Down ${ERG_STEP} W`} upLabel={`Up ${ERG_STEP} W`} />
          ) : (
            <Step label="Intensity" value={`${data.intensity}%`} onDown={() => controls.onIntensity(-5)} onUp={() => controls.onIntensity(5)} downLabel="Easier by 5%" upLabel="Harder by 5%" />
          )}
        </div>
      )}
      {showGrade && (
        <div className={wrap}>
          <Step
            label={data.sprintGrade !== null ? "Sprint" : "Grade"}
            value={`${data.sprintGrade ?? data.grade}%`}
            onDown={() => controls.onGrade(-1)}
            onUp={() => controls.onGrade(1)}
            downLabel="Less resistance"
            upLabel="More resistance"
          />
        </div>
      )}
      <button role="switch" aria-checked={data.ergOn} onClick={() => controls.onErgMode(!data.ergOn)} className={pill}>
        ERG
        <span className={`relative inline-block h-5 w-9 rounded-full transition-colors ${data.ergOn ? "bg-primary" : "bg-active"}`}>
          <span className={`absolute top-1/2 size-4 -translate-y-1/2 rounded-full transition-all ${data.ergOn ? "left-[1.125rem]" : "left-0.5"} ${data.ergOn ? "bg-on-primary" : "bg-muted"}`} />
        </span>
      </button>
      {data.adaptive && !data.erg && (
        <AdaptiveSwitch on={data.adaptive.on} onChange={controls.onAdaptive} className={`${pill} [&>span]:text-[18px]`} />
      )}
    </div>
  );
}

/** − and + either side of the label stacked over its value, narrow enough to share a row. */
function StackedStepper({ label, value, onDown, onUp, downLabel, upLabel }: { label: string; value: string; onDown: () => void; onUp: () => void; downLabel: string; upLabel: string }) {
  const step = "inline-flex size-10 flex-none items-center justify-center rounded-md text-lg text-ink transition-colors hover:bg-active";
  return (
    <div className="flex h-12 items-center gap-1 rounded-lg bg-raised px-1 hc:outline hc:outline-1 hc:outline-line">
      <button className={step} onClick={onDown} aria-label={downLabel} title={downLabel}>
        <Icon d={ICON_MINUS} className="size-4" />
      </button>
      <div className="flex min-w-0 flex-1 flex-col items-center leading-tight">
        <span className="text-xs text-muted">{label}</span>
        <span className="num text-[15px]">{value}</span>
      </div>
      <button className={step} onClick={onUp} aria-label={upLabel} title={upLabel}>
        <Icon d={ICON_PLUS} className="size-4" />
      </button>
    </div>
  );
}
