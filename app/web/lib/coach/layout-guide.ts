// get_layout: the rider's own layout as the coach sees it. Tabs in their order with what each holds,
// Today's cards in order, their ride field pages, and what could be added, so "where's my form?" is
// answered from this rider's app rather than the standard one. Plugin cards are named by id with
// their author's wording under `untrusted` (see plugins.ts). Plain data, no browser APIs.

import { PAGE_TEMPLATES, type FieldRef, type Layout, type RidePage } from "../sdk/layout";
import { fieldName, TAB_NAMES, type LayoutContext } from "../sdk/layout-edit";
import { TAB_GUIDE } from "./app-guide";
import { label, UNTRUSTED_NOTE } from "./plugins";

function field(ctx: LayoutContext, f: FieldRef) {
  if ("metric" in f) return { metric: f.metric, name: fieldName(ctx, f) };
  const c = f.custom;
  return { custom: { metric: c.metric, windowSeconds: c.window, agg: c.agg, ...(c.asPercentOf ? { asPercentOf: c.asPercentOf } : {}), ...(c.as ? { as: c.as } : {}) }, name: c.label };
}

function pages(ctx: LayoutContext, list: RidePage[]) {
  return list.map((p, i) => ({ page: i + 1, name: p.name, template: p.template, slots: PAGE_TEMPLATES[p.template], fields: p.fields.map((f, j) => ({ slot: j + 1, ...field(ctx, f) })) }));
}

export function layoutReport(layout: Layout, ctx: LayoutContext) {
  const widget = (id: string) => ctx.widgets.find((w) => w.id === id);
  const cardInfo = (id: string) => {
    const w = widget(id);
    if (!w) return { from: "removed plugin", name: "A card from a plugin that's no longer installed" };
    return w.source.kind === "lactic" ? { from: "Lactic", name: w.name } : { from: `plugin:${w.source.pluginId}`, untrusted: { name: label(w.name, 40) } };
  };
  const onToday = new Set(layout.today.filter((c) => !c.hidden).map((c) => c.widget));
  const usesPlugins = layout.today.some((c) => c.widget.startsWith("plugin.")) || ctx.widgets.some((w) => w.source.kind === "plugin");
  const set = (s: Layout["ride"]["free"]) => (s === "follow" ? "same as the workout pages" : pages(ctx, s.pages));
  return {
    tabs: layout.tabs.map((t) => ({ tab: t.id, name: TAB_NAMES[t.id], shown: !t.hidden, holds: TAB_GUIDE[t.id] })),
    today: {
      cards: layout.today.map((c, i) => ({ position: i + 1, widget: c.widget, size: c.size, shown: !c.hidden, ...cardInfo(c.widget) })),
      note: "Some Lactic cards only appear when they have something to say (the weigh-in nudge when one is due, the last ride before today's is ridden).",
      canAdd: ctx.widgets.filter((w) => !onToday.has(w.id)).map((w) => ({ widget: w.id, sizes: w.sizes, ...(w.source.kind === "lactic" ? { name: w.name } : { from: `plugin:${w.source.pluginId}`, untrusted: { name: label(w.name, 40) } }) })),
    },
    rideFields: {
      workout: pages(ctx, layout.ride.workout.pages),
      freeRide: set(layout.ride.free),
      overlay: set(layout.ride.overlay),
      liveMetrics: ctx.metrics
        .forScope("live")
        .filter((m) => !m.id.startsWith("plugin."))
        .map((m) => ({ metric: m.id, name: m.label, ...(m.needs ? { needs: m.needs } : {}) })),
    },
    templates: PAGE_TEMPLATES,
    ...(usesPlugins ? { note: UNTRUSTED_NOTE } : {}),
  };
}
