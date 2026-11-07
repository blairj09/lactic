"use client";

import {
  compareRange,
  matchingPreset,
  presetRange,
  RANGE_PRESETS,
  zoomRange,
  type CompareMode,
  type DateRange,
} from "@/lib/engine/analysis";

/**
 * The date range every chart below it shows: presets, a custom from/to, zoom out and in, and
 * optionally a second range to compare against. Controlled; `today` and `earliest` bound it.
 */
export default function RangePicker({
  range,
  onChange,
  today,
  earliest,
  compare,
  onCompareChange,
}: {
  range: DateRange;
  onChange: (range: DateRange) => void;
  today: string;
  earliest: string;
  /** Leave out `onCompareChange` to hide the compare control. */
  compare?: CompareMode | null;
  onCompareChange?: (mode: CompareMode | null) => void;
}) {
  const bounds = { from: earliest < today ? earliest : today, to: today };
  const active = matchingPreset(range, today, earliest);
  const compared = compare ? compareRange(range, compare) : null;
  const field = "num h-8 rounded-md border border-control bg-surface px-2 text-sm text-ink";
  const segment =
    "h-8 rounded px-2.5 text-sm text-muted transition-colors hover:text-ink aria-pressed:bg-surface aria-pressed:font-medium aria-pressed:text-ink aria-pressed:shadow-[0_0_0_1px_var(--line)]";

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <div role="group" aria-label="Date range" className="flex gap-0.5 rounded-md bg-raised p-0.5">
        {RANGE_PRESETS.map((p) => (
          <button key={p.key} type="button" aria-pressed={active === p.key} className={segment} onClick={() => onChange(presetRange(p.key, today, earliest))}>
            {p.label}
          </button>
        ))}
      </div>

      <div className="flex items-center gap-1.5 text-sm">
        <input
          type="date"
          aria-label="From"
          className={field}
          value={range.from}
          min={bounds.from}
          max={range.to}
          onChange={(e) => e.target.value && onChange({ from: e.target.value, to: range.to })}
        />
        <span className="text-muted">to</span>
        <input
          type="date"
          aria-label="To"
          className={field}
          value={range.to}
          min={range.from}
          max={bounds.to}
          onChange={(e) => e.target.value && onChange({ from: range.from, to: e.target.value })}
        />
      </div>

      <div className="flex gap-0.5 rounded-md bg-raised p-0.5">
        <button type="button" className={segment} aria-label="Zoom out" title="Zoom out" onClick={() => onChange(zoomRange(range, 2, bounds))}>
          −
        </button>
        <button type="button" className={segment} aria-label="Zoom in" title="Zoom in" onClick={() => onChange(zoomRange(range, 0.5, bounds))}>
          +
        </button>
      </div>

      {onCompareChange && (
        <label className="flex items-center gap-1.5 text-sm">
          <span className="text-muted">Compare to</span>
          <select className={field} value={compare ?? ""} onChange={(e) => onCompareChange((e.target.value || null) as CompareMode | null)}>
            <option value="">Nothing</option>
            <option value="previous">Previous period</option>
            <option value="lastYear">Same dates last year</option>
          </select>
        </label>
      )}
      {compared && <span className="text-sm text-muted tabular-nums">{formatRange(compared)}</span>}
    </div>
  );
}

export function formatRange({ from, to }: DateRange): string {
  const sameYear = from.slice(0, 4) === to.slice(0, 4);
  const f = (d: string, year: boolean) =>
    new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: year ? "numeric" : undefined, timeZone: "UTC" });
  return `${f(from, !sameYear)} – ${f(to, true)}`;
}
