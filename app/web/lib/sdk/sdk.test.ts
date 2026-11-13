import { describe, expect, it } from "vitest";
import {
  addCard,
  cardRows,
  defaultLayout,
  formatMetric,
  hiddenCards,
  isMetricId,
  LACTIC_METRICS,
  layoutChanges,
  layoutSummary,
  MetricRegistry,
  moveCard,
  moveTab,
  nudgeCard,
  parseLayout,
  DEFAULT_HEAD_UNIT_PAGE,
  pluginMetricId,
  removeCard,
  ridePages,
  rowColumns,
  sameLayout,
  setTabHidden,
  shownCards,
  sizeCard,
  validateKit,
  withNewCards,
} from "./index";

describe("metric registry", () => {
  it("has well-formed, unique ids", () => {
    const ids = LACTIC_METRICS.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(isMetricId(id)).toBe(true);
  });

  it("keeps plugin metrics in their own namespace and refuses duplicates", () => {
    const r = new MetricRegistry();
    const id = pluginMetricId("wprime-tools", "balance");
    r.add({ id, label: "W′ balance", unit: "kJ", scope: "live", group: "live", description: "W′ left." });
    expect(r.get(id)?.label).toBe("W′ balance");
    expect(() => r.add({ ...r.get(id)! })).toThrow();
    expect(() => r.add({ ...r.get(id)!, id: "Bad Id" })).toThrow();
  });

  it("splits metrics by where they can be shown", () => {
    const r = new MetricRegistry();
    expect(r.forScope("live").every((m) => m.scope === "live")).toBe(true);
    expect(r.forScope("live").map((m) => m.id)).toContain("power.3s");
  });

  it("formats values for fields", () => {
    expect(formatMetric({ unit: "W" }, 251.4)).toBe("251");
    expect(formatMetric({ unit: "s" }, 462)).toBe("7:42");
    expect(formatMetric({ unit: "s" }, 3930)).toBe("1:05:30");
    expect(formatMetric({ unit: "W/kg", decimals: 2 }, 4.123)).toBe("4.12");
    expect(formatMetric({ unit: "W" }, null)).toBe("–");
  });
});

describe("kit validation", () => {
  it("passes a good tree through and drops unknown properties", () => {
    const r = validateKit({ type: "stack", children: [{ type: "field", label: "W′ bal", value: "14.2", unit: "kJ", onClick: "steal()", html: "<img>" }] });
    expect(r).toEqual({ ok: true, node: { type: "stack", children: [{ type: "field", label: "W′ bal", value: "14.2", unit: "kJ" }] } });
  });

  it("refuses unknown node types, markup and bad numbers", () => {
    expect(validateKit({ type: "html", html: "<script>" }).ok).toBe(false);
    expect(validateKit({ type: "sparkline", values: [1, "2"] }).ok).toBe(false);
    expect(validateKit({ type: "sparkline", values: [1, Number.NaN] }).ok).toBe(false);
    expect(validateKit({ type: "text", text: "x".repeat(281) }).ok).toBe(false);
    expect(validateKit(null).ok).toBe(false);
  });

  it("caps tree size and depth", () => {
    const wide = { type: "stack", children: Array.from({ length: 250 }, () => ({ type: "text", text: "a" })) };
    expect(validateKit(wide).ok).toBe(false);
    let deep: unknown = { type: "text", text: "a" };
    for (let i = 0; i < 10; i++) deep = { type: "stack", children: [deep] };
    expect(validateKit(deep).ok).toBe(false);
  });

  it("lets plugin buttons open only their own detail view", () => {
    expect(validateKit({ type: "button", label: "Start ride", action: { kind: "lactic", to: "ride" } }).ok).toBe(false);
    expect(validateKit({ type: "button", label: "Details", action: { kind: "open-detail" } }).ok).toBe(true);
    expect(validateKit({ type: "button", label: "Start ride", action: { kind: "lactic", to: "ride" } }, { fromPlugin: false }).ok).toBe(true);
  });

  it("clamps meters to 0 to 1", () => {
    expect(validateKit({ type: "meter", value: 3 })).toEqual({ ok: true, node: { type: "meter", value: 1 } });
  });
});

describe("layouts", () => {
  it("defaults to the app as it was: five tabs plus Plugins (Modular only), Today's cards, the player's ten fields", () => {
    const l = defaultLayout();
    expect(l.tabs.map((t) => t.id)).toEqual(["today", "plan", "ride", "progress", "health", "plugins"]);
    expect(l.today.map((c) => c.widget)).toEqual(["lactic.recovery", "lactic.weigh-in", "lactic.workout", "lactic.brief", "lactic.this-week", "lactic.form", "lactic.last-ride"]);
    expect(ridePages(l, "overlay")).toEqual(l.ride.workout.pages);
    expect(l.ride.workout.pages[0]).toMatchObject({ template: "standard" });
    expect(l.ride.workout.pages[0].fields).toHaveLength(10);
  });

  it("round-trips through JSON", () => {
    const l = defaultLayout();
    l.today[0].size = "medium";
    l.tabs = [l.tabs[2], l.tabs[0], l.tabs[1], l.tabs[3], { ...l.tabs[4], hidden: true }, l.tabs[5]];
    l.plugins.screens = [{ name: "Climbing", cards: [{ widget: "plugin.climb.form", size: "large", hidden: false }] }, { name: "Main", cards: [] }];
    l.plugins.placed = ["plugin.climb.form"];
    expect(parseLayout(JSON.stringify(l))).toEqual(l);
  });

  it("gives a layout saved before head units the head unit page, and keeps the rider's own", () => {
    const old = defaultLayout() as unknown as { ride: Record<string, unknown> };
    delete old.ride.headUnit;
    const parsed = parseLayout(JSON.stringify(old));
    expect(parsed.ride.headUnit).toEqual({ pages: [DEFAULT_HEAD_UNIT_PAGE] });
    expect(parsed.ride.free).toBe("follow");

    const mine = defaultLayout();
    mine.ride.headUnit = { pages: [{ name: "Climb", template: "two", fields: [{ metric: "power.3s" }, { metric: "heart_rate" }] }] };
    expect(parseLayout(JSON.stringify(mine)).ride.headUnit).toEqual(mine.ride.headUnit);
    mine.ride.headUnit = "follow";
    expect(parseLayout(JSON.stringify(mine)).ride.headUnit).toBe("follow");
  });

  it("falls back to the default for anything it can't read", () => {
    expect(parseLayout("not json")).toEqual(defaultLayout());
    expect(parseLayout({ v: 99 })).toEqual(defaultLayout());
    expect(parseLayout({ v: 1, today: "x", ride: { workout: { pages: [] } } })).toEqual(defaultLayout());
  });

  it("drops unknown and duplicate entries, plugin cards on Today, and never hides Today or Ride", () => {
    const l = parseLayout({
      v: 1,
      tabs: [{ id: "ride", hidden: true }, { id: "coach" }, { id: "today", hidden: true }, { id: "today" }],
      today: [{ widget: "lactic.form", size: "huge" }, { widget: "lactic.form" }, { widget: "<script>" }, { widget: "plugin.climb-lab.readiness", size: "small", extra: 1 }],
    });
    expect(l.tabs.slice(0, 2)).toEqual([{ id: "ride", hidden: false }, { id: "today", hidden: false }]);
    expect(l.tabs).toHaveLength(6);
    expect(l.today).toEqual([{ widget: "lactic.form", size: "large", hidden: false }]);
  });

  it("checks ride pages and custom fields, trimming fields to the template", () => {
    const l = parseLayout({
      v: 1,
      ride: {
        workout: {
          pages: [
            {
              name: "Climb",
              template: "four",
              fields: [
                { metric: "power.3s" },
                { custom: { metric: "power", window: 10, agg: "avg", label: "Pwr 10s" } },
                { custom: { metric: "power", window: 0, agg: "avg", asPercentOf: "ftp", label: "%FTP" } },
                { custom: { metric: "power", window: -1, agg: "avg", label: "bad" } },
                { metric: "heart_rate" },
                { metric: "cadence" },
              ],
            },
            { name: "Bad", template: "twelve", fields: [] },
          ],
        },
        overlay: { pages: [{ name: "Mini", template: "four", fields: [{ metric: "power" }] }] },
      },
    });
    expect(l.ride.workout.pages).toHaveLength(1);
    expect(l.ride.workout.pages[0].fields).toEqual([
      { metric: "power.3s" },
      { custom: { metric: "power", window: 10, agg: "avg", label: "Pwr 10s" } },
      { custom: { metric: "power", window: 0, agg: "avg", asPercentOf: "ftp", label: "%FTP" } },
      { metric: "heart_rate" },
    ]);
    expect(l.ride.free).toBe("follow");
    expect(ridePages(l, "overlay")[0].name).toBe("Mini");
  });

  it("adds built-in cards that are new since the layout was saved, keeping hidden ones hidden", () => {
    const l = defaultLayout();
    l.today = l.today.filter((c) => c.widget !== "lactic.brief");
    l.today[0].hidden = true;
    const next = withNewCards(l);
    expect(next.today.at(-1)?.widget).toBe("lactic.brief");
    expect(next.today[0].hidden).toBe(true);
  });
});

describe("Today's card rows", () => {
  const cards = defaultLayout().today;
  it("puts the default layout's form and last ride side by side, the rest full width", () => {
    expect(cardRows(cards, () => true)).toEqual([
      { size: "large", widgets: ["lactic.recovery"] },
      { size: "large", widgets: ["lactic.weigh-in"] },
      { size: "large", widgets: ["lactic.workout"] },
      { size: "large", widgets: ["lactic.brief"] },
      { size: "large", widgets: ["lactic.this-week"] },
      { size: "medium", widgets: ["lactic.form", "lactic.last-ride"] },
    ]);
  });

  it("leaves out hidden cards and cards with nothing to show, without leaving a gap", () => {
    const layout = cards.map((c) => (c.widget === "lactic.brief" ? { ...c, hidden: true } : c));
    const rows = cardRows(layout, (w) => w !== "lactic.weigh-in" && w !== "lactic.last-ride");
    expect(rows.map((r) => r.widgets)).toEqual([["lactic.recovery"], ["lactic.workout"], ["lactic.this-week"], ["lactic.form"]]);
  });

  it("groups consecutive small cards, but not across a different size", () => {
    const rows = cardRows(
      [
        { widget: "lactic.form", size: "small", hidden: false },
        { widget: "lactic.recovery", size: "small", hidden: false },
        { widget: "lactic.brief", size: "large", hidden: false },
        { widget: "lactic.last-ride", size: "small", hidden: false },
      ],
      () => true,
    );
    expect(rows.map((r) => r.widgets)).toEqual([["lactic.form", "lactic.recovery"], ["lactic.brief"], ["lactic.last-ride"]]);
  });
});

describe("layout edits", () => {
  it("moves shown cards without disturbing hidden ones", () => {
    let l = removeCard(defaultLayout(), "lactic.weigh-in");
    l = moveCard(l, "lactic.brief", 3); // below This week
    expect(l.today.map((c) => c.widget)).toEqual(["lactic.recovery", "lactic.weigh-in", "lactic.workout", "lactic.this-week", "lactic.brief", "lactic.form", "lactic.last-ride"]);
    expect(nudgeCard(l, "lactic.recovery", -1)).toBe(l);
    expect(shownCards(nudgeCard(l, "lactic.recovery", 1))[1].widget).toBe("lactic.recovery");
  });

  it("only sizes a card to sizes it supports", () => {
    const l = defaultLayout();
    expect(sizeCard(l, "lactic.workout", "small")).toBe(l);
    expect(sizeCard(l, "lactic.form", "small").today.find((c) => c.widget === "lactic.form")?.size).toBe("small");
  });

  it("adds a hidden card back at the bottom", () => {
    const l = addCard(removeCard(defaultLayout(), "lactic.recovery"), "lactic.recovery");
    expect(l.today.at(-1)).toEqual({ widget: "lactic.recovery", size: "large", hidden: false });
    expect(hiddenCards(l)).toEqual([]);
  });

  it("moves tabs and never hides Today or Ride", () => {
    let l = moveTab(defaultLayout(), "ride", 1);
    expect(l.tabs.map((t) => t.id)).toEqual(["today", "ride", "plan", "progress", "health", "plugins"]);
    expect(setTabHidden(l, "today", true)).toBe(l);
    expect(setTabHidden(l, "ride", true)).toBe(l);
    l = setTabHidden(l, "health", true);
    expect(l.tabs.find((t) => t.id === "health")).toEqual({ id: "health", hidden: true });
  });

  it("describes changes for a saved copy's name and summarizes for feedback", () => {
    const base = defaultLayout();
    let l = setTabHidden(base, "health", true);
    l = moveCard(l, "lactic.brief", 4);
    l = sizeCard(removeCard(l, "lactic.last-ride"), "lactic.form", "large");
    expect(layoutChanges(l, base)).toEqual(["Health tab hidden", "Form made large", "Last ride removed", "cards moved"]);
    expect(layoutChanges(base, base)).toEqual([]);
    expect(sameLayout(base, defaultLayout())).toBe(true);
    expect(layoutSummary(l).tabs).toContain("health (hidden)");
  });

  it("spreads a short row of Medium or Small cards across the width", () => {
    expect(rowColumns({ size: "medium", widgets: ["a"] })).toBe(1);
    expect(rowColumns({ size: "medium", widgets: ["a", "b"] })).toBe(2);
    expect(rowColumns({ size: "small", widgets: ["a", "b"] })).toBe(2);
    expect(rowColumns({ size: "small", widgets: ["a", "b", "c"] })).toBe(3);
    expect(rowColumns({ size: "large", widgets: ["a"] })).toBe(1);
  });
});
