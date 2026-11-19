"use client";

// The ride field editor (lactic/ride-fields, reworked in lactic/field-picker): pick a page's layout,
// click a field to choose what it shows in a picker beside it, add pages, and build custom fields with no code. Shows sample numbers,
// never live ones, and only before a ride (review U6). Undo steps back one change, Cancel drops the
// whole edit, Done saves. The overlay follows the workout pages until split off (U4); free ride has its own.

import { isPhone } from "~/platform/native";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { MoreMenu } from "@/components/more-menu";
import { Segmented, button, input } from "@/components/ui";
import { remembered } from "@/lib/ble/devices";
import { addPage, canWiden, deletePage, follow, follows, movePage, pagesOf, renamePage, setOption, setSlot, setTemplate, setWide, splitOff, standardSets, swapSlots, type RideSets } from "@/lib/ride/field-pages";
import { customLabel, fieldKey, fieldNeeds, showField, unavailableReason, type FieldInputs, type RiderHas } from "@/lib/ride/fields";
import { canBeWide, pageSlots, type CustomAgg, type FieldRef, type PageTemplate } from "@/lib/sdk/layout";
import type { FieldSetId } from "@/lib/sdk/layout-edit";
import { MetricRegistry } from "@/lib/sdk/metrics";
import { isPluginFieldId, resolveOptions, toggleChoice, type PluginFieldOption } from "@/lib/sdk/plugin-fields";
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
function sampleShown(ref: FieldRef, inputs: FieldInputs, ftp: number, plugins: readonly PluginFieldOption[]): Shown {
  if ("metric" in ref) {
    // A plugin field runs only while riding; here it shows its name and the plugin mark.
    if (isPluginFieldId(ref.metric)) return { label: plugins.find((p) => p.id === ref.metric)?.title ?? "Plugin field", value: undefined, unit: "", plugin: true };
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
  pluginFields = [],
  initialSet = "workout",
}: {
  initial: RideSets;
  /** The set it opens on: the one the ride picked would use. */
  initialSet?: FieldSetId;
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
  /** Fields from the rider's plugins. */
  pluginFields?: readonly PluginFieldOption[];
}) {
  const [draft, setDraft] = useState<RideSets>(initial);
  const [history, setHistory] = useState<{ ride: RideSets; page: number }[]>([]);
  const [set, setSet] = useState<FieldSetId>(initialSet);
  const [page, setPage] = useState(0);
  // The field being filled. Nothing until a field is clicked, which opens the picker beside it.
  const [slot, setSlotIndex] = useState<number | null>(null);
  const [custom, setCustom] = useState(false);
  const [wasReset, setWasReset] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [dragging, setDragging] = useState<number | null>(null);
  const inputs = useMemo(() => sampleInputs(ftp, weightKg, thresholdHr), [ftp, weightKg, thresholdHr]);
  const has = useMemo(() => riderHas(weightKg, thresholdHr), [weightKg, thresholdHr]);
  const slotEls = useRef<(HTMLDivElement | null)[]>([]);

  const following = follows(draft, set);
  const pages = pagesOf(draft, set);
  const current = pages[Math.min(page, pages.length - 1)];
  const pageIndex = pages.indexOf(current);
  const slots = pageSlots(current);
  const shown = Array.from({ length: slots }, (_, i) => {
    const ref = current.fields[i];
    if (!ref) return undefined;
    const f = sampleShown(ref, inputs, ftp, pluginFields);
    return ref.wide ? { ...f, wide: true } : f;
  });
  const selected = slot !== null && slot < slots && !following && !custom ? slot : null;

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
  const goPage = (i: number) => {
    setPage(i);
    setSlotIndex(null);
    setRenaming(false);
  };

  /** Fills the open field and closes the picker. */
  const choose = (field: FieldRef) => {
    if (selected === null && !custom) return;
    const at = custom ? slot : selected;
    if (at === null) return;
    change(setSlot(draft, set, pageIndex, at, field));
    setSlotIndex(null);
  };
  /** Tab in the picker: the next field (or the one before), wrapping round the page. */
  const step = (by: 1 | -1) => setSlotIndex((s) => (s === null ? 0 : (s + by + slots) % slots));

  // The rider's own custom fields, wherever they are, to reuse on other pages.
  const customs = useMemo(() => {
    const seen = new Map<string, FieldRef>();
    for (const s of ["workout", "free", "overlay"] as const) for (const p of pagesOf(draft, s)) for (const f of p.fields) if ("custom" in f) seen.set(fieldKey(f), f);
    return [...seen.values()];
  }, [draft]);

  // On the iPhone the editor replaces the player further down the page: start at its top.
  const top = useRef<HTMLElement>(null);
  useEffect(() => {
    if (phone) top.current?.scrollIntoView({ block: "start" });
  }, [phone]);
  // On the iPhone the picker is a sheet over the lower part of the screen: keep the field above it.
  useEffect(() => {
    if (phone && selected !== null) slotEls.current[selected]?.scrollIntoView({ block: "start", behavior: "smooth" });
  }, [phone, selected]);

  const selectedRef = selected !== null ? current.fields[selected] : undefined;
  const selectedPlugin = selectedRef && "metric" in selectedRef ? pluginFields.find((p) => p.id === selectedRef.metric) : undefined;
  const templates = TEMPLATES.filter((t) => !phone || PHONE_TEMPLATES.includes(t.id) || t.id === current.template);
  const moreItems = [
    { label: "Rename page", onSelect: () => setRenaming(true) },
    ...(pageIndex > 0 ? [{ label: "Move page left", onSelect: () => change(movePage(draft, set, pageIndex, -1), pageIndex - 1) }] : []),
    ...(pageIndex < pages.length - 1 ? [{ label: "Move page right", onSelect: () => change(movePage(draft, set, pageIndex, 1), pageIndex + 1) }] : []),
    ...(pages.length > 1 ? [{ label: "Delete page", danger: true, onSelect: () => (change(deletePage(draft, set, pageIndex), Math.max(0, pageIndex - 1)), setSlotIndex(null)) }] : []),
    {
      label: "Reset to Lactic standard",
      onSelect: () => {
        change(standardSets(), 0);
        setSet("workout");
        setSlotIndex(null);
        setWasReset(true);
      },
    },
  ];

  const picker =
    selected !== null ? (
      <FieldPicker
        key={`${set}-${pageIndex}-${selected}`}
        number={selected + 1}
        current={selectedRef}
        currentLabel={shown[selected]?.label}
        phone={phone}
        slots={slots}
        selected={selected}
        template={current.template}
        has={has}
        customs={customs}
        pluginFields={pluginFields}
        onChoose={choose}
        onClose={() => setSlotIndex(null)}
        onStep={step}
        onCustom={() => setCustom(true)}
        onRemove={selectedRef ? () => (change(setSlot(draft, set, pageIndex, selected, null)), setSlotIndex(null)) : undefined}
        onMove={(by) => {
          const to = selected + by;
          if (to < 0 || to >= slots || !current.fields[to]) return;
          change(swapSlots(draft, set, pageIndex, selected, to));
          setSlotIndex(to);
        }}
        canMove={(by) => !!selectedRef && !!current.fields[selected + by]}
        wide={
          selectedRef && canBeWide(current.template)
            ? { on: !!selectedRef.wide, can: !!selectedRef.wide || canWiden(current, selected), set: (on) => change(setWide(draft, set, pageIndex, selected, on)) }
            : undefined
        }
        options={
          selectedPlugin?.options?.length ? (
            <div className="space-y-2">
              {selectedPlugin.options.map((o) => {
                const picked = resolveOptions([o], draft.options?.[selectedPlugin.id])[o.id];
                const max = o.max ?? 1;
                return (
                  <div key={o.id} className="space-y-1.5 rounded-md border border-plugin-line bg-plugin-soft/40 p-2.5">
                    <div className="text-sm font-medium">
                      {o.label}
                      {max > 1 && <span className="font-normal text-muted"> · up to {max}</span>}
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {o.choices.map((c) => {
                        const on = picked.includes(c);
                        return (
                          <button type="button" key={c} className={chip(on)} aria-pressed={on} disabled={!on && max > 1 && picked.length >= max} onClick={() => change(setOption(draft, selectedPlugin.id, o.id, toggleChoice(o, picked, c)))}>
                            {c}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : null
        }
        anchor={() => slotEls.current[selected] ?? null}
      />
    ) : null;

  return (
    <section ref={top} aria-label="Customize ride fields" className={`space-y-4 scroll-mt-12 ${phone && selected !== null ? "pb-[60vh]" : ""}`}>
      {phone ? (
        <div className="sticky top-12 z-20 -mx-4 flex items-center gap-2 border-b border-line bg-surface px-4 py-2">
          <button type="button" className="h-9 text-sm text-accent" onClick={onCancel} disabled={saving}>
            Cancel
          </button>
          <button type="button" className="h-9 px-2 text-accent disabled:text-faint" onClick={undo} disabled={!history.length} aria-label="Undo">
            ↶
          </button>
          <span className="flex-1 text-center text-sm font-medium">Ride fields</span>
          <button type="button" className={button.smallPrimary} onClick={() => onDone(draft, wasReset)} disabled={saving}>
            {saving ? "Saving…" : "Done"}
          </button>
        </div>
      ) : (
        <div className="sticky top-14 z-20 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg bg-accent-soft px-4 py-2.5 shadow-[0_0_0_6px_var(--ground)]">
          <span className="font-semibold">Customize ride fields</span>
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

      <div className="space-y-5 rounded-lg bg-surface p-4 sm:p-5">
        <div className="flex flex-wrap items-center gap-2">
          <Segmented
            label="Fields for"
            options={(phone ? (["workout", "free"] as const) : (["workout", "free", "overlay"] as const)).map((s) => ({ value: s, label: SET_NAMES[s] }))}
            value={set}
            onChange={(s) => (setSet(s), goPage(0))}
          />
          {!following && <LayoutMenu templates={templates} value={current.template} phone={phone} onChange={(t) => (change(setTemplate(draft, set, pageIndex, t)), setSlotIndex(null))} />}
          {!following && (
            <div className="flex flex-wrap items-center gap-1.5 sm:ml-auto">
              {pages.map((p, i) =>
                i === pageIndex && renaming ? (
                  <input
                    key={i}
                    aria-label="Page name"
                    autoFocus
                    className={`${input} h-8 w-36 rounded-full`}
                    defaultValue={p.name}
                    maxLength={24}
                    onFocus={(e) => e.currentTarget.select()}
                    onBlur={(e) => (change(renamePage(draft, set, pageIndex, e.currentTarget.value.trim() || p.name)), setRenaming(false))}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") e.currentTarget.blur();
                      if (e.key === "Escape") setRenaming(false);
                    }}
                  />
                ) : (
                  <button
                    type="button"
                    key={i}
                    onClick={() => goPage(i)}
                    onDoubleClick={() => i === pageIndex && setRenaming(true)}
                    aria-pressed={i === pageIndex}
                    className={`h-8 rounded-full px-3 text-sm ${i === pageIndex ? "bg-primary text-on-primary" : "bg-raised text-muted hover:text-ink"}`}
                  >
                    {i + 1} · {p.name}
                  </button>
                ),
              )}
              {pages.length < 8 && (
                <button type="button" className="h-8 rounded-full border border-dashed border-control px-3 text-sm text-muted hover:text-ink" onClick={() => (change(addPage(draft, set), pages.length), setSlotIndex(null))}>
                  + Page
                </button>
              )}
              <MoreMenu label="More page actions" items={moreItems} align="right" />
            </div>
          )}
        </div>

        {set !== "workout" && (
          <p className="text-sm text-muted">
            {following ? (
              <>
                {SET_NAMES[set]} uses your workout pages.{" "}
                <button type="button" className="text-ink underline underline-offset-2" onClick={() => change(splitOff(draft, set), 0)}>
                  Set up {set === "free" ? "free ride" : "the overlay"} separately
                </button>
              </>
            ) : (
              <>
                {SET_NAMES[set]} has its own pages.{" "}
                <button type="button" className="text-ink underline underline-offset-2" onClick={() => change(follow(draft, set), 0)}>
                  Use the workout pages again
                </button>
              </>
            )}
          </p>
        )}

        <div className={following ? "pointer-events-none opacity-50" : undefined}>
          <FieldGrid
            template={current.template}
            shown={shown}
            slots={slots}
            chart={<div className={`min-w-0 transition-opacity ${selected !== null ? "opacity-35" : ""}`}>{chart}</div>}
            slot={(i, node) => {
              const filled = !!current.fields[i];
              const on = selected === i;
              return (
                <div
                  ref={(el) => {
                    slotEls.current[i] = el;
                  }}
                  className={`relative w-full scroll-mt-28 rounded-md outline-offset-4 transition-opacity ${on ? "bg-accent-soft/40 outline-2 outline-accent" : "outline-1 outline-dashed outline-control"} ${selected !== null && !on ? "opacity-35" : ""} ${dragging !== null && dragging !== i ? "hover:bg-raised" : ""}`}
                  draggable={filled && !phone}
                  onDragStart={() => (setDragging(i), setSlotIndex(null))}
                  onDragEnd={() => setDragging(null)}
                  onDragOver={(e) => filled && dragging !== null && e.preventDefault()}
                  onDrop={() => {
                    if (dragging !== null) change(swapSlots(draft, set, pageIndex, dragging, i));
                    setDragging(null);
                  }}
                >
                  <span className={`absolute -top-3 right-1 z-[1] rounded px-1 text-[11px] leading-4 font-semibold ${on ? "bg-accent text-white" : "bg-surface text-faint"}`} aria-hidden>
                    {i + 1}
                  </span>
                  <button
                    type="button"
                    className={`block w-full min-w-0 cursor-pointer text-left ${current.template === "standard" && i >= 5 ? "lg:flex lg:items-baseline lg:justify-between lg:gap-4" : ""}`}
                    onClick={() => setSlotIndex(on ? null : i)}
                    aria-expanded={on}
                    aria-label={filled ? `Field ${i + 1}: ${shown[i]?.label}. Choose what it shows` : `Field ${i + 1}: empty. Choose what it shows`}
                  >
                    {filled ? node : <span className="flex h-16 items-center text-sm text-muted">+ Add field</span>}
                  </button>
                </div>
              );
            }}
          />
        </div>
        <p className="text-center text-sm text-muted">{phone ? "Tap a field to change it. While riding, swipe to change page." : "Click a field to change it. Drag one onto another to swap."}</p>
      </div>

      {picker}

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

const chip = (on: boolean) => `h-8 shrink-0 whitespace-nowrap rounded-full px-3 text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${on ? "bg-primary text-on-primary" : "bg-raised text-ink enabled:hover:bg-active"}`;

/** The layout button above the page: the current template, opening a small grid of the others. */
function LayoutMenu({ templates, value, phone, onChange }: { templates: typeof TEMPLATES; value: PageTemplate; phone: boolean; onChange: (t: PageTemplate) => void }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !box.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", close);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", close);
    };
  }, [open]);
  const now = TEMPLATES.find((t) => t.id === value) ?? TEMPLATES[0];
  const cells = (t: (typeof TEMPLATES)[number], on: boolean, h: string) => (
    <span className={`grid ${h} gap-0.5 ${t.cells}`} aria-hidden>
      {Array.from({ length: CELLS[t.id] }, (_, i) => (
        <i key={i} className={`rounded-[2px] ${on ? "bg-[var(--zone-4)]" : "bg-control"}`} />
      ))}
    </span>
  );
  return (
    <div ref={box} className="relative">
      <button type="button" className={`${button.small} gap-2`} aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <span className="w-6">{cells(now, true, "h-4")}</span>
        {phone ? `Layout: ${now.name}` : now.name}
        <span className="text-[10px] text-faint">▼</span>
      </button>
      {open && (
        <div role="dialog" aria-label="Layout" className="absolute left-0 z-30 mt-1.5 grid w-72 grid-cols-4 gap-1.5 rounded-lg border border-line bg-surface p-2.5 shadow-xl">
          {templates.map((t) => (
            <button
              type="button"
              key={t.id}
              aria-pressed={value === t.id}
              onClick={() => (onChange(t.id), setOpen(false))}
              className={`rounded-md border p-1.5 text-center text-xs ${value === t.id ? "border-accent bg-accent-soft text-ink" : "border-line text-muted hover:text-ink"}`}
            >
              <span className="mb-1 block">{cells(t, value === t.id, "h-6")}</span>
              {t.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

const FILTERS = ["All", "Power", "Heart", "Workout", "So far", "Plugins"] as const;
type Filter = (typeof FILTERS)[number];
/** Which picker groups each quick filter shows. */
const FILTER_GROUPS: Record<Exclude<Filter, "All" | "Plugins">, string[]> = { Power: ["Power"], Heart: ["Heart"], Workout: ["Workout"], "So far": ["Ride so far"] };

interface Option {
  key: string;
  ref: FieldRef;
  label: string;
  hint: string;
  reason?: string | null;
  plugin?: string;
}

/**
 * Mocks lactic/field-picker: what one field shows. Beside the field on a computer, a sheet on the
 * iPhone. Search is focused on a computer; ↑ ↓ and Enter pick, Tab moves to the next field, Esc closes.
 */
function FieldPicker({
  number,
  current,
  currentLabel,
  phone,
  slots,
  selected,
  template,
  has,
  customs,
  pluginFields,
  options,
  wide,
  onChoose,
  onClose,
  onStep,
  onCustom,
  onRemove,
  onMove,
  canMove,
  anchor,
}: {
  number: number;
  current: FieldRef | undefined;
  currentLabel: string | undefined;
  phone: boolean;
  slots: number;
  selected: number;
  template: PageTemplate;
  has: RiderHas;
  customs: FieldRef[];
  pluginFields: readonly PluginFieldOption[];
  options: React.ReactNode;
  wide?: { on: boolean; can: boolean; set: (on: boolean) => void };
  onChoose: (f: FieldRef) => void;
  onClose: () => void;
  onStep: (by: 1 | -1) => void;
  onCustom: () => void;
  onRemove?: () => void;
  onMove: (by: 1 | -1) => void;
  canMove: (by: 1 | -1) => boolean;
  anchor: () => HTMLElement | null;
}) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("All");
  const [active, setActive] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const [place, setPlace] = useState<{ left: number; top: number; maxHeight: number } | null>(null);
  const currentKey = current ? fieldKey(current) : null;
  const anchorRef = useRef(anchor);
  anchorRef.current = anchor;

  // Beside the field on a computer: to its right if there's room, else its left, else below it.
  useLayoutEffect(() => {
    if (phone) return;
    const at = () => {
      const el = anchorRef.current();
      if (!el) return;
      const r = el.getBoundingClientRect();
      const w = 384;
      const gap = 12;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const h = Math.min(box.current?.offsetHeight ?? 520, vh - 80);
      const right = r.right + gap + w <= vw - 8;
      const leftSide = !right && r.left - gap - w >= 8;
      const left = right ? r.right + gap : leftSide ? r.left - gap - w : Math.min(Math.max(8, r.left), vw - w - 8);
      // No room either side: below the field, or above it when below doesn't fit.
      const beside = right || leftSide;
      const below = r.bottom + gap + h <= vh - 8;
      const want = beside ? r.top : below ? r.bottom + gap : r.top - gap - h;
      const top = Math.max(72, Math.min(want, vh - h - 8));
      setPlace((p) => (p && p.left === left && p.top === top && p.maxHeight === vh - 80 ? p : { left, top, maxHeight: vh - 80 }));
    };
    at();
    window.addEventListener("scroll", at, true);
    window.addEventListener("resize", at);
    return () => {
      window.removeEventListener("scroll", at, true);
      window.removeEventListener("resize", at);
    };
  }, [phone, selected]);

  // Search takes the keys on a computer once the picker is in place (it can't take focus while hidden).
  const focused = useRef(false);
  useEffect(() => {
    if (phone || !place || focused.current) return;
    focused.current = true;
    search.current?.focus({ preventScroll: true });
  }, [phone, place]);

  // Closes on a click outside, except on the fields themselves (that picks another field).
  useEffect(() => {
    const away = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (box.current?.contains(t) || t.closest?.('[aria-label^="Field "]') || t.closest?.('[role="dialog"][aria-label="New custom field"]')) return;
      onClose();
    };
    window.addEventListener("mousedown", away);
    return () => window.removeEventListener("mousedown", away);
  }, [onClose]);

  const q = query.trim().toLowerCase();
  const match = (label: string) => !q || label.toLowerCase().includes(q);
  const listed = new Set(GROUPS.flatMap((g) => g.ids));
  const more = metrics.forScope("live").filter((d) => !listed.has(d.id));
  const groups = [...GROUPS, ...(more.length ? [{ name: "More", ids: more.map((d) => d.id) }] : [])];

  const sections: { name: string; plugin?: boolean; items: Option[] }[] = [];
  const wants = (name: string) => filter === "All" || (filter !== "Plugins" && FILTER_GROUPS[filter].includes(name));
  for (const g of groups) {
    if (!wants(g.name)) continue;
    const items = g.ids
      .map((id) => metrics.get(id))
      .filter((d) => d && match(d.label))
      .map((d) => {
        const ref: FieldRef = { metric: d!.id };
        return { key: fieldKey(ref), ref, label: d!.label, hint: unitHint(d!.id), reason: unavailableReason(fieldNeeds(ref, metrics), has) };
      });
    if (items.length) sections.push({ name: g.name, items });
  }
  if (filter === "All") {
    const items = customs.filter((c) => "custom" in c && match(c.custom.label)).map((c) => ({ key: fieldKey(c), ref: c, label: "custom" in c ? c.custom.label : "", hint: "Custom", reason: unavailableReason(fieldNeeds(c, metrics), has) }));
    if (items.length) sections.push({ name: "Your custom fields", items });
  }
  if (filter === "All" || filter === "Plugins") {
    const items = pluginFields.filter((p) => match(p.title)).map((p) => ({ key: p.id, ref: { metric: p.id } as FieldRef, label: p.title, hint: "", reason: p.on ? null : "Plugin is off", plugin: p.pluginName }));
    if (items.length) sections.push({ name: "Plugins", plugin: true, items });
  }
  // The field's current choice first, so it's easy to see what's there now.
  if (currentKey && !q) {
    const at = sections.findIndex((s) => s.items.some((it) => it.key === currentKey));
    if (at > 0) sections.unshift(...sections.splice(at, 1));
    const s = sections[0];
    const i = s?.items.findIndex((it) => it.key === currentKey) ?? -1;
    if (i > 0) s.items.unshift(...s.items.splice(i, 1));
  }
  const pickable = sections.flatMap((s) => s.items).filter((it) => !it.reason);
  const activeKey = pickable[Math.min(active, pickable.length - 1)]?.key;

  useEffect(() => setActive(0), [query, filter]);
  // Keeps the highlighted field in view when ↑ ↓ move it (not on open or hover).
  const byKeys = useRef(false);
  useEffect(() => {
    if (!activeKey || !byKeys.current) return;
    byKeys.current = false;
    list.current?.querySelector(`[data-key="${CSS.escape(activeKey)}"]`)?.scrollIntoView({ block: "nearest" });
  }, [activeKey]);

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") return e.preventDefault(), onClose();
    if (e.key === "Tab" && slots > 1) return e.preventDefault(), onStep(e.shiftKey ? -1 : 1);
    if (e.target !== search.current) return;
    if (e.key === "ArrowDown") return e.preventDefault(), (byKeys.current = true), setActive((a) => Math.min(a + 1, pickable.length - 1));
    if (e.key === "ArrowUp") return e.preventDefault(), (byKeys.current = true), setActive((a) => Math.max(a - 1, 0));
    if (e.key === "Enter") {
      e.preventDefault();
      const it = pickable.find((p) => p.key === activeKey);
      if (it) onChoose(it.ref);
    }
  };

  const thumbCols = template === "one" || template === "two" ? 1 : template === "standard" ? 2 : CELLS[template] > 6 ? 4 : 2;
  const smallBtn = "inline-flex h-7 items-center rounded-md border border-line bg-surface px-2 text-xs text-muted hover:text-ink disabled:opacity-40";

  const body = (
    <>
      <div className="flex shrink-0 items-center gap-2.5 px-4 pt-3 pb-2">
        {phone ? (
          <span className="grid h-10 w-8 shrink-0 gap-0.5 rounded border border-line p-0.5" style={{ gridTemplateColumns: `repeat(${thumbCols}, minmax(0, 1fr))` }} aria-hidden>
            {Array.from({ length: slots }, (_, i) => (
              <i key={i} className={`rounded-[1px] ${i === selected ? "bg-accent" : "bg-control"}`} />
            ))}
          </span>
        ) : (
          <span className="rounded bg-accent px-1.5 py-0.5 text-xs font-semibold text-white">Field {number}</span>
        )}
        <div className="min-w-0 flex-1">
          {phone && <div className="font-semibold">Field {number}</div>}
          <div className={`truncate ${phone ? "text-xs text-muted" : "font-semibold"}`}>{currentLabel ?? "Empty"}</div>
        </div>
        {current && (
          <>
            <button type="button" className={smallBtn} disabled={!canMove(-1)} onClick={() => onMove(-1)} aria-label="Move field earlier" title="Move earlier">
              ←
            </button>
            <button type="button" className={smallBtn} disabled={!canMove(1)} onClick={() => onMove(1)} aria-label="Move field later" title="Move later">
              →
            </button>
          </>
        )}
        {wide && (
          <button type="button" className={`${smallBtn} ${wide.on ? "border-primary bg-primary text-on-primary hover:text-on-primary" : ""}`} aria-pressed={wide.on} disabled={!wide.can} title={wide.can ? undefined : "No room on this page"} onClick={() => wide.set(!wide.on)}>
            Wide
          </button>
        )}
        {onRemove && (
          <button type="button" className={smallBtn} onClick={onRemove}>
            Remove
          </button>
        )}
      </div>
      {options && <div className="max-h-48 shrink-0 overflow-y-auto px-4 pb-2">{options}</div>}
      <div className="shrink-0 px-4 pb-2">
        <input ref={search} className={`${input} w-full`} placeholder="Search fields" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search fields" />
      </div>
      <div className="flex shrink-0 gap-1.5 overflow-x-auto px-4 pb-2.5 [scrollbar-width:none]">
        {FILTERS.filter((f) => f !== "Plugins" || pluginFields.length).map((f) => (
          <button
            type="button"
            key={f}
            aria-pressed={filter === f}
            onClick={() => setFilter(f)}
            className={`h-7 shrink-0 rounded-full px-2.5 text-xs transition-colors ${filter === f ? (f === "Plugins" ? "bg-plugin text-white" : "bg-primary text-on-primary") : f === "Plugins" ? "bg-plugin-soft text-plugin" : "bg-raised text-ink hover:bg-active"}`}
          >
            {f}
          </button>
        ))}
      </div>
      <div ref={list} className={`min-h-0 flex-1 overflow-y-auto border-t border-line px-1.5 py-1 ${phone ? "" : "max-h-72"}`}>
        {sections.length === 0 && <p className="px-3 py-4 text-sm text-muted">No fields match.</p>}
        {sections.map((s) => (
          <div key={s.name}>
            <div className={`px-2.5 pt-2.5 pb-1 text-[11px] font-semibold tracking-wide uppercase ${s.plugin ? "text-plugin" : "text-muted"}`}>{s.name}</div>
            {s.items.map((it) => {
              const on = it.key === currentKey;
              return (
                <button
                  type="button"
                  key={it.key}
                  data-key={it.key}
                  disabled={!!it.reason}
                  onClick={() => onChoose(it.ref)}
                  onMouseEnter={() => !it.reason && setActive(pickable.findIndex((p) => p.key === it.key))}
                  aria-pressed={on}
                  className={`flex w-full flex-wrap items-baseline gap-x-2.5 rounded-md px-2.5 text-left transition-colors disabled:cursor-not-allowed ${phone ? "py-2.5 text-base" : "py-1.5 text-sm"} ${it.reason ? "text-faint" : ""} ${on ? "bg-accent-soft" : it.key === activeKey ? "bg-raised" : ""}`}
                >
                  <span className="w-3.5 shrink-0 text-xs font-bold text-accent" aria-hidden>
                    {on ? "✓" : ""}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{it.label}</span>
                  {it.plugin ? (
                    <span className="max-w-[45%] shrink-0 truncate rounded border border-plugin-line bg-plugin-soft px-1.5 text-xs text-plugin">{it.plugin}</span>
                  ) : (
                    <span className="shrink-0 text-xs text-faint">{it.hint}</span>
                  )}
                  {it.reason && <span className="basis-full pl-6 text-xs text-warning">{it.reason}</span>}
                </button>
              );
            })}
          </div>
        ))}
      </div>
      <div className="flex shrink-0 items-center justify-between gap-3 border-t border-line px-4 py-2.5 text-sm">
        <button type="button" className="font-medium text-accent hover:underline" onClick={onCustom}>
          + New custom field
        </button>
        {phone ? (
          slots > 1 && (
            <button type="button" className="font-medium text-ink" onClick={() => onStep(1)}>
              Next field ›
            </button>
          )
        ) : (
          <span className="text-xs text-faint">Tab next field · Esc close</span>
        )}
      </div>
    </>
  );

  if (phone)
    return (
      <div
        ref={box}
        role="dialog"
        aria-label={`Field ${number}`}
        onKeyDown={onKey}
        className="fixed inset-x-0 bottom-0 z-40 flex max-h-[55vh] flex-col rounded-t-2xl bg-surface pb-[env(safe-area-inset-bottom)] shadow-[0_-10px_30px_rgb(0_0_0/0.2)]"
      >
        <div className="mx-auto mt-2 h-1.5 w-9 shrink-0 rounded-full bg-control" />
        {body}
      </div>
    );
  return (
    <div
      ref={box}
      role="dialog"
      aria-label={`Field ${number}`}
      onKeyDown={onKey}
      style={place ? { left: place.left, top: place.top, maxHeight: place.maxHeight } : { visibility: "hidden" }}
      className="fixed z-40 flex w-96 flex-col overflow-hidden rounded-xl border border-line bg-surface shadow-[0_12px_40px_rgb(13_17_23/0.2)]"
    >
      {body}
    </div>
  );
}

function unitHint(id: string) {
  const d = metrics.get(id);
  if (!d) return "";
  if (id === "power.3s") return "3s · W";
  return d.unit === "s" ? "m:ss" : d.unit === "tss" ? "TSS" : id.endsWith("zone") ? "Z1–Z7" : d.unit;
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

