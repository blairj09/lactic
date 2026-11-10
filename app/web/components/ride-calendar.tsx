"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import RideTable from "@/components/ride-table";
import { button, Dash, input, Segmented } from "@/components/ui";
import { ZONE_LABELS, ZONES, type Zone } from "@/lib/engine/library";
import {
  filterRides,
  filtering,
  monthWeeks,
  NO_FILTERS,
  rideTotals,
  shiftMonth,
  zoneStep,
  type CalendarRide,
  type RideFilters,
  type RideSetting,
} from "@/lib/engine/ride-calendar";
import { formatDuration, SOURCE_LABEL } from "@/lib/format";
import Select from "@/components/select";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const sourceLabel = (s: string) => SOURCE_LABEL[s] ?? s;
const monthName = (month: string) => new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${month}-01T00:00:00Z`));
const dayLabel = (date: string) => new Intl.DateTimeFormat("en-US", { weekday: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${date}T00:00:00Z`));
const zoneColor = (zone: Zone | null) => (zone ? `var(--zone-${zoneStep(zone)})` : "var(--zone-free)");
const typeLabel = (r: CalendarRide) => (r.zone ? `${ZONE_LABELS[r.zone]}${r.zoneEstimated ? " (est.)" : ""}` : null);
const stress = (r: CalendarRide) => (r.trainingStress !== null ? `${Math.round(r.trainingStress)} TSS` : null);

/** Rides on Progress: a month calendar (a day list on a phone) or the full list, with search and filters. */
export default function RideCalendar({ rides, timeZone, today }: { rides: CalendarRide[]; timeZone: string; today: string }) {
  const [view, setView] = useState<"calendar" | "list">("calendar");
  const [month, setMonth] = useState(today.slice(0, 7));
  const [filters, setFilters] = useState<RideFilters>(NO_FILTERS);
  const set = (patch: Partial<RideFilters>) => setFilters((f) => ({ ...f, ...patch }));

  const shown = useMemo(() => filterRides(rides, filters, sourceLabel), [rides, filters]);
  const sources = useMemo(() => [...new Set(rides.map((r) => r.source))].sort((a, b) => sourceLabel(a).localeCompare(sourceLabel(b))), [rides]);
  const zones = useMemo(() => ZONES.filter((z) => rides.some((r) => r.zone === z)), [rides]);
  const hasOutdoor = rides.some((r) => r.setting === "outdoor");
  const active = filtering(filters);
  const counted = rides.filter((r) => !r.duplicateOf).length;
  // Every month from the first ride to this one, newest first, plus the one on screen.
  const months = useMemo(() => {
    const out = [today.slice(0, 7)];
    const first = rides.reduce((m, r) => (r.date.slice(0, 7) < m ? r.date.slice(0, 7) : m), out[0]);
    while (out.at(-1)! > first) out.push(shiftMonth(out.at(-1)!, -1));
    return out.includes(month) ? out : [...out, month].sort().reverse();
  }, [rides, today, month]);

  const byDate = useMemo(() => {
    const map = new Map<string, CalendarRide[]>();
    for (const r of [...shown].sort((a, b) => a.startedAt.localeCompare(b.startedAt))) map.set(r.date, [...(map.get(r.date) ?? []), r]);
    return map;
  }, [shown]);
  const inMonth = shown.filter((r) => r.date.startsWith(month));
  const totals = rideTotals(inMonth);
  // With a filter on and nothing this month, point at the closest month that has a match.
  const nearest = active && !inMonth.length && shown.length ? (shown.find((r) => r.date.slice(0, 7) < month) ?? shown.at(-1)!).date.slice(0, 7) : null;

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
        <input
          type="search"
          value={filters.query}
          onChange={(e) => set({ query: e.target.value })}
          placeholder="Search names and notes"
          aria-label="Search rides"
          className={`${input} w-full lg:w-60`}
        />
        <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center">
          <Select value={filters.source} onChange={(v) => set({ source: v })} aria-label="Source" className={input}>
            <option value="all">All sources</option>
            {sources.map((s) => (
              <option key={s} value={s}>
                {sourceLabel(s)}
              </option>
            ))}
          </Select>
          <Select value={filters.setting} onChange={(v) => set({ setting: v as RideSetting | "all" })} aria-label="Indoor or outdoor" className={input}>
            <option value="all">Indoor/outdoor</option>
            <option value="indoor">Indoor</option>
            <option value="outdoor" disabled={!hasOutdoor}>
              Outdoor
            </option>
          </Select>
          <Select value={filters.zone} onChange={(v) => set({ zone: v as Zone | "all" })} aria-label="Workout type" className={input}>
            <option value="all">All types</option>
            {zones.map((z) => (
              <option key={z} value={z}>
                {ZONE_LABELS[z]}
              </option>
            ))}
          </Select>
          <label className="flex h-9 items-center gap-2 px-1 text-sm text-muted">
            <input type="checkbox" checked={filters.copies} onChange={(e) => set({ copies: e.target.checked })} className="size-4 accent-[var(--accent)]" />
            Show copies
          </label>
        </div>
        <div className="lg:ml-auto">
          <Segmented
            label="View"
            value={view}
            onChange={setView}
            options={[
              { value: "calendar", label: "Calendar" },
              { value: "list", label: "List" },
            ]}
          />
        </div>
      </div>

      {active && (
        <p className="text-sm text-muted">
          <span className="num">{rideTotals(shown).count}</span> of <span className="num">{counted}</span> rides match.{" "}
          <button type="button" onClick={() => setFilters({ ...NO_FILTERS, copies: filters.copies })} className="text-ink underline underline-offset-4">
            Clear
          </button>
        </p>
      )}

      {view === "list" ? (
        shown.length ? (
          <RideTable rides={shown} timeZone={timeZone} />
        ) : (
          <p className="text-sm text-muted">No rides match.</p>
        )
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" aria-label="Previous month" onClick={() => setMonth(shiftMonth(month, -1))} className={`${button.small} w-8 px-0`}>
              ‹
            </button>
            <button type="button" aria-label="Next month" onClick={() => setMonth(shiftMonth(month, 1))} className={`${button.small} w-8 px-0`}>
              ›
            </button>
            <Select value={month} onChange={(v) => setMonth(v)} aria-label="Month" className={`${input} h-8 px-2.5 font-medium`}>
              {months.map((m) => (
                <option key={m} value={m}>
                  {monthName(m)}
                </option>
              ))}
            </Select>
            {month !== today.slice(0, 7) && (
              <button type="button" onClick={() => setMonth(today.slice(0, 7))} className={button.ghost}>
                This month
              </button>
            )}
            <div className="num w-full text-sm text-muted sm:ml-auto sm:w-auto">
              {totals.count} {totals.count === 1 ? "ride" : "rides"}
              {totals.count > 0 && ` · ${formatDuration(totals.durationSeconds)}`}
              {totals.trainingStress !== null && ` · ${Math.round(totals.trainingStress)} TSS`}
            </div>
          </div>

          {nearest && (
            <p className="text-sm text-muted">
              No matches in {monthName(month)}.{" "}
              <button type="button" onClick={() => setMonth(nearest)} className="text-ink underline underline-offset-4">
                Go to {monthName(nearest)}
              </button>
            </p>
          )}

          <MonthGrid month={month} today={today} byDate={byDate} />
          <DayList month={month} today={today} byDate={byDate} empty={!nearest} />
        </>
      )}
    </div>
  );
}

/** sm and up: seven columns, plus each week's totals on wide screens. */
function MonthGrid({ month, today, byDate }: { month: string; today: string; byDate: Map<string, CalendarRide[]> }) {
  const weeks = monthWeeks(month);
  return (
    <div className="hidden gap-px overflow-hidden rounded-md border border-line bg-line sm:grid sm:grid-cols-7 lg:grid-cols-[repeat(7,minmax(0,1fr))_5.5rem]">
      {WEEKDAYS.map((d) => (
        <div key={d} className="bg-surface px-2 py-1.5 text-xs text-muted">
          {d}
        </div>
      ))}
      <div className="hidden bg-surface px-2 py-1.5 text-right text-xs text-muted lg:block">Week</div>
      {weeks.map((week) => {
        const total = rideTotals(week.flatMap((d) => byDate.get(d) ?? []));
        return [
          ...week.map((date) => {
            const outside = !date.startsWith(month);
            return (
              <div key={date} className={`min-h-24 min-w-0 space-y-1 p-1.5 ${outside ? "bg-ground" : "bg-surface"}`}>
                <div className="flex justify-end">
                  <span
                    className={`num inline-flex size-5 items-center justify-center rounded-full text-xs ${
                      date === today ? "bg-primary font-medium text-on-primary" : outside ? "text-faint" : "text-muted"
                    }`}
                  >
                    {Number(date.slice(8))}
                  </span>
                </div>
                {(byDate.get(date) ?? []).map((r) => (
                  <RideChip key={r.id} ride={r} />
                ))}
              </div>
            );
          }),
          <div key={`${week[0]}-total`} className="num hidden space-y-0.5 bg-surface p-2 text-right text-xs text-muted lg:block">
            {total.count > 0 ? (
              <>
                <div className="text-ink">{formatDuration(total.durationSeconds)}</div>
                {total.trainingStress !== null && <div>{Math.round(total.trainingStress)} TSS</div>}
              </>
            ) : (
              <Dash />
            )}
          </div>,
        ];
      })}
    </div>
  );
}

function RideChip({ ride }: { ride: CalendarRide }) {
  const title = [ride.name ?? "Ride", typeLabel(ride), sourceLabel(ride.source), ride.setting, ride.duplicateOf ? "copy, not counted" : null, ride.note || null]
    .filter(Boolean)
    .join(" · ");
  return (
    <Link
      href={`/rides/${ride.id}`}
      title={title}
      className={`block rounded-sm border-l-2 bg-raised px-1.5 py-1 transition-colors hover:bg-active ${ride.duplicateOf ? "text-faint" : ""}`}
      style={{ borderLeftColor: zoneColor(ride.zone) }}
    >
      <div className="truncate text-xs font-medium">{ride.name ?? "Ride"}</div>
      <div className="num truncate text-[11px] text-muted">{[formatDuration(ride.durationSeconds), stress(ride)].filter(Boolean).join(" · ")}</div>
    </Link>
  );
}

/** Phones: the month's ridden days as rows, newest first. */
function DayList({ month, today, byDate, empty }: { month: string; today: string; byDate: Map<string, CalendarRide[]>; empty: boolean }) {
  const days = [...byDate.keys()].filter((d) => d.startsWith(month)).sort().reverse();
  if (!days.length) return empty ? <p className="text-sm text-muted sm:hidden">No rides in {monthName(month)}.</p> : null;
  return (
    <div className="divide-y divide-rule overflow-hidden rounded-md border border-line sm:hidden">
      {days.map((date) => (
        <div key={date} className={`flex gap-3 bg-surface p-3 ${date === today ? "shadow-[inset_2px_0_0_var(--accent)]" : ""}`}>
          <div className="num w-14 flex-none pt-0.5 text-sm text-muted">{dayLabel(date)}</div>
          <div className="min-w-0 flex-1 space-y-2">
            {byDate.get(date)!.map((r) => (
              <Link key={r.id} href={`/rides/${r.id}`} className={`block border-l-2 pl-2 ${r.duplicateOf ? "text-faint" : ""}`} style={{ borderLeftColor: zoneColor(r.zone) }}>
                <div className="truncate text-sm font-medium">{r.name ?? "Ride"}</div>
                <div className="num truncate text-xs text-muted">
                  {[formatDuration(r.durationSeconds), stress(r), typeLabel(r), r.duplicateOf ? "copy" : sourceLabel(r.source)].filter(Boolean).join(" · ")}
                </div>
                {r.note && <div className="truncate text-xs text-faint">“{r.note}”</div>}
              </Link>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
