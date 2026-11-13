// The ride screen's data fields laid out by page template, head-unit style. Used by the Ride page
// while riding (live numbers) and by the field editor (sample numbers), so both look the same.
// Knows nothing about the ride itself: it draws the fields it's given.

import type { PageTemplate } from "@/lib/sdk/layout";

export type Tone = "positive" | "warning" | "negative";
export const TONE: Record<Tone, string> = { positive: "text-positive", warning: "text-warning", negative: "text-negative" };

/** One field, ready to draw. `value` undefined shows "–"; `reason` says why on tap. */
export interface Shown {
  label: string;
  value: number | string | undefined;
  unit: string;
  sub?: string | null;
  tone?: Tone;
  reason?: string;
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
}) {
  const valueSize = size ?? (lead ? "text-5xl leading-[1.1] sm:text-6xl" : "text-4xl leading-[1.15]");
  return (
    <div className="min-w-0" title={value === undefined ? reason : undefined}>
      <div className="truncate text-sm text-muted">{label}</div>
      <div className={`num font-medium tracking-tight ${valueSize} ${tone ? TONE[tone] : ""}`}>
        {value ?? <span className="text-2xl text-faint">–</span>}
        {unit && value !== undefined && <span className="ml-1.5 text-base font-normal tracking-normal text-muted">{unit}</span>}
      </div>
      {sub !== undefined && <div className={`h-5 text-sm ${tone ? TONE[tone] : "text-muted"}`}>{sub}</div>}
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
      return slot(i, f ? <Big label={f.label} value={f.value} unit={f.unit} sub={f.sub} tone={f.tone} lead={lead} reason={f.reason} /> : null);
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
                        {f.value ?? <span className="text-faint">–</span>}
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
      <div aria-label="Ride fields" className={`grid gap-x-8 gap-y-6 ${g.cols}`}>
        {Array.from({ length: slots }, (_, i) => {
          const f = at(i);
          return (
            <div key={i} className={template === "one" ? "text-center" : undefined}>
              {slot(i, f ? <Big label={f.label} value={f.value} unit={f.unit} sub={f.sub} tone={f.tone} size={g.size} reason={f.reason} /> : null)}
            </div>
          );
        })}
      </div>
      {template === "six-chart" && chart}
    </div>
  );
}

/** Dots for the ride pages, with the page's name, and ‹ › to step through them. */
export function PageDots({ names, page, onPage }: { names: string[]; page: number; onPage?: (step: 1 | -1) => void }) {
  if (names.length < 2) return null;
  const arrow = "inline-flex size-8 items-center justify-center rounded-md text-lg text-muted transition-colors hover:bg-raised hover:text-ink";
  return (
    <div className="flex items-center justify-center gap-3" aria-label="Ride pages">
      {onPage && (
        <button type="button" className={arrow} onClick={() => onPage(-1)} aria-label="Previous page">
          ‹
        </button>
      )}
      <span className="flex items-center gap-1.5" aria-hidden>
        {names.map((n, i) => (
          <span key={i} className={`size-2 rounded-full ${i === page ? "bg-ink" : "bg-control"}`} />
        ))}
      </span>
      <span className="text-sm text-muted">
        {names[page]} · {page + 1} of {names.length}
      </span>
      {onPage && (
        <button type="button" className={arrow} onClick={() => onPage(1)} aria-label="Next page">
          ›
        </button>
      )}
    </div>
  );
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
