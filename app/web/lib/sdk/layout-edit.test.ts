import { describe, expect, it } from "vitest";
import { BUILTIN_TODAY_WIDGETS } from "./builtin-widgets";
import { defaultLayout, parseLayout, type Layout } from "./layout";
import { applyLayoutChange, checkLayoutChange, describeLayoutChange, type LayoutContext } from "./layout-edit";
import { MetricRegistry } from "./metrics";

const ctx: LayoutContext = { widgets: BUILTIN_TODAY_WIDGETS, metrics: new MetricRegistry() };
const edit = (layout: Layout, raw: Record<string, unknown>) => applyLayoutChange(layout, checkLayoutChange(raw), ctx);
const order = (l: Layout) => l.today.filter((c) => !c.hidden).map((c) => c.widget);

describe("layout edits", () => {
  it("moves a card to the top or after another, and leaves the input alone", () => {
    const base = defaultLayout();
    const top = edit(base, { action: "move_card", widget: "lactic.form", after: null });
    expect(order(top)[0]).toBe("lactic.form");
    expect(order(base)[0]).toBe("lactic.recovery");
    const after = edit(base, { action: "move_card", widget: "lactic.form", after: "lactic.recovery" });
    expect(order(after).slice(0, 2)).toEqual(["lactic.recovery", "lactic.form"]);
  });

  it("brings back a hidden card instead of adding it twice", () => {
    const hidden = edit(defaultLayout(), { action: "hide_card", widget: "lactic.form" });
    expect(order(hidden)).not.toContain("lactic.form");
    const back = edit(hidden, { action: "add_card", widget: "lactic.form", after: "lactic.workout" });
    expect(back.today.filter((c) => c.widget === "lactic.form")).toHaveLength(1);
    expect(order(back).indexOf("lactic.form")).toBe(order(back).indexOf("lactic.workout") + 1);
    expect(() => edit(back, { action: "add_card", widget: "lactic.form" })).toThrow(/already on Today/);
  });

  it("refuses cards that don't exist and sizes a card doesn't come in", () => {
    expect(() => edit(defaultLayout(), { action: "add_card", widget: "plugin.evil.card" })).toThrow(/no card/);
    const small = { ...ctx, widgets: [{ ...BUILTIN_TODAY_WIDGETS[0], sizes: ["large" as const] }] };
    expect(() => applyLayoutChange(defaultLayout(), checkLayoutChange({ action: "resize_card", widget: "lactic.recovery", size: "small" }), small)).toThrow(/comes in Large/);
  });

  it("moves and hides tabs but keeps Ride and Today", () => {
    const moved = edit(defaultLayout(), { action: "move_tab", tab: "health", after: "today" });
    expect(moved.tabs.map((t) => t.id)).toEqual(["today", "health", "plan", "ride", "progress"]);
    expect(edit(defaultLayout(), { action: "hide_tab", tab: "health" }).tabs.find((t) => t.id === "health")?.hidden).toBe(true);
    expect(() => edit(defaultLayout(), { action: "hide_tab", tab: "ride" })).toThrow(/always shown/);
    expect(() => edit(defaultLayout(), { action: "hide_tab", tab: "today" })).toThrow();
  });

  it("adds a field to an empty slot but never replaces one", () => {
    const base = defaultLayout();
    base.ride.workout.pages[0] = { name: "Workout", template: "six-chart", fields: base.ride.workout.pages[0].fields.slice(0, 5) };
    const added = edit(base, { action: "add_field", field: "ride.elapsed" });
    expect(added.ride.workout.pages[0].fields).toHaveLength(6);
    expect(added.ride.workout.pages[0].fields.slice(0, 5)).toEqual(base.ride.workout.pages[0].fields);
    expect(() => edit(added, { action: "add_field", field: "ride.intensity" })).toThrow(/full.*don't replace without asking/);
  });

  it("replaces a field only when asked, and checks the metric is live", () => {
    const swapped = edit(defaultLayout(), { action: "replace_field", page: 1, slot: 5, field: "ride.elapsed" });
    expect(swapped.ride.workout.pages[0].fields[4]).toEqual({ metric: "ride.elapsed" });
    expect(() => edit(defaultLayout(), { action: "add_field", field: "fitness.ctl" })).toThrow(/isn't a live number/);
    expect(() => edit(defaultLayout(), { action: "add_field", field: "made.up" })).toThrow(/no metric/);
  });

  it("takes custom fields and new pages", () => {
    const custom = { metric: "power", window: 10, agg: "avg", label: "10s power" };
    const page = edit(defaultLayout(), { action: "add_page", name: "Climb", template: "four", fields: [custom, "cadence"] });
    expect(page.ride.workout.pages[1]).toEqual({ name: "Climb", template: "four", fields: [{ custom }, { metric: "cadence" }] });
    expect(parseLayout(JSON.parse(JSON.stringify(page)))).toEqual(page);
  });

  it("splits free ride off the workout set when it's edited on its own", () => {
    const l = edit(defaultLayout(), { action: "remove_field", set: "free", page: 1, slot: 1 });
    expect(l.ride.workout.pages[0].fields).toHaveLength(10);
    expect(l.ride.free).not.toBe("follow");
    expect((l.ride.free as { pages: { fields: unknown[] }[] }).pages[0].fields).toHaveLength(9);
    expect(l.ride.overlay).toBe("follow");
  });

  it("rejects bad arguments with a reason", () => {
    expect(() => checkLayoutChange({ action: "delete_everything" })).toThrow(/action is one of/);
    expect(() => checkLayoutChange({ action: "add_field", field: { metric: "power" } })).toThrow(/field is/);
    expect(() => checkLayoutChange({ action: "move_tab", tab: "settings" })).toThrow(/tab is one of/);
  });

  it("describes each edit in words", () => {
    const base = defaultLayout();
    const say = (raw: Record<string, unknown>) => describeLayoutChange(base, checkLayoutChange(raw), ctx);
    expect(say({ action: "move_card", widget: "lactic.form", after: null })).toBe("Today: move Form to the top");
    expect(say({ action: "add_field", field: "ride.elapsed" })).toBe("Ride fields, page 1 (Workout): add Ride time");
    expect(say({ action: "replace_field", page: 1, slot: 5, field: "ride.elapsed" })).toBe("Ride fields, page 1 (Workout): Cadence → Ride time");
    expect(say({ action: "hide_tab", tab: "health" })).toBe("Tabs: hide Health");
  });
});
