// Small, named edits to a layout: what the coach can propose (propose_layout_change) and what the
// Customize screens can reuse. Each edit is checked against the layout it applies to and throws a
// plain reason when it can't apply. Edits add rather than replace (review U11): putting a field
// where another one is, or hiding something, is its own explicit edit, never a side effect.
//
// Plain data, no browser APIs.

import { PAGE_TEMPLATES, parseField, TAB_IDS, type CardEntry, type FieldRef, type Layout, type PageTemplate, type RidePage, type TabId } from "./layout";
import type { MetricRegistry } from "./metrics";
import type { CardSize, WidgetManifest } from "./widgets";

/** Which ride field set an edit is for. Free ride and the overlay follow the workout set until changed. */
export type FieldSetId = "workout" | "free" | "overlay";
export const FIELD_SETS: readonly FieldSetId[] = ["workout", "free", "overlay"];

export type LayoutChange =
  /** Put a card on Today (or show a hidden one), after `after` or at the end. */
  | { action: "add_card"; widget: string; size?: CardSize; after?: string | null }
  /** Move a card to just after `after`, or to the top when `after` is null. */
  | { action: "move_card"; widget: string; after: string | null }
  | { action: "hide_card"; widget: string }
  | { action: "resize_card"; widget: string; size: CardSize }
  /** Move a tab to just after `after`, or first when null. */
  | { action: "move_tab"; tab: TabId; after: TabId | null }
  | { action: "hide_tab"; tab: TabId }
  | { action: "show_tab"; tab: TabId }
  /** Add a field to a page's first empty slot. Never replaces one. Page is 1-based. */
  | { action: "add_field"; set: FieldSetId; page: number; field: FieldRef }
  /** Put a field in place of the one at `slot` (1-based). Only when the rider asked for that swap. */
  | { action: "replace_field"; set: FieldSetId; page: number; slot: number; field: FieldRef }
  | { action: "remove_field"; set: FieldSetId; page: number; slot: number }
  /** A new ride page at the end of the set. */
  | { action: "add_page"; set: FieldSetId; name: string; template: PageTemplate; fields: FieldRef[] };

export const LAYOUT_ACTIONS = ["add_card", "move_card", "hide_card", "resize_card", "move_tab", "hide_tab", "show_tab", "add_field", "replace_field", "remove_field", "add_page"] as const;

/** What an edit needs to know: the cards that exist (Lactic's, plus enabled plugins') and the metrics. */
export interface LayoutContext {
  widgets: readonly Pick<WidgetManifest, "id" | "name" | "sizes" | "source" | "required">[];
  metrics: MetricRegistry;
}

export const TAB_NAMES: Record<TabId, string> = { today: "Today", plan: "Plan", ride: "Ride", progress: "Progress", health: "Health" };
const SIZE_NAMES: Record<CardSize, string> = { small: "Small", medium: "Medium", large: "Large" };
const SIZES: readonly CardSize[] = ["small", "medium", "large"];
const MAX_PAGES = 8;

const obj = (v: unknown): Record<string, unknown> => (typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

function oneOf<T extends string>(v: unknown, allowed: readonly T[], what: string): T {
  if (typeof v !== "string" || !allowed.includes(v as T)) throw new Error(`${what} is one of ${allowed.join(", ")}`);
  return v as T;
}

function whole(v: unknown, what: string, min = 1): number {
  const n = typeof v === "string" && v.trim() ? Number(v) : v;
  if (typeof n !== "number" || !Number.isInteger(n) || n < min) throw new Error(`${what} is a whole number from ${min}`);
  return n;
}

/** A metric id, or a custom field object ({ metric, window, agg, label, asPercentOf? }). */
function fieldArg(v: unknown): FieldRef {
  const f = typeof v === "string" ? parseField({ metric: v }) : parseField(obj(v).custom ? v : { custom: v });
  if (!f) throw new Error('field is a metric id like "power.3s", or a custom field { metric, window (seconds), agg (avg, max, lap-avg or ride-avg), label, asPercentOf? (ftp or max-hr) }');
  return f;
}

/** Turns the model's arguments into an edit, or throws with what's wrong. Doesn't look at the layout yet. */
export function checkLayoutChange(raw: Record<string, unknown>): LayoutChange {
  const action = oneOf(raw.action, LAYOUT_ACTIONS, "action");
  const widget = () => {
    if (typeof raw.widget !== "string" || !raw.widget.trim()) throw new Error("Give the card's widget id, from get_layout");
    return raw.widget.trim();
  };
  const set = () => (raw.set === undefined || raw.set === null || raw.set === "" ? "workout" : oneOf(raw.set, FIELD_SETS, "set"));
  const page = () => (raw.page === undefined || raw.page === null ? 1 : whole(raw.page, "page"));
  switch (action) {
    case "add_card":
      return { action, widget: widget(), ...(raw.size !== undefined && raw.size !== null ? { size: oneOf(raw.size, SIZES, "size") } : {}), after: typeof raw.after === "string" && raw.after ? raw.after : null };
    case "move_card":
      return { action, widget: widget(), after: typeof raw.after === "string" && raw.after ? raw.after : null };
    case "hide_card":
      return { action, widget: widget() };
    case "resize_card":
      return { action, widget: widget(), size: oneOf(raw.size, SIZES, "size") };
    case "move_tab":
      return { action, tab: oneOf(raw.tab, TAB_IDS, "tab"), after: raw.after === null || raw.after === undefined || raw.after === "" ? null : oneOf(raw.after, TAB_IDS, "after") };
    case "hide_tab":
    case "show_tab":
      return { action, tab: oneOf(raw.tab, TAB_IDS, "tab") };
    case "add_field":
      return { action, set: set(), page: page(), field: fieldArg(raw.field) };
    case "replace_field":
      return { action, set: set(), page: page(), slot: whole(raw.slot, "slot"), field: fieldArg(raw.field) };
    case "remove_field":
      return { action, set: set(), page: page(), slot: whole(raw.slot, "slot") };
    case "add_page": {
      const name = typeof raw.name === "string" ? raw.name.trim() : "";
      if (!name || name.length > 24) throw new Error("Give the page a name of 1 to 24 characters");
      const fields = Array.isArray(raw.fields) ? raw.fields.map(fieldArg) : [];
      return { action, set: set(), name, template: oneOf(raw.template, Object.keys(PAGE_TEMPLATES) as PageTemplate[], "template"), fields };
    }
  }
}

function cardName(ctx: LayoutContext, id: string): string {
  return ctx.widgets.find((w) => w.id === id)?.name ?? id;
}

/** A field's name as the picker shows it. */
export function fieldName(ctx: Pick<LayoutContext, "metrics">, f: FieldRef): string {
  return "metric" in f ? (ctx.metrics.get(f.metric)?.label ?? f.metric) : f.custom.label;
}

function checkFieldMetric(ctx: LayoutContext, f: FieldRef) {
  const id = "metric" in f ? f.metric : f.custom.metric;
  const def = ctx.metrics.get(id);
  if (!def) throw new Error(`There's no metric "${id}"; ride fields use the live metrics get_layout lists`);
  if (def.scope !== "live") throw new Error(`${def.label} isn't a live number, so it can't be a ride field`);
}

/** The pages an edit to `set` changes. A set that follows the workout set is split off first. */
function pagesFor(layout: Layout, set: FieldSetId): RidePage[] {
  if (set === "workout") return layout.ride.workout.pages;
  const s = layout.ride[set];
  if (s === "follow") {
    const pages = structuredClone(layout.ride.workout.pages);
    layout.ride[set] = { pages };
    return pages;
  }
  return s.pages;
}

function pageAt(pages: RidePage[], page: number): RidePage {
  const p = pages[page - 1];
  if (!p) throw new Error(`There's no page ${page}; this set has ${pages.length}`);
  return p;
}

function moveAfter<T>(list: T[], item: T, after: T | null, same: (a: T, b: T) => boolean) {
  const from = list.findIndex((x) => same(x, item));
  const [moved] = list.splice(from, 1);
  const at = after === null ? 0 : list.findIndex((x) => same(x, after)) + 1;
  list.splice(at, 0, moved);
}

/** The layout with the edit made. Throws a plain reason when it can't be made; the input is untouched. */
export function applyLayoutChange(input: Layout, change: LayoutChange, ctx: LayoutContext): Layout {
  const layout = structuredClone(input);
  const card = (id: string): CardEntry => {
    const c = layout.today.find((x) => x.widget === id);
    if (!c) throw new Error(`${cardName(ctx, id)} isn't on Today; use add_card`);
    return c;
  };
  const known = (id: string) => {
    const w = ctx.widgets.find((x) => x.id === id);
    if (!w) throw new Error(`There's no card "${id}"; get_layout lists the cards that can go on Today`);
    return w;
  };
  switch (change.action) {
    case "add_card": {
      const w = known(change.widget);
      const size = change.size ?? w.sizes[0] ?? "large";
      if (!w.sizes.includes(size)) throw new Error(`${w.name} comes in ${w.sizes.map((s) => SIZE_NAMES[s]).join(", ")}`);
      const existing = layout.today.find((c) => c.widget === w.id);
      if (existing && !existing.hidden) throw new Error(`${w.name} is already on Today; use move_card or resize_card`);
      if (change.after) card(change.after);
      if (existing) {
        existing.hidden = false;
        existing.size = size;
        if (change.after) moveAfter(layout.today, existing, card(change.after), (a, b) => a.widget === b.widget);
      } else {
        const entry: CardEntry = { widget: w.id, size, hidden: false };
        const at = change.after ? layout.today.findIndex((c) => c.widget === change.after) + 1 : layout.today.length;
        layout.today.splice(at, 0, entry);
      }
      return layout;
    }
    case "move_card": {
      const c = card(change.widget);
      if (change.after === change.widget) throw new Error("A card can't go after itself");
      moveAfter(layout.today, c, change.after ? card(change.after) : null, (a, b) => a.widget === b.widget);
      return layout;
    }
    case "hide_card": {
      const c = card(change.widget);
      if (ctx.widgets.find((w) => w.id === c.widget)?.required) throw new Error(`${cardName(ctx, c.widget)} can only be moved, not taken off`);
      if (c.hidden) throw new Error(`${cardName(ctx, c.widget)} is already hidden`);
      c.hidden = true;
      return layout;
    }
    case "resize_card": {
      const c = card(change.widget);
      const sizes = ctx.widgets.find((w) => w.id === c.widget)?.sizes ?? SIZES;
      if (!sizes.includes(change.size)) throw new Error(`${cardName(ctx, c.widget)} comes in ${sizes.map((s) => SIZE_NAMES[s]).join(", ")}`);
      c.size = change.size;
      return layout;
    }
    case "move_tab": {
      if (change.after === change.tab) throw new Error("A tab can't go after itself");
      const t = layout.tabs.find((x) => x.id === change.tab)!;
      moveAfter(layout.tabs, t, change.after ? layout.tabs.find((x) => x.id === change.after)! : null, (a, b) => a.id === b.id);
      return layout;
    }
    case "hide_tab":
    case "show_tab": {
      if (change.tab === "ride") throw new Error("The Ride tab is always shown");
      const t = layout.tabs.find((x) => x.id === change.tab)!;
      const hidden = change.action === "hide_tab";
      if (t.hidden === hidden) throw new Error(`${TAB_NAMES[t.id]} is already ${hidden ? "hidden" : "shown"}`);
      if (hidden && change.tab === "today") throw new Error("Today is where the day's workout starts, so it stays");
      t.hidden = hidden;
      return layout;
    }
    case "add_field": {
      checkFieldMetric(ctx, change.field);
      const p = pageAt(pagesFor(layout, change.set), change.page);
      const room = PAGE_TEMPLATES[p.template];
      if (p.fields.length >= room) throw new Error(`Page ${change.page} (${p.name}) is full with ${room} fields. Ask whether to replace one (replace_field) or add a page (add_page); don't replace without asking`);
      p.fields.push(change.field);
      return layout;
    }
    case "replace_field": {
      checkFieldMetric(ctx, change.field);
      const p = pageAt(pagesFor(layout, change.set), change.page);
      if (!p.fields[change.slot - 1]) throw new Error(`Page ${change.page} has ${p.fields.length} fields; there's no field ${change.slot}`);
      p.fields[change.slot - 1] = change.field;
      return layout;
    }
    case "remove_field": {
      const p = pageAt(pagesFor(layout, change.set), change.page);
      if (!p.fields[change.slot - 1]) throw new Error(`Page ${change.page} has ${p.fields.length} fields; there's no field ${change.slot}`);
      p.fields.splice(change.slot - 1, 1);
      return layout;
    }
    case "add_page": {
      const pages = pagesFor(layout, change.set);
      if (pages.length >= MAX_PAGES) throw new Error(`A set holds at most ${MAX_PAGES} pages`);
      const room = PAGE_TEMPLATES[change.template];
      if (change.fields.length > room) throw new Error(`A ${change.template} page holds ${room} fields`);
      change.fields.forEach((f) => checkFieldMetric(ctx, f));
      pages.push({ name: change.name, template: change.template, fields: structuredClone(change.fields) });
      return layout;
    }
  }
}

const SET_NAMES: Record<FieldSetId, string> = { workout: "Ride fields", free: "Free ride fields", overlay: "Overlay fields" };

/** The edit in words, for the Apply card. */
export function describeLayoutChange(layout: Layout, change: LayoutChange, ctx: LayoutContext): string {
  const where = (set: FieldSetId, page: number) => {
    const pages = set === "workout" || layout.ride[set] === "follow" ? layout.ride.workout.pages : (layout.ride[set] as { pages: RidePage[] }).pages;
    return `${SET_NAMES[set]}, page ${page}${pages[page - 1] ? ` (${pages[page - 1].name})` : ""}`;
  };
  const after = (id: string | null | undefined) => (id ? `after ${cardName(ctx, id)}` : "to the top");
  switch (change.action) {
    case "add_card": {
      const size = change.size ?? ctx.widgets.find((w) => w.id === change.widget)?.sizes[0] ?? "large";
      return `Today: add ${cardName(ctx, change.widget)} (${SIZE_NAMES[size]}) ${change.after ? after(change.after) : "at the end"}`;
    }
    case "move_card":
      return `Today: move ${cardName(ctx, change.widget)} ${after(change.after)}`;
    case "hide_card":
      return `Today: hide ${cardName(ctx, change.widget)} (add it back any time in Customize)`;
    case "resize_card":
      return `Today: make ${cardName(ctx, change.widget)} ${SIZE_NAMES[change.size]}`;
    case "move_tab":
      return `Tabs: move ${TAB_NAMES[change.tab]} ${change.after ? `after ${TAB_NAMES[change.after]}` : "to the front"}`;
    case "hide_tab":
      return `Tabs: hide ${TAB_NAMES[change.tab]}`;
    case "show_tab":
      return `Tabs: show ${TAB_NAMES[change.tab]}`;
    case "add_field":
      return `${where(change.set, change.page)}: add ${fieldName(ctx, change.field)}`;
    case "replace_field": {
      const old = pagesFor(structuredClone(layout), change.set)[change.page - 1]?.fields[change.slot - 1];
      return `${where(change.set, change.page)}: ${old ? `${fieldName(ctx, old)} → ` : ""}${fieldName(ctx, change.field)}`;
    }
    case "remove_field": {
      const old = pagesFor(structuredClone(layout), change.set)[change.page - 1]?.fields[change.slot - 1];
      return `${where(change.set, change.page)}: remove ${old ? fieldName(ctx, old) : `field ${change.slot}`}`;
    }
    case "add_page":
      return `${SET_NAMES[change.set]}: add a page "${change.name}"${change.fields.length ? ` with ${change.fields.map((f) => fieldName(ctx, f)).join(", ")}` : ""}`;
  }
}
