// Lactic's own Today cards as widgets: what Customize Today calls each one, what it shows, and the
// sizes it can be drawn at. Ids match the default layout (layout.ts) and today.tsx. Plain data.

import type { CardSize, WidgetManifest } from "./widgets";

const lactic = { kind: "lactic" } as const;

function card(id: string, name: string, description: string, sizes: CardSize[], conditional = false): WidgetManifest {
  return { id, name, description, source: lactic, surfaces: ["today"], sizes, reads: [], ...(conditional ? { conditional } : {}) };
}

/** In the default order. The first size is the card's default. */
export const TODAY_CARDS: readonly WidgetManifest[] = [
  card("lactic.recovery", "Recovery", "Score, HRV, resting heart rate, breathing and sleep", ["large", "medium"], true),
  card("lactic.weigh-in", "Weekly weigh-in", "Shows only when a weigh-in is due", ["large", "medium"], true),
  card("lactic.workout", "Today's workout", "Ready to train?, today's plan and the suggested ride", ["large"]),
  card("lactic.brief", "Coach's brief", "The coach's note for today", ["large", "medium"], true),
  card("lactic.this-week", "This week", "The week so far, day by day", ["large"]),
  card("lactic.form", "Form", "Form, fitness and fatigue", ["medium", "large", "small"]),
  card("lactic.last-ride", "Last ride", "Your last ride and how it felt", ["medium", "large"], true),
];

/** A Today card's manifest, or a stand-in for one Lactic doesn't know (a plugin that's gone, review U12). */
export function todayCard(id: string): WidgetManifest {
  return (
    TODAY_CARDS.find((c) => c.id === id) ?? {
      id,
      name: id.startsWith("plugin.") ? "Plugin card" : "Card",
      description: "Not available on this computer",
      source: lactic,
      surfaces: ["today"],
      sizes: ["large", "medium", "small"],
      reads: [],
    }
  );
}

export const SIZE_LABELS: Record<CardSize, string> = { small: "Small", medium: "Medium", large: "Large" };
