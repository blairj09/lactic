"use client";

// The ride field editor (mocks 2 and 3 in lactic/ride-fields): pick a page's layout, tap a field to
// choose what it shows, add pages, and build custom fields with no code. Shows sample numbers,
// never live ones, and only before a ride (review U6). Undo steps back one change, Cancel drops the
// whole edit, Done saves. Free ride and the overlay follow the workout pages until split off (U4).

import { isPhone } from "~/platform/native";
import { useEffect, useMemo, useRef, useState } from "react";
import { Segmented, button, input } from "@/components/ui";
import { remembered } from "@/lib/ble/devices";
import { addPage, deletePage, follow, follows, movePage, pagesOf, renamePage, setSlot, setTemplate, splitOff, standardSets, swapSlots, type RideSets } from "@/lib/ride/field-pages";
import { customLabel, fieldKey, fieldNeeds, showField, unavailableReason, type FieldInputs, type RiderHas } from "@/lib/ride/fields";
import { PAGE_TEMPLATES, type CustomAgg, type FieldRef, type PageTemplate } from "@/lib/sdk/layout";
import type { FieldSetId } from "@/lib/sdk/layout-edit";
import { MetricRegistry } from "@/lib/sdk/metrics";
import { FieldGrid, type Shown } from "./field-grid";

const metrics = new MetricRegistry();

/** The picker's groups (mock 2). Live metrics not listed here (from plugins, later) go under More. */
const GROUPS: { name: string; ids: string[] }[] = [
  { name: "Power", ids: ["power", "power.3s", "power.pct_ftp", "power.wkg", "power.zone", "interval.avg_power"] },
  { name: "Heart", ids: ["heart_rate", "heart_rate.zone", "interval.avg_hr"] },
  { name: "Cadence", ids: ["cadence"] },
  { name: "Workout", ids: ["interval.left", "power.target", "workout.to_go", "ride.elapsed"] },
  { name: "Ride so far", ids: ["so_far.power", "so_far.heart_rate", "so_far.cadence", "so_far.np", "so_far.tss", "so_far.kj", "ride.intensity"] },
];

const TEMPLATES: { id: PageTemplate; name: string; cells: string }[] = [
  { id: "standard", name: "Standard", cells: "grid-cols-[2fr_3fr_1.3fr] [&>i:nth-child(2)]:bg-[var(--zone-2)]" },
  { id: "one", name: "1", cells: "grid-cols-1" },
  { id: "two", name: "2", cells: "grid-cols-1" },
  { id: "four", name: "4", cells: "grid-cols-2" },
  { id: "six", name: "6", cells: "grid-cols-3" },
  { id: "six-chart", name: "6 + chart", cells: "grid-cols-3 [&>i:last-child]:col-span-3 [&>i:last-child]:bg-[var(--zone-2)]" },
  { id: "eight", name: "8", cells: "grid-cols-4" },
  { id: "ten", name: "10", cells: "grid-cols-5" },
];
/** The iPhone's layouts: big enough to read from the saddle on a small screen (mock 2). */
const PHONE_TEMPLATES: PageTemplate[] = ["one", "two", "four", "six"];
const CELLS: Record<PageTemplate, number> = { standard: 3, one: 1, two: 2, four: 4, six: 6, "six-chart": 7, eight: 8, ten: 10 };

const SET_NAMES: Record<FieldSetId, string> = { workout: "Workouts", free: "Free ride", overlay: "Overlay" };

/** Sample numbers for the editor: half an hour ridden, in the second interval, at about FTP. */
function sampleInputs(ftp: number, weightKg: number | null, thresholdHr: number | null): FieldInputs {
  const n = 1800;
  const power = Array.from({ length: n }, (_, i) => (i < 600 ? Math.round(ftp * 0.6) : Math.round(ftp * (0.98 + 0.06 * Math.sin(i / 7)))));
  const heartRate = Array.from({ length: n }, (_, i) => (i < 600 ? 128 : 150 + Math.round((i - 600) / 120)));
  const cadence = Array.from({ length: n }, () => 90);
  const interval = Array.from({ length: n }, (_, i) => (i < 600 ? 0 : 1));
  return { streams: { power, heartRate, cadence, interval }, ftp, weightKg, thresholdHr: thresholdHr ?? 170, power: Math.round(ftp), heartRate: 152, cadence: 91, interval: 1, toGo: 1690, elapsed: n };
}

/** What a field shows in the editor. Interval, power and target read like the ride does. */
function sampleShown(ref: FieldRef, inputs: FieldInputs, ftp: number): Shown {
  if ("metric" in ref) {
    if (ref.metric === "interval.left") return { label: "Interval 2 of 7", value: "7:42", unit: "left" };
    if (ref.metric === "power") return { label: "Power", value: Math.round(ftp), unit: "W", sub: "On target", tone: "positive" };
    if (ref.metric === "power.target") return { label: "Target", value: Math.round(ftp * 1.01), unit: "W" };
  }
  const f = showField(ref, inputs, metrics);
  return { label: f.label, value: f.value ?? undefined, unit: f.unit, reason: f.reason };
}

function riderHas(weightKg: number | null, thresholdHr: number | null): RiderHas {
  return {
    power: !!(remembered("trainer") || remembered("powerMeter")),
    heartRate: !!remembered("heartRate"),
    weight: !!weightKg,
    thresholdHr: !!thresholdHr,
  };
}

export default function FieldEditor({
  initial,
  ftp,
  weightKg,
  thresholdHr,
  chart,
  saving,
  onCancel,
  onDone,
  phone = isPhone(),
}: {
  initial: RideSets;
  ftp: number;
  weightKg: number | null;
  thresholdHr: number | null;
  /** The workout chart, drawn where a page has one. */
  chart: React.ReactNode;
  saving: boolean;
  onCancel: () => void;
  /** Saves; `keepCopy` when Reset was used, so the layout from before it is kept as a saved copy. */
  onDone: (ride: RideSets, keepCopy: boolean) => void;
  /** The iPhone's layouts only (1, 2, 4, 6), plus the page's own if it came from the computer. */
  phone?: boolean;
}) {
  const [draft, setDraft] = useState<RideSets>(initial);
  const [history, setHistory] = useState<{ ride: RideSets; page: number }[]>([]);
  const [set, setSet] = useState<FieldSetId>("workout");
  const [page, setPage] = useState(0);
  // On the iPhone nothing is picked until a field is tapped, which opens the picker as a sheet.
  const [slot, setSlotIndex] = useState<number | null>(phone ? null : 0);
  const [query, setQuery] = useState("");
  const [custom, setCustom] = useState(false);
  const [wasReset, setWasReset] = useState(false);
  const [dragging, setDragging] = useState<number | null>(null);
  const inputs = useMemo(() => sampleInputs(ftp, weightKg, thresholdHr), [ftp, weightKg, thresholdHr]);
  const has = useMemo(() => riderHas(weightKg, thresholdHr), [weightKg, thresholdHr]);

  const following = follows(draft, set);
  const pages = pagesOf(draft, set);
  const current = pages[Math.min(page, pages.length - 1)];
  const pageIndex = pages.indexOf(current);
  const slots = PAGE_TEMPLATES[current.template];
  const shown = Array.from({ length: slots }, (_, i) => (current.fields[i] ? sampleShown(current.fields[i], inputs, ftp) : undefined));
  const selected = slot !== null && slot < slots ? slot : null;

  /** Applies a change, keeping the step before it for Undo. */
  const change = (next: RideSets, nextPage = pageIndex) => {
    if (next === draft) return;
    setHistory((h) => [...h, { ride: draft, page: pageIndex }]);
    setDraft(next);
    setPage(nextPage);
  };
  const undo = () => {
    const last = history.at(-1);
    if (!last) return;
    setHistory((h) => h.slice(0, -1));
    setDraft(last.ride);
    setPage(last.page);
  };

  const choose = (field: FieldRef) => {
    if (selected === null || following) return;
    change(setSlot(draft, set, pageIndex, selected, field));
    // Move on to the next empty slot, as filling a new page goes field by field.
    const filled = Math.min(selected, current.fields.length) + 1;
    setSlotIndex(phone ? null : filled < slots ? filled : selected);
  };

  // The rider's own custom fields, wherever they are, to reuse on other pages.
  const customs = useMemo(() => {
    const seen = new Map<string, FieldRef>();
    for (const s of ["workout", "free", "overlay"] as const) for (const p of pagesOf(draft, s)) for (const f of p.fields) if ("custom" in f) seen.set(fieldKey(f), f);
    return [...seen.values()];
  }, [draft]);

  const q = query.trim().toLowerCase();
  const match = (label: string) => !q || label.toLowerCase().includes(q);
  const listed = new Set(GROUPS.flatMap((g) => g.ids));
  const more = metrics.forScope("live").filter((d) => !listed.has(d.id));
  const groups = [...GROUPS, ...(more.length ? [{ name: "More", ids: more.map((d) => d.id) }] : [])];
  const selectedKey = selected !== null && current.fields[selected] ? fieldKey(current.fields[selected]) : null;

  const option = (ref: FieldRef, label: string, hint: string) => {
    const reason = unavailableReason(fieldNeeds(ref, metrics), has);
    const on = selectedKey === fieldKey(ref);
    return (
      <button
        type="button"
        key={fieldKey(ref)}
        disabled={!!reason || selected === null || following}
        onClick={() => choose(ref)}
        aria-pressed={on}
        title={reason ?? undefined}
        className={`flex w-full gap-3 rounded-md px-2 py-1.5 text-left text-sm transition-colors enabled:hover:bg-raised disabled:cursor-not-allowed ${reason ? "flex-col gap-0.5 text-faint" : "items-baseline justify-between"} ${on ? "bg-accent-soft" : ""}`}
      >
        <span className="min-w-0 truncate">{label}</span>
        <span className={`text-xs ${reason ? "text-warning" : "shrink-0 text-faint"}`}>{reason ?? hint}</span>
      </button>
    );
  };

  const unitHint = (id: string) => {
    const d = metrics.get(id);
    if (!d) return "";
    if (id === "power.3s") return "3s · W";
    return d.unit === "s" ? "m:ss" : d.unit === "tss" ? "TSS" : id.endsWith("zone") ? "Z1–Z7" : d.unit;
  };

  // On the iPhone the editor replaces the player further down the page: start at its top.
  const top = useRef<HTMLElement>(null);
  useEffect(() => {
    if (phone) top.current?.scrollIntoView({ block: "start" });
  }, [phone]);

  // Layout and the field list: beside the page on a computer, a sheet from the bottom on the iPhone.
  const picker = (
    <div className={following ? "pointer-events-none space-y-5 opacity-50" : "space-y-5"}>
      <div className="space-y-2">
        <h3 className="text-sm font-semibold">Layout</h3>
        <div className="grid grid-cols-4 gap-1.5">
          {TEMPLATES.filter((t) => !phone || PHONE_TEMPLATES.includes(t.id) || t.id === current.template).map((t) => (
            <button
              type="button"
              key={t.id}
              aria-pressed={current.template === t.id}
              onClick={() => change(setTemplate(draft, set, pageIndex, t.id))}
              className={`rounded-md border p-1.5 text-center text-xs ${current.template === t.id ? "border-accent bg-accent-soft text-ink" : "border-line text-muted hover:text-ink"}`}
            >
              <span className={`mb-1 grid h-7 gap-0.5 ${t.cells}`} aria-hidden>
                {Array.from({ length: CELLS[t.id] }, (_, i) => (
                  <i key={i} className={`rounded-[2px] ${current.template === t.id ? "bg-[var(--zone-4)]" : "bg-control"}`} />
                ))}
              </span>
              {t.name}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-2">
        <h3 className="text-sm font-semibold">{selected === null ? "Pick a field to change" : `Field ${selected + 1} shows`}</h3>
        <input className={`${input} w-full`} placeholder="Search fields" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search fields" />
        <div className="max-h-[26rem] space-y-3 overflow-y-auto pr-1">
          {groups.map((g) => {
            const items = g.ids.map((id) => metrics.get(id)).filter((d) => d && match(d.label));
            if (!items.length) return null;
            return (
              <div key={g.name}>
                <div className="px-2 pb-1 text-xs font-semibold tracking-wide text-muted uppercase">{g.name}</div>
                {items.map((d) => option({ metric: d!.id }, d!.label, unitHint(d!.id)))}
              </div>
            );
          })}
          {customs.some((c) => "custom" in c && match(c.custom.label)) && (
            <div>
              <div className="px-2 pb-1 text-xs font-semibold tracking-wide text-muted uppercase">Your custom fields</div>
              {customs.map((c) => ("custom" in c && match(c.custom.label) ? option(c, c.custom.label, "Custom") : null))}
            </div>
          )}
        </div>
        <button type="button" className={`${button.secondary} w-full`} disabled={selected === null} onClick={() => setCustom(true)}>
          + New custom field
        </button>
      </div>
    </div>
  );

  return (
    <section ref={top} aria-label="Customize ride fields" className="space-y-5 scroll-mt-12">
      {phone ? (
        <div className="sticky top-12 z-20 -mx-4 flex items-center gap-2 border-b border-line bg-surface px-4 py-2">
          <button type="button" className="h-9 text-sm text-accent" onClick={onCancel} disabled={saving}>
            Cancel
          </button>
          <button type="button" className="h-9 px-2 text-accent disabled:text-faint" onClick={undo} disabled={!history.length} aria-label="Undo">
            ↶
          </button>
          <span className="flex-1 text-center text-sm font-medium">
            Page {pageIndex + 1} of {pages.length}
          </span>
          <button type="button" className={button.smallPrimary} onClick={() => onDone(draft, wasReset)} disabled={saving}>
            {saving ? "Saving…" : "Done"}
          </button>
        </div>
      ) : (
        <div className="sticky top-14 z-20 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg bg-accent-soft px-4 py-2.5 shadow-[0_0_0_6px_var(--ground)]">
          <span className="font-semibold">Customizing ride fields</span>
          <span className="text-sm text-muted">Sample numbers</span>
          <div className="ml-auto flex items-center gap-2">
            <button type="button" className={button.ghost} onClick={undo} disabled={!history.length}>
              ↶ Undo
            </button>
            <button type="button" className={button.secondary} onClick={onCancel} disabled={saving}>
              Cancel
            </button>
            <button type="button" className={button.primary} onClick={() => onDone(draft, wasReset)} disabled={saving}>
              {saving ? "Saving…" : "Done"}
            </button>
          </div>
        </div>
      )}

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="space-y-5 rounded-lg bg-surface p-5 sm:p-6">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <input
              aria-label="Page name"
              className={`${input} max-w-56 text-base font-semibold`}
              value={current.name}
              maxLength={24}
              disabled={following}
              onChange={(e) => change(renamePage(draft, set, pageIndex, e.target.value))}
            />
            <div className="ml-auto flex items-center gap-1">
              <button type="button" className={button.small} disabled={following || pageIndex === 0} onClick={() => change(movePage(draft, set, pageIndex, -1), pageIndex - 1)} aria-label="Move page earlier">
                ←
              </button>
              <button type="button" className={button.small} disabled={following || pageIndex === pages.length - 1} onClick={() => change(movePage(draft, set, pageIndex, 1), pageIndex + 1)} aria-label="Move page later">
                →
              </button>
              <button type="button" className={button.small} disabled={following || pages.length < 2} onClick={() => change(deletePage(draft, set, pageIndex), Math.max(0, pageIndex - 1))}>
                Delete page
              </button>
            </div>
          </div>

          <div className={following ? "pointer-events-none opacity-50" : undefined}>
            <FieldGrid
              template={current.template}
              shown={shown}
              slots={slots}
              chart={<div className="min-w-0">{chart}</div>}
              slot={(i, node) => {
                const filled = !!current.fields[i];
                const on = selected === i;
                return (
                  <div
                    className={`relative w-full rounded-md outline-offset-4 ${on ? "outline-2 outline-accent" : "outline-1 outline-dashed outline-control"} ${dragging !== null && dragging !== i ? "hover:bg-raised" : ""}`}
                    draggable={filled}
                    onDragStart={() => setDragging(i)}
                    onDragEnd={() => setDragging(null)}
                    onDragOver={(e) => filled && dragging !== null && e.preventDefault()}
                    onDrop={() => {
                      if (dragging !== null) change(swapSlots(draft, set, pageIndex, dragging, i));
                      setDragging(null);
                      setSlotIndex(i);
                    }}
                  >
                    <button type="button" className={`block w-full min-w-0 cursor-pointer text-left ${current.template === "standard" && i >= 5 ? "lg:flex lg:items-baseline lg:justify-between lg:gap-4" : ""}`} onClick={() => setSlotIndex(i)} aria-label={filled ? `Field ${i + 1}: ${shown[i]?.label}. Choose what it shows` : `Field ${i + 1}: empty. Choose what it shows`}>
                      {filled ? node : <span className="flex h-16 items-center text-sm text-muted">+ Add field</span>}
                    </button>
                    {filled && on && (
                      <span className="absolute -top-3 right-0 flex gap-1">
                        {i > 0 && current.fields[i - 1] && (
                          <button type="button" className="size-6 rounded-full border border-line bg-surface text-xs text-muted hover:text-ink" onClick={() => (change(swapSlots(draft, set, pageIndex, i, i - 1)), setSlotIndex(i - 1))} aria-label="Move field earlier">
                            ←
                          </button>
                        )}
                        {current.fields[i + 1] && (
                          <button type="button" className="size-6 rounded-full border border-line bg-surface text-xs text-muted hover:text-ink" onClick={() => (change(swapSlots(draft, set, pageIndex, i, i + 1)), setSlotIndex(i + 1))} aria-label="Move field later">
                            →
                          </button>
                        )}
                        <button type="button" className="size-6 rounded-full border border-line bg-surface text-xs text-muted hover:text-ink" onClick={() => change(setSlot(draft, set, pageIndex, i, null))} aria-label="Remove field">
                          ×
                        </button>
                      </span>
                    )}
                  </div>
                );
              }}
            />
          </div>

          <div className="flex flex-wrap items-center justify-center gap-2">
            {pages.map((p, i) => (
              <button
                type="button"
                key={i}
                onClick={() => (setPage(i), setSlotIndex(0))}
                className={`h-8 rounded-full px-3 text-sm ${i === pageIndex ? "bg-primary text-on-primary" : "bg-raised text-muted hover:text-ink"}`}
              >
                {i + 1} · {p.name}
              </button>
            ))}
            {!following && pages.length < 8 && (
              <button type="button" className="h-8 rounded-full border border-dashed border-control px-3 text-sm text-muted hover:text-ink" onClick={() => (change(addPage(draft, set), pages.length), setSlotIndex(0))}>
                + Page
              </button>
            )}
          </div>
          <p className="text-center text-sm text-muted">{phone ? "Tap a field to change it. While riding, swipe to change page." : "While riding, ← → or a swipe changes page. Drag a field onto another to swap them."}</p>
        </div>

        <div className="space-y-5 rounded-lg bg-surface p-5">
          <div className="space-y-2">
            <h3 className="text-sm font-semibold">Fields for</h3>
            <Segmented fill label="Fields for" options={(phone ? (["workout", "free"] as const) : (["workout", "free", "overlay"] as const)).map((s) => ({ value: s, label: SET_NAMES[s] }))} value={set} onChange={(s) => (setSet(s), setPage(0), setSlotIndex(0))} />
            {set !== "workout" &&
              (following ? (
                <p className="text-sm text-muted">
                  {SET_NAMES[set]} uses your workout pages.{" "}
                  <button type="button" className="text-ink underline underline-offset-2" onClick={() => change(splitOff(draft, set), 0)}>
                    Set up {set === "free" ? "free ride" : "the overlay"} separately
                  </button>
                </p>
              ) : (
                <p className="text-sm text-muted">
                  {SET_NAMES[set]} has its own pages.{" "}
                  <button type="button" className="text-ink underline underline-offset-2" onClick={() => change(follow(draft, set), 0)}>
                    Use the workout pages again
                  </button>
                </p>
              ))}
          </div>
          {!phone && picker}
          <div className="space-y-1 border-t border-rule pt-3 text-sm text-muted">
            <button
              type="button"
              className="text-ink underline underline-offset-2"
              onClick={() => {
                change(standardSets(), 0);
                setSet("workout");
                setSlotIndex(0);
                setWasReset(true);
              }}
            >
              Reset to Lactic standard
            </button>{" "}
            <span>(your layout is kept as a saved copy)</span>
          </div>
        </div>
      </div>

      {phone && selected !== null && !custom && (
        <div className="fixed inset-0 z-40 flex items-end bg-black/35" onClick={() => setSlotIndex(null)}>
          <div
            role="dialog"
            aria-modal="true"
            aria-label={`Field ${selected + 1}`}
            className="max-h-[70vh] w-full overflow-y-auto rounded-t-2xl bg-surface px-4 pt-2 pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mx-auto mb-3 h-1.5 w-9 rounded-full bg-control" />
            {picker}
          </div>
        </div>
      )}

      {custom && (
        <CustomFieldDialog
          inputs={inputs}
          has={has}
          onCancel={() => setCustom(false)}
          onAdd={(f) => {
            setCustom(false);
            choose(f);
          }}
        />
      )}
    </section>
  );
}

const MEASURES = [
  { id: "power", name: "Power" },
  { id: "heart_rate", name: "Heart rate" },
  { id: "cadence", name: "Cadence" },
] as const;

/** The time spans on offer: rolling windows in seconds, then the interval and ride averages. */
const OVER: { name: string; agg: CustomAgg; window: number }[] = [
  { name: "Now", agg: "avg", window: 0 },
  { name: "3 s", agg: "avg", window: 3 },
  { name: "10 s", agg: "avg", window: 10 },
  { name: "30 s", agg: "avg", window: 30 },
  { name: "1 min", agg: "avg", window: 60 },
  { name: "5 min", agg: "avg", window: 300 },
  { name: "This interval", agg: "lap-avg", window: 0 },
  { name: "Last interval", agg: "last-lap-avg", window: 0 },
  { name: "Whole ride", agg: "ride-avg", window: 0 },
];

/** Best efforts: the highest average over any stretch of this many seconds so far in the ride. */
const BEST = [5, 15, 30, 60, 300, 1200];
const span = (s: number) => (s >= 60 && s % 60 === 0 ? `${s / 60} min` : `${s} s`);

type Show = "units" | "ftp" | "wkg" | "zone";

/** Mock 3: a custom field from a measure, a time span and how to show it. */
function CustomFieldDialog({ inputs, has, onCancel, onAdd }: { inputs: FieldInputs; has: RiderHas; onCancel: () => void; onAdd: (f: FieldRef) => void }) {
  const [measure, setMeasure] = useState<(typeof MEASURES)[number]["id"]>("power");
  const [kind, setKind] = useState<"avg" | "best">("avg");
  const [over, setOver] = useState(2);
  /** Seconds for a best effort; any whole number from 1 to 3600 (the layout's limit). */
  const [best, setBest] = useState(15);
  const [bestText, setBestText] = useState<string | null>(null);
  const [show, setShow] = useState<Show>("units");
  const [name, setName] = useState<string | null>(null);
  const chosen = kind === "best" ? { agg: "max" as const, window: best } : OVER[over];
  const shownAs = measure === "power" ? show : "units";
  const base = { metric: measure, window: chosen.window, agg: chosen.agg, ...(shownAs === "ftp" ? { asPercentOf: "ftp" as const } : {}), ...(shownAs === "wkg" || shownAs === "zone" ? { as: shownAs } : {}) };
  const auto = customLabel(base);
  const label = (name ?? auto).trim().slice(0, 24) || auto;
  const field: FieldRef = { custom: { ...base, label } };
  const preview = showField(field, inputs, metrics);
  const reason = unavailableReason(fieldNeeds(field, metrics), has);
  const chip = (on: boolean) => `h-8 rounded-md px-3 text-sm transition-colors ${on ? "bg-primary text-on-primary" : "bg-raised text-ink hover:bg-active"}`;

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 px-4" onClick={(e) => e.target === e.currentTarget && onCancel()} onKeyDown={(e) => e.key === "Escape" && onCancel()}>
      <div role="dialog" aria-modal="true" aria-label="New custom field" className="w-full max-w-xl space-y-5 rounded-xl bg-surface p-6 shadow-2xl">
        <div>
          <h3 className="text-lg font-semibold">New custom field</h3>
          <p className="text-sm text-muted">Pick what to measure, over how long, and how to show it.</p>
        </div>
        <div className="space-y-2">
          <div className="text-sm text-muted">Measure</div>
          <div className="flex flex-wrap gap-1.5">
            {MEASURES.map((m) => (
              <button type="button" key={m.id} className={chip(measure === m.id)} onClick={() => setMeasure(m.id)}>
                {m.name}
              </button>
            ))}
          </div>
        </div>
        <div className="space-y-2">
          <Segmented
            label="Kind of number"
            options={[
              { value: "avg", label: "Average" },
              { value: "best", label: "Best so far" },
            ]}
            value={kind}
            onChange={setKind}
          />
          {kind === "avg" ? (
            <>
              <div className="pt-1 text-sm text-muted">Over</div>
              <div className="flex flex-wrap gap-1.5">
                {OVER.map((o, i) => (
                  <button type="button" key={o.name} className={chip(over === i)} onClick={() => setOver(i)}>
                    {o.name}
                  </button>
                ))}
              </div>
            </>
          ) : (
            <>
              <div className="pt-1 text-sm text-muted">Your best average over any stretch of</div>
              <div className="flex flex-wrap items-center gap-1.5">
                {BEST.map((s) => (
                  <button type="button" key={s} className={chip(best === s && bestText === null)} onClick={() => (setBest(s), setBestText(null))}>
                    {span(s)}
                  </button>
                ))}
                <label className="flex items-center gap-1.5 text-sm text-muted">
                  <input
                    className={`${input} w-20`}
                    inputMode="numeric"
                    placeholder="Other"
                    aria-label="Other duration in seconds"
                    value={bestText ?? ""}
                    onChange={(e) => {
                      const text = e.target.value.replace(/[^0-9]/g, "").slice(0, 4);
                      setBestText(text);
                      const n = Number(text);
                      if (n >= 1 && n <= 3600) setBest(n);
                    }}
                  />
                  seconds
                </label>
              </div>
            </>
          )}
        </div>
        {measure === "power" && (
          <div className="space-y-2">
            <div className="text-sm text-muted">Show as</div>
            <div className="flex flex-wrap gap-1.5">
              {(
                [
                  ["units", "Watts"],
                  ["ftp", "% of FTP"],
                  ["wkg", "W/kg"],
                  ["zone", "Zone"],
                ] as const
              ).map(([id, n]) => (
                <button type="button" key={id} className={chip(show === id)} onClick={() => setShow(id)}>
                  {n}
                </button>
              ))}
            </div>
          </div>
        )}
        <label className="block space-y-2">
          <span className="text-sm text-muted">Name</span>
          <input className={`${input} w-full`} value={name ?? auto} maxLength={24} onChange={(e) => setName(e.target.value)} />
        </label>
        <div className="flex items-end justify-between gap-4 rounded-lg bg-ground px-4 py-3">
          <div className="min-w-0">
            <div className="truncate text-sm text-muted">{label}</div>
            <div className="num text-5xl leading-[1.1] font-medium tracking-tight">
              {preview.value ?? <span className="text-2xl text-faint">–</span>}
              {preview.unit && preview.value !== null && <span className="ml-1.5 text-base font-normal tracking-normal text-muted">{preview.unit}</span>}
            </div>
          </div>
          <span className="text-right text-sm text-faint">{reason ?? `Sample, at FTP ${inputs.ftp} W`}</span>
        </div>
        <div className="flex justify-end gap-2">
          <button type="button" className={button.secondary} onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className={button.primary} onClick={() => onAdd(field)}>
            Add field
          </button>
        </div>
      </div>
    </div>
  );
}

