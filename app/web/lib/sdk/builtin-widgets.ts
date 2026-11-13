// Lactic's own Today cards as widgets: their names, one-line descriptions and the sizes each can be
// drawn at (the first is its default), for the coach's get_layout, layout proposals and Customize Today. The cards themselves are drawn
// in web/app/today.tsx, keyed by these ids. Plain data, no browser APIs.

import type { CardSize, WidgetManifest } from "./widgets";

const card = (id: string, name: string, description: string, reads: string[], extra: Partial<WidgetManifest> = {}): WidgetManifest => ({
  id,
  name,
  description,
  source: { kind: "lactic" },
  surfaces: ["today"],
  sizes: ["large", "medium", "small"],
  reads,
  ...extra,
});

// Sizes follow what each card can show: the workout and the week need the full width; Small Form
// is just the form number.
const L: CardSize[] = ["large"];
const LM: CardSize[] = ["large", "medium"];

export const BUILTIN_TODAY_WIDGETS: readonly WidgetManifest[] = [
  card("lactic.recovery", "Recovery", "Last night's recovery: sleep, HRV, resting heart rate and breathing.", ["recovery.score", "recovery.hrv", "recovery.resting_hr", "recovery.sleep"], { sizes: LM, conditional: true }),
  card("lactic.weigh-in", "Weekly weigh-in", "Asks for a weigh-in before the week's first ride when there's none from the last seven days.", ["profile.weight"], { sizes: LM, conditional: true }),
  card("lactic.workout", "Today's workout", "Today's session with Start ride, and easier or harder options for the day.", ["plan.week_done", "profile.ftp"], { sizes: L }),
  card("lactic.brief", "Coach's brief", "The coach's morning brief.", [], { sizes: LM, conditional: true }),
  card("lactic.this-week", "This week", "This week's planned and ridden days.", ["plan.week_done"], { sizes: L }),
  card("lactic.form", "Form", "Form, fitness and fatigue today.", ["fitness.tsb", "fitness.ctl", "fitness.atl"], { sizes: ["medium", "large", "small"] }),
  card("lactic.last-ride", "Last ride", "The last ride, and a nudge to set FTP when it isn't set.", ["ride.np", "ride.tss", "ride.duration"], { sizes: ["medium", "large"], conditional: true }),
];

export function builtinWidget(id: string): WidgetManifest | undefined {
  return BUILTIN_TODAY_WIDGETS.find((w) => w.id === id);
}

/** A Today card's manifest, or a stand-in for one this version of Lactic doesn't know (from a newer version, say). Today holds only Lactic's own cards. */
export function todayCard(id: string): WidgetManifest {
  return (
    builtinWidget(id) ?? {
      id,
      name: "Card",
      description: "Not available on this computer",
      source: { kind: "lactic" },
      surfaces: ["today"],
      sizes: ["large", "medium", "small"],
      reads: [],
    }
  );
}

export const SIZE_LABELS: Record<CardSize, string> = { small: "Small", medium: "Medium", large: "Large" };
