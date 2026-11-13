// The Plugins tab's screens: parsing, placing new cards, and the editor's moves.
import { describe, expect, it } from "vitest";
import { defaultLayout, MAX_PLUGIN_SCREENS, parseLayout } from "./layout";
import { addCard, addScreen, deleteScreen, moveCard, moveScreen, placeNewCards, removeCard, renameScreen, resizeCard } from "./plugin-screens";

const W = { id: "plugin.wprime.week", pluginName: "W′ Tools", title: "W′ this week" };
const C = { id: "plugin.climb.form", pluginName: "Climb Lab", title: "Climbing form" };
const order = (l: ReturnType<typeof defaultLayout>, i = 0) => l.plugins.screens[i].cards.map((c) => c.widget);

describe("plugin screens in a saved layout", () => {
  it("starts with one empty screen", () => {
    expect(defaultLayout().plugins).toEqual({ screens: [{ name: "Main", cards: [] }], placed: [] });
    expect(parseLayout({ v: 1 }).plugins.screens).toHaveLength(1);
  });

  it("keeps plugin cards only, once per screen, and caps screens", () => {
    const l = parseLayout({
      v: 1,
      plugins: {
        screens: [
          { name: "Climbing", cards: [{ widget: "plugin.climb.form", size: "large" }, { widget: "plugin.climb.form" }, { widget: "lactic.form" }, { widget: "<script>" }] },
          { name: "", cards: [] },
          ...Array.from({ length: 20 }, (_, i) => ({ name: `S${i}`, cards: [] })),
        ],
        placed: ["plugin.climb.form", "lactic.form", 3],
      },
    });
    expect(l.plugins.screens[0]).toEqual({ name: "Climbing", cards: [{ widget: "plugin.climb.form", size: "large", hidden: false }] });
    expect(l.plugins.screens.length).toBeLessThanOrEqual(MAX_PLUGIN_SCREENS);
    expect(l.plugins.placed).toEqual(["plugin.climb.form"]);
  });
});

describe("placing new cards", () => {
  it("puts new cards on the first screen once, and never brings back one the rider removed", () => {
    let l = placeNewCards(defaultLayout(), [W, C]);
    expect(order(l)).toEqual([W.id, C.id]);
    l = removeCard(l, 0, W.id);
    expect(placeNewCards(l, [W, C])).toBe(l);
  });

  it("doesn't add a card already on another screen", () => {
    let l = addScreen(defaultLayout(), "Pacing");
    l = addCard(l, 1, W.id);
    l = placeNewCards(l, [W]);
    expect(order(l)).toEqual([]);
    expect(order(l, 1)).toEqual([W.id]);
  });
});

describe("editing", () => {
  it("adds, names, moves and deletes screens, keeping at least one", () => {
    let l = addScreen(defaultLayout());
    expect(l.plugins.screens.map((s) => s.name)).toEqual(["Main", "Screen 2"]);
    l = renameScreen(l, 1, "  Climbing  ");
    l = moveScreen(l, 1, -1);
    expect(l.plugins.screens.map((s) => s.name)).toEqual(["Climbing", "Main"]);
    expect(renameScreen(l, 0, "   ")).toBe(l);
    l = deleteScreen(l, 0);
    expect(deleteScreen(l, 0)).toBe(l);
    let full = defaultLayout();
    for (let i = 1; i < MAX_PLUGIN_SCREENS; i++) full = addScreen(full);
    expect(() => addScreen(full)).toThrow();
  });

  it("puts one card on several screens, orders and sizes it, and leaves the original untouched", () => {
    const base = addScreen(defaultLayout());
    let l = addCard(addCard(addCard(base, 0, W.id), 0, C.id), 1, W.id);
    expect(order(l)).toEqual([W.id, C.id]);
    expect(order(l, 1)).toEqual([W.id]);
    l = moveCard(l, 0, C.id, "top");
    expect(order(l)).toEqual([C.id, W.id]);
    l = resizeCard(l, 0, C.id, "large");
    expect(l.plugins.screens[0].cards[0].size).toBe("large");
    expect(order(base)).toEqual([]);
  });
});
