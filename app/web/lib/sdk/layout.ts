// The rider's layout: which tabs show and in what order, Today's cards, and the ride screen's
// field pages. One JSON document per device in the `layouts` table (src/db/schema.ts). The
// shipped default reproduces the app as it was before layouts existed, so a rider who never
// presses Customize sees no change.
//
// parseLayout() is strict: a layout restored from a backup, synced from the phone or hand-edited
// is checked field by field, and anything unknown is dropped (review S7). Plain data, no browser APIs.

import type { CardSize } from "./widgets";

export const LAYOUT_VERSION = 1;

/**
 * Lactic's tabs. Today (home, where the logo goes) and Ride (how a ride starts) can be moved but
 * not hidden; Settings isn't a tab on a computer and always stays.
 */
export const TAB_IDS = ["today", "plan", "ride", "progress", "health"] as const;
export type TabId = (typeof TAB_IDS)[number];
export const FIXED_TABS: readonly TabId[] = ["today", "ride"];

export interface TabEntry {
  id: TabId;
  hidden: boolean;
}

export interface CardEntry {
  /** A widget id (widgets.ts). */
  widget: string;
  size: CardSize;
  hidden: boolean;
}

/** What a ride field shows: a registered metric, or a custom field built from one (review U3). */
export type FieldRef =
  | { metric: string }
  | {
      custom: {
        metric: string;
        /** Seconds, for a rolling avg or max; 0 = right now. Ignored by the interval and ride aggregates. */
        window: number;
        /** lap-avg: this interval so far; last-lap-avg: the interval before; ride-avg: the whole ride. */
        agg: CustomAgg;
        asPercentOf?: "ftp" | "max-hr";
        /** Power only: per kilogram of body weight, or the power zone, instead of watts. */
        as?: "wkg" | "zone";
        label: string;
      };
    };

export const CUSTOM_AGGS = ["avg", "max", "lap-avg", "last-lap-avg", "ride-avg"] as const;
export type CustomAgg = (typeof CUSTOM_AGGS)[number];

/**
 * Page shapes, as on a head unit (mock 2). The number is how many fields it holds. "standard" is
 * the ride screen as it was before layouts: five big fields for this interval, the workout chart,
 * and five smaller ones for the ride so far.
 */
export const PAGE_TEMPLATES = { standard: 10, one: 1, four: 4, six: 6, "six-chart": 6, eight: 8, ten: 10 } as const;
export type PageTemplate = keyof typeof PAGE_TEMPLATES;

export interface RidePage {
  name: string;
  template: PageTemplate;
  fields: FieldRef[];
}

/** A set of ride pages, or "follow" to use the workout set (review U4: one set by default). */
export type FieldSet = { pages: RidePage[] } | "follow";

export interface Layout {
  v: number;
  tabs: TabEntry[];
  today: CardEntry[];
  ride: { workout: { pages: RidePage[] }; free: FieldSet; overlay: FieldSet };
}

/** Today as it was laid out before layouts (today.tsx): recovery, weigh-in nudge, workout, brief, week, then form and last ride side by side. */
export const DEFAULT_TODAY: readonly CardEntry[] = [
  { widget: "lactic.recovery", size: "large", hidden: false },
  { widget: "lactic.weigh-in", size: "large", hidden: false },
  { widget: "lactic.workout", size: "large", hidden: false },
  { widget: "lactic.brief", size: "large", hidden: false },
  { widget: "lactic.this-week", size: "large", hidden: false },
  { widget: "lactic.form", size: "medium", hidden: false },
  { widget: "lactic.last-ride", size: "medium", hidden: false },
];

/**
 * The ride player's fields before layouts (ride/player.tsx): interval, power, target, heart rate and
 * cadence, then the ride so far (average power, heart rate and cadence, TSS, time to go).
 */
export const DEFAULT_RIDE_PAGE: RidePage = {
  name: "Workout",
  template: "standard",
  fields: [
    { metric: "interval.left" },
    { metric: "power" },
    { metric: "power.target" },
    { metric: "heart_rate" },
    { metric: "cadence" },
    { metric: "so_far.power" },
    { metric: "so_far.heart_rate" },
    { metric: "so_far.cadence" },
    { metric: "so_far.tss" },
    { metric: "workout.to_go" },
  ],
};

export function defaultLayout(): Layout {
  return {
    v: LAYOUT_VERSION,
    tabs: TAB_IDS.map((id) => ({ id, hidden: false })),
    today: DEFAULT_TODAY.map((c) => ({ ...c })),
    ride: { workout: { pages: [structuredClone(DEFAULT_RIDE_PAGE)] }, free: "follow", overlay: "follow" },
  };
}

const SIZES: readonly CardSize[] = ["small", "medium", "large"];
const WIDGET_ID = /^(lactic|plugin)\.[a-z0-9_.-]{1,80}$/;
const METRIC_ID = /^[a-z0-9_]+(\.[a-z0-9_-]+)*$/;
const MAX_PAGES = 8;
const MAX_CARDS = 40;

const obj = (v: unknown): Record<string, unknown> | null => (typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
const text = (v: unknown, max = 40): string | null => (typeof v === "string" && v.trim() && v.length <= max ? v.trim() : null);

/** One ride field from untrusted input (a saved layout or a coach proposal), or null when it isn't well formed. */
export function parseField(v: unknown): FieldRef | null {
  const o = obj(v);
  if (!o) return null;
  if (typeof o.metric === "string" && METRIC_ID.test(o.metric)) return { metric: o.metric };
  const c = obj(o.custom);
  if (!c || typeof c.metric !== "string" || !METRIC_ID.test(c.metric)) return null;
  const window = typeof c.window === "number" && Number.isInteger(c.window) && c.window >= 0 && c.window <= 3600 ? c.window : null;
  const agg = CUSTOM_AGGS.includes(c.agg as CustomAgg) ? (c.agg as CustomAgg) : null;
  const label = text(c.label, 24);
  if (window === null || !agg || !label) return null;
  const asPercentOf = c.asPercentOf === "ftp" || c.asPercentOf === "max-hr" ? c.asPercentOf : undefined;
  const as = c.as === "wkg" || c.as === "zone" ? c.as : undefined;
  return { custom: { metric: c.metric, window, agg, label, ...(asPercentOf ? { asPercentOf } : {}), ...(as ? { as } : {}) } };
}

function parsePages(v: unknown): RidePage[] | null {
  if (!Array.isArray(v)) return null;
  const pages: RidePage[] = [];
  for (const p of v.slice(0, MAX_PAGES)) {
    const o = obj(p);
    const template = o && typeof o.template === "string" && o.template in PAGE_TEMPLATES ? (o.template as PageTemplate) : null;
    const name = text(o?.name, 24);
    if (!o || !template || !name || !Array.isArray(o.fields)) continue;
    const fields = o.fields.map(parseField).filter((f): f is FieldRef => f !== null).slice(0, PAGE_TEMPLATES[template]);
    pages.push({ name, template, fields });
  }
  return pages.length ? pages : null;
}

function parseSet(v: unknown): FieldSet {
  if (v === "follow") return "follow";
  const pages = parsePages(obj(v)?.pages);
  return pages ? { pages } : "follow";
}

/**
 * A layout from storage, sync or a backup, checked field by field. Whatever is missing or wrong
 * falls back to the default for that part; the result is always a usable layout.
 */
export function parseLayout(input: unknown): Layout {
  const base = defaultLayout();
  const o = obj(typeof input === "string" ? safeJson(input) : input);
  if (!o || o.v !== LAYOUT_VERSION) return base;

  // Tabs: known ids once each, in the saved order; any missing come back at the end, shown.
  const tabs: TabEntry[] = [];
  if (Array.isArray(o.tabs)) {
    for (const t of o.tabs) {
      const e = obj(t);
      const id = e?.id as TabId;
      if (!e || !TAB_IDS.includes(id) || tabs.some((x) => x.id === id)) continue;
      tabs.push({ id, hidden: FIXED_TABS.includes(id) ? false : e.hidden === true });
    }
  }
  for (const id of TAB_IDS) if (!tabs.some((t) => t.id === id)) tabs.push({ id, hidden: false });

  // Today: well-formed widget ids once each. Unknown widgets are kept (a plugin that's switched
  // off or removed shows a placeholder, review U12); the renderer decides what each one draws.
  const today: CardEntry[] = [];
  if (Array.isArray(o.today)) {
    for (const c of o.today.slice(0, MAX_CARDS)) {
      const e = obj(c);
      if (!e || typeof e.widget !== "string" || !WIDGET_ID.test(e.widget) || today.some((x) => x.widget === e.widget)) continue;
      today.push({ widget: e.widget, size: SIZES.includes(e.size as CardSize) ? (e.size as CardSize) : "large", hidden: e.hidden === true });
    }
  }

  const ride = obj(o.ride);
  return {
    v: LAYOUT_VERSION,
    tabs,
    today: today.length ? today : base.today,
    ride: {
      workout: { pages: parsePages(obj(ride?.workout)?.pages) ?? base.ride.workout.pages },
      free: parseSet(ride?.free),
      overlay: parseSet(ride?.overlay),
    },
  };
}

function safeJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

/** The pages a ride shows: a set that follows uses the workout pages (review U4). */
export function ridePages(layout: Layout, kind: "workout" | "free" | "overlay"): RidePage[] {
  const set = kind === "workout" ? layout.ride.workout : layout.ride[kind];
  return set === "follow" ? layout.ride.workout.pages : set.pages;
}

/**
 * Built-in Today cards added to Lactic after a layout was saved come in at the end, so a new card
 * is never lost. Cards the rider took off stay in the layout as hidden, so they don't come back.
 */
export function withNewCards(layout: Layout): Layout {
  const missing = DEFAULT_TODAY.filter((c) => !layout.today.some((x) => x.widget === c.widget));
  return missing.length ? { ...layout, today: [...layout.today, ...missing.map((c) => ({ ...c }))] } : layout;
}

/** A run of Today cards drawn together: one Large card, or consecutive Medium or Small cards side by side. */
export interface CardRow {
  size: CardSize;
  widgets: string[];
}

/**
 * Today's cards in layout order, as rows to draw. Hidden cards and cards with nothing to show
 * today (`shows` false: the rest day card on a training day, the weigh-in nudge when it isn't due)
 * are left out before grouping, so a missing card never leaves a hole.
 */
export function cardRows(cards: readonly CardEntry[], shows: (widget: string) => boolean): CardRow[] {
  const rows: CardRow[] = [];
  for (const c of cards) {
    if (c.hidden || !shows(c.widget)) continue;
    const last = rows.at(-1);
    if (c.size !== "large" && last?.size === c.size) last.widgets.push(c.widget);
    else rows.push({ size: c.size, widgets: [c.widget] });
  }
  return rows;
}
