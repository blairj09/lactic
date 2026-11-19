// The ride screen's data fields laid out by page template, bike computer style. Used by the Ride page
// while riding (live numbers) and by the field editor (sample numbers), so both look the same.
// Knows nothing about the ride itself: it draws the fields it's given.

import type { PageTemplate } from "@/lib/sdk/layout";
import { useEffect, useRef, useState } from "react";
import { blockOwnsNumber, type FieldLook, type FieldValue, type RideChart } from "@/lib/sdk/plugin-fields";
import { BlockView, zoneStyle } from "./blocks";
import { OWNS_ARROWS, pageKeyStep, stepsTo, swipeTracker } from "@/lib/ride/page-switch";

export type Tone = "positive" | "warning" | "negative" | "accent";
export const TONE: Record<Tone, string> = { positive: "text-positive", warning: "text-warning", negative: "text-negative", accent: "text-accent" };

/** One field, ready to draw. `value` undefined shows "–"; `reason` says why on tap. */
export interface Shown {
  label: string;
  value: number | string | undefined;
  unit: string;
  sub?: string | null;
  tone?: Tone;
  reason?: string;
  /** From a plugin: Lactic's plugin mark beside the name. */
  plugin?: boolean;
  /** A plugin field's small live chart, drawn under the number. */
  chart?: RideChart;
  /** A plugin field's few labeled numbers, drawn instead of one. */
  values?: FieldValue[];
  /** Takes two slots side by side. */
  wide?: boolean;
  /** A plugin field's zone colour, emphasis, change arrow and the line's own tone. */
  look?: FieldLook;
}

/** Whether a field's chart draws the number itself (a gauge, a status word), so the field doesn't. */
export const chartOwnsNumber = (chart: RideChart | undefined) => chart?.kind === "block" && blockOwnsNumber(chart.block);

/**
 * A plugin's "flash": a ring around the field for 3 s when it starts asking, at most once every 30 s
 * however often the plugin asks.
 */
function useFlash(on: boolean): boolean {
  const [lit, setLit] = useState(false);
  const last = useRef(-Infinity);
  const was = useRef(false);
  useEffect(() => {
    const rising = on && !was.current;
    was.current = on;
    if (!rising || Date.now() - last.current < 30_000) return;
    last.current = Date.now();
    setLit(true);
    const id = setTimeout(() => setLit(false), 3000);
    return () => clearTimeout(id);
  }, [on]);
  return lit;
}

/** The arrow after a number that moved: ▲ or ▼, coloured by whether that's good. */
export function ChangeArrow({ change }: { change: NonNullable<FieldLook["change"]> }) {
  return (
    <span aria-label={change.dir === "up" ? "rising" : "falling"} className={`ml-1 inline-block align-[0.45em] text-[0.3em] ${change.tone ? TONE[change.tone] : "text-muted"}`}>
      {change.dir === "up" ? "▲" : "▼"}
    </span>
  );
}

/** The small purple mark beside a plugin field's name, which the plugin can't draw or hide. */
export function PluginMark() {
  return <i aria-label="Plugin" title="From a plugin" className="inline-block size-1.5 shrink-0 rounded-[2px] bg-plugin" />;
}

/**
 * A plugin field's live chart, drawn by Lactic in its own colours: bars (zone colours for zone
 * bars), a trend line or a gauge. `small` for the overlay strip, without bar labels.
 */
export function FieldChart({ chart, small, valueSize }: { chart: RideChart; small?: boolean; valueSize?: string }) {
  if (chart.kind === "block") return <BlockView block={chart.block} size={small ? "sm" : valueSize && /text-(7xl|8xl|9xl|\[10rem\])/.test(valueSize) ? "lg" : "md"} valueSize={valueSize} />;
  const colour = chart.tone ? TONE[chart.tone] : "text-accent";
  const height = small ? "h-[1.4em]" : "h-12";
  if (chart.kind === "meter")
    return (
      <div className={`mt-2 overflow-hidden rounded-full bg-control ${small ? "h-[0.35em] w-[5em]" : "h-2"}`}>
        <div className={`h-full rounded-full bg-current ${colour}`} style={{ width: `${Math.round(Math.min(1, Math.max(0, chart.value)) * 100)}%` }} />
      </div>
    );
  if (chart.kind === "line") {
    const nums = chart.values.filter((v): v is number => v !== null);
    const extra = [...(chart.band ?? []), ...(chart.ref !== undefined ? [chart.ref] : [])];
    const min = chart.min ?? Math.min(...nums, ...extra);
    const span = (chart.max ?? Math.max(...nums, ...extra)) - min || 1;
    const step = 100 / Math.max(1, chart.values.length - 1);
    const y = (v: number) => 28 - ((Math.min(min + span, Math.max(min, v)) - min) / span) * 26;
    const points = chart.values.map((v, i) => (v === null ? null : `${(i * step).toFixed(1)},${y(v).toFixed(1)}`));
    const drawn = points.filter((p): p is string => p !== null);
    const lastI = chart.values.findLastIndex((v) => v !== null);
    return (
      <svg viewBox="0 0 100 30" preserveAspectRatio="none" className={`mt-1 w-full overflow-visible ${small ? "h-[1.4em] min-w-[5em]" : height} ${colour}`} aria-hidden>
        {chart.band && <rect x={0} width={100} y={y(chart.band[1])} height={Math.max(0, y(chart.band[0]) - y(chart.band[1]))} fill="var(--positive)" opacity={0.14} />}
        {chart.fill && drawn.length > 1 && <polygon fill="currentColor" opacity={0.2} points={`${drawn.join(" ")} ${drawn[drawn.length - 1].split(",")[0]},30 ${drawn[0].split(",")[0]},30`} />}
        {chart.ref !== undefined && <line x1={0} x2={100} y1={y(chart.ref)} y2={y(chart.ref)} stroke="var(--ink)" strokeOpacity={0.6} strokeDasharray="4 4" vectorEffect="non-scaling-stroke" />}
        <polyline fill="none" stroke="currentColor" strokeWidth="2" vectorEffect="non-scaling-stroke" points={drawn.join(" ")} />
        {chart.marker === "last" && lastI >= 0 && (
          <line x1={lastI * step} x2={lastI * step} y1={y(chart.values[lastI]!)} y2={y(chart.values[lastI]!)} stroke="var(--ink)" strokeWidth={small ? 5 : 8} strokeLinecap="round" vectorEffect="non-scaling-stroke" />
        )}
      </svg>
    );
  }
  const max = Math.max(1, ...chart.values, chart.target ?? 0);
  const lit = chart.highlight;
  return (
    <div className={`relative mt-1 flex items-end gap-1 ${small ? "w-[6em]" : ""}`} aria-hidden>
      {chart.values.map((v, i) => (
        <div key={i} className="flex min-w-0 flex-1 flex-col items-center">
          <div className={`flex w-full items-end ${height}`}>
            <div
              className={`w-full rounded-[3px] ${chart.zones ? "" : `bg-current ${colour}`}`}
              style={{ height: `${Math.max(4, (v / max) * 100)}%`, ...(chart.zones ? { background: `var(--zone-${Math.min(7, i + 1)})` } : {}), ...(lit !== undefined && i !== lit ? { opacity: 0.5 } : {}) }}
            />
          </div>
          {!small && chart.labels && <span className="text-xs text-muted">{chart.labels[i]}</span>}
        </div>
      ))}
      {chart.target !== undefined && (
        // The target across the bars, measured on the bars' own height (labels sit below it).
        <div className={`pointer-events-none absolute inset-x-0 top-0 ${height}`}>
          <div className="absolute inset-x-0 border-t border-dashed border-ink/60" style={{ bottom: `${(chart.target / max) * 100}%` }} />
        </div>
      )}
    </div>
  );
}

/**
 * A plugin field's labeled numbers, in the field's own number size (`size`) scaled down: a 2×2
 * block in a normal field, one row in a wide one.
 */
export function FieldValues({ values, wide, size }: { values: FieldValue[]; wide?: boolean; size: string }) {
  const cols = wide || values.length <= 2 ? ["", "", "grid-cols-2", "grid-cols-3", "grid-cols-4"][values.length] : "grid-cols-2";
  return (
    <div className={`num grid gap-x-4 gap-y-1 font-medium tracking-tight ${cols} ${size}`}>
      {values.map((v, i) => (
        <div key={i} className="min-w-0">
          <div className="truncate text-sm font-normal tracking-normal text-muted">{v.label}</div>
          <div className={`${wide ? "text-[0.7em]" : "text-[0.55em]"} leading-[1.1] ${v.tone ? TONE[v.tone] : ""}`}>{v.value}</div>
        </div>
      ))}
    </div>
  );
}

/** Labeled numbers in a short row or block, for the narrow lists (the standard page's ride so far, the overlay). */
export function FieldValuesCompact({ values, valueSize, labelSize }: { values: FieldValue[]; valueSize: string; labelSize: string }) {
  return (
    <div className={`num grid gap-x-[0.6em] ${values.length === 1 ? "grid-cols-1" : "grid-cols-2"} items-baseline`}>
      {values.map((v, i) => (
        <span key={i} className="whitespace-nowrap">
          <span className={`mr-[0.3em] text-muted ${labelSize}`}>{v.label}</span>
          <span className={`font-medium tracking-tight ${valueSize} ${v.tone ? TONE[v.tone] : ""}`}>{v.value}</span>
        </span>
      ))}
    </div>
  );
}

export function Big({
  label,
  value,
  unit,
  sub,
  lead,
  tone,
  size,
  reason,
  plugin,
  chart,
  values,
  wide,
  look,
  compact,
}: {
  label: string;
  value: number | string | undefined;
  unit: string;
  sub?: string | null;
  lead?: boolean;
  tone?: Tone;
  /** Classes for the number's size, instead of the lead and normal sizes. */
  size?: string;
  reason?: string;
  plugin?: boolean;
  chart?: RideChart;
  values?: FieldValue[];
  wide?: boolean;
  look?: FieldLook;
  /** A narrow column: charts are left out, and a block that shows its own number draws its short form. */
  compact?: boolean;
}) {
  const valueSize = size ?? (lead ? "text-5xl leading-[1.1] sm:text-6xl" : "text-4xl leading-[1.15]");
  const owns = chartOwnsNumber(chart);
  const shownChart = chart && (!compact || owns) ? chart : undefined;
  const flash = useFlash(look?.emphasis === "flash");
  const subTone = look?.subTone ?? tone;
  return (
    <div
      className={`min-w-0 rounded-lg transition-[opacity,outline-color] duration-300 ${look?.emphasis === "quiet" ? "opacity-45" : ""} ${flash ? "outline-2 outline-offset-4 outline-positive" : "outline-transparent"}`}
      title={value === undefined ? reason : undefined}
    >
      <div className="flex items-center gap-1.5 text-sm text-muted">
        {plugin && <PluginMark />}
        <span className="truncate">
          {label}
          {values && unit ? ` · ${unit}` : ""}
        </span>
      </div>
      {values ? (
        <FieldValues values={values} wide={wide} size={valueSize} />
      ) : (
        (value !== undefined || !shownChart) &&
        !owns && (
          <div className={`num font-medium tracking-tight ${valueSize} ${tone && !look?.zone ? TONE[tone] : ""}`} style={zoneStyle(look?.zone)}>
            {value ?? <span className="text-2xl text-faint">–</span>}
            {look?.change && value !== undefined && <ChangeArrow change={look.change} />}
            {unit && value !== undefined && <span className="ml-1.5 text-base font-normal tracking-normal text-muted">{unit}</span>}
          </div>
        )
      )}
      {shownChart && !values && <FieldChart chart={shownChart} small={compact} valueSize={owns ? valueSize : undefined} />}
      {sub !== undefined && <div className={`h-5 text-sm ${subTone ? TONE[subTone] : "text-muted"}`}>{sub}</div>}
    </div>
  );
}

/** Columns and number size for each grid template. Two columns on a phone. */
const GRID: Record<Exclude<PageTemplate, "standard">, { cols: string; size: string }> = {
  one: { cols: "grid-cols-1", size: "text-8xl leading-[1.05] sm:text-[10rem]" },
  two: { cols: "grid-cols-1 sm:grid-cols-2", size: "text-8xl leading-[1.05] sm:text-9xl" },
  four: { cols: "grid-cols-2", size: "text-6xl leading-[1.08] sm:text-7xl" },
  six: { cols: "grid-cols-2 sm:grid-cols-3", size: "text-5xl leading-[1.1] sm:text-6xl" },
  "six-chart": { cols: "grid-cols-2 sm:grid-cols-3", size: "text-5xl leading-[1.1] sm:text-6xl" },
  eight: { cols: "grid-cols-2 sm:grid-cols-4", size: "text-5xl leading-[1.1]" },
  ten: { cols: "grid-cols-2 sm:grid-cols-5", size: "text-4xl leading-[1.15] lg:text-5xl" },
};

/** A wide field's span: two columns wherever the page has two or more. */
const WIDE: Partial<Record<PageTemplate, string>> = { two: "sm:col-span-2", four: "col-span-2", six: "col-span-2", "six-chart": "col-span-2", eight: "col-span-2", ten: "col-span-2" };

export const hasChart = (template: PageTemplate) => template === "standard" || template === "six-chart";

/**
 * A page of fields. `shown[i]` is slot i (undefined for an empty slot); `slot` wraps each slot's
 * content (the editor adds selection and an Add button there); `chart` is the workout chart, drawn
 * where the template has one.
 */
export function FieldGrid({
  template,
  shown,
  slots,
  chart,
  slot = (_i, node) => node,
}: {
  template: PageTemplate;
  shown: (Shown | undefined)[];
  /** How many slots the template has. */
  slots: number;
  chart?: React.ReactNode;
  slot?: (i: number, node: React.ReactNode) => React.ReactNode;
}) {
  const at = (i: number) => shown[i];
  if (template === "standard") {
    // The ride screen as it was before layouts: this interval on the left (the first field across
    // both columns), the workout in the middle, the ride so far on the right.
    const big = (i: number, lead: boolean) => {
      const f = at(i);
      return slot(i, f ? <Big label={f.label} value={f.value} unit={f.unit} sub={f.sub} tone={f.tone} lead={lead} reason={f.reason} plugin={f.plugin} chart={f.chart} values={f.values} look={f.look} /> : null);
    };
    return (
      <div className="grid gap-x-8 gap-y-6 lg:grid-cols-[auto_minmax(0,1fr)_auto] lg:items-start">
        <div aria-label="This interval" className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4 lg:grid-cols-2">
          <div className="col-span-2">{big(0, true)}</div>
          {big(1, true)}
          {big(2, true)}
          {big(3, false)}
          {big(4, false)}
        </div>

        {chart ?? <div />}

        <dl aria-label="Ride so far" className="grid grid-cols-3 gap-x-6 gap-y-3 sm:grid-cols-5 lg:min-w-44 lg:grid-cols-1">
          {[5, 6, 7, 8, 9].map((i) => {
            const f = at(i);
            return (
              <div key={i} className="min-w-0 lg:flex lg:items-baseline lg:justify-between lg:gap-4 lg:border-t lg:border-rule lg:pt-2 lg:first:border-0 lg:first:pt-0">
                {slot(
                  i,
                  f ? (
                    <>
                      <dt className="truncate text-sm text-muted">{f.label}</dt>
                      <dd className="num text-2xl font-medium tracking-tight" title={f.value === undefined ? f.reason : undefined}>
                        {f.values ? (
                          <FieldValuesCompact values={f.values} valueSize="text-lg" labelSize="text-xs font-normal" />
                        ) : chartOwnsNumber(f.chart) ? (
                          <FieldChart chart={f.chart!} small valueSize="text-2xl" />
                        ) : (
                          (f.value ?? <span className="text-faint">–</span>)
                        )}
                        {f.unit && f.value !== undefined && <span className="ml-1 text-sm font-normal tracking-normal text-muted">{f.unit}</span>}
                      </dd>
                    </>
                  ) : null,
                )}
              </div>
            );
          })}
        </dl>
      </div>
    );
  }
  const g = GRID[template];
  return (
    <div className="space-y-6">
      <div aria-label="Ride fields" className={`grid grid-flow-row-dense gap-x-8 gap-y-6 ${g.cols}`}>
        {Array.from({ length: slots }, (_, i) => {
          const f = at(i);
          return (
            <div key={i} className={template === "one" ? "text-center" : f?.wide ? WIDE[template] : undefined}>
              {slot(i, f ? <Big label={f.label} value={f.value} unit={f.unit} sub={f.sub} tone={f.tone} size={g.size} reason={f.reason} plugin={f.plugin} chart={f.chart} values={f.values} wide={f.wide} look={f.look} /> : null)}
            </div>
          );
        })}
      </div>
      {template === "six-chart" && chart}
    </div>
  );
}

/** Dots for the ride pages, with the page's name, and ‹ › to step through them. A dot opens its page. */
export function PageDots({ names, page, onPage }: { names: string[]; page: number; onPage?: (step: 1 | -1) => void }) {
  if (names.length < 2) return null;
  const arrow = "inline-flex size-8 items-center justify-center rounded-md text-lg text-muted transition-colors hover:bg-raised hover:text-ink";
  return (
    <div className="flex items-center justify-center gap-3" aria-label="Ride pages">
      {onPage && (
        <button type="button" className={arrow} onClick={() => onPage(-1)} aria-label="Previous page" title="Previous page (←)">
          ‹
        </button>
      )}
      <span className="flex items-center">
        {names.map((n, i) =>
          onPage ? (
            <button key={i} type="button" className="group grid size-5 place-items-center" onClick={() => stepsTo(page, i, names.length).forEach((s) => onPage(s))} aria-label={`Page ${i + 1}: ${n}`} aria-current={i === page || undefined} title={n}>
              <span className={`size-2 rounded-full transition-colors ${i === page ? "bg-ink" : "bg-control group-hover:bg-muted"}`} />
            </button>
          ) : (
            <span key={i} className={`mx-0.5 size-2 rounded-full ${i === page ? "bg-ink" : "bg-control"}`} aria-hidden />
          ),
        )}
      </span>
      <span className="text-sm text-muted">
        {names[page]} · {page + 1} of {names.length}
      </span>
      {onPage && (
        <button type="button" className={arrow} onClick={() => onPage(1)} aria-label="Next page" title="Next page (→)">
          ›
        </button>
      )}
    </div>
  );
}

/**
 * ← and → change page in `win` (the Ride page's window, or the overlay's own window), unless the
 * rider is typing, on a slider or in a dialog. A window only hears keys while it has focus.
 */
export function usePageKeys(win: Window | null | undefined, onPage: ((step: 1 | -1) => void) | undefined) {
  const latest = useRef(onPage);
  latest.current = onPage;
  const on = !!onPage;
  useEffect(() => {
    if (!win || !on) return;
    const onKey = (e: KeyboardEvent) => {
      const step = pageKeyStep(e);
      if (step === null) return;
      const t = e.target as Element | null;
      if (t?.closest?.(OWNS_ARROWS)) return;
      e.preventDefault();
      latest.current?.(step);
    };
    win.addEventListener("keydown", onKey);
    return () => win.removeEventListener("keydown", onKey);
  }, [win, on]);
}

/** A two-finger sideways swipe on a trackpad (or a sideways mouse wheel) turns one page. */
export function useWheelSwipe(onPage: ((step: 1 | -1) => void) | undefined) {
  const tracker = useRef(swipeTracker());
  return onPage
    ? {
        onWheel: (e: React.WheelEvent) => {
          const step = tracker.current(e.deltaX, e.deltaY, e.timeStamp);
          if (step !== null) onPage(step);
        },
      }
    : {};
}

/** Sideways swipes on a touch screen step through the pages. Mouse and pen drags are left alone. */
export function swipeHandlers(onPage: ((step: 1 | -1) => void) | undefined) {
  let start: { x: number; y: number } | null = null;
  if (!onPage) return {};
  return {
    onTouchStart: (e: React.TouchEvent) => {
      const t = e.touches[0];
      start = t ? { x: t.clientX, y: t.clientY } : null;
    },
    onTouchEnd: (e: React.TouchEvent) => {
      const t = e.changedTouches[0];
      if (!start || !t) return;
      const dx = t.clientX - start.x;
      const dy = t.clientY - start.y;
      start = null;
      if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) onPage(dx < 0 ? 1 : -1);
    },
  };
}
