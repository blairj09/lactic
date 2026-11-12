// Lactic's own Today cards as widgets: their names and one-line descriptions, for the coach's
// get_layout, layout proposals and (later) the Customize library. The cards themselves are drawn
// in web/app/today.tsx, keyed by these ids. Plain data, no browser APIs.

import type { WidgetManifest } from "./widgets";

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

export const BUILTIN_TODAY_WIDGETS: readonly WidgetManifest[] = [
  card("lactic.recovery", "Recovery", "Last night's recovery (sleep, HRV, resting heart rate) and how you feel this morning.", ["recovery.score", "recovery.hrv", "recovery.resting_hr", "recovery.sleep"]),
  card("lactic.weigh-in", "Weekly weigh-in", "Asks for a weigh-in before the week's first ride when there's none from the last seven days.", ["profile.weight"], { conditional: true }),
  card("lactic.workout", "Today's workout", "Today's session with Start ride, and easier or harder options for the day.", ["plan.week_done", "profile.ftp"]),
  card("lactic.brief", "Coach's brief", "The coach's morning brief.", []),
  card("lactic.this-week", "This week", "This week's planned and ridden days.", ["plan.week_done"]),
  card("lactic.form", "Form", "Form, fitness and fatigue today.", ["fitness.tsb", "fitness.ctl", "fitness.atl"], { sizes: ["medium", "large", "small"] }),
  card("lactic.last-ride", "Last ride", "The last ride, and a nudge to set FTP when it isn't set.", ["ride.np", "ride.tss", "ride.duration"], { sizes: ["medium", "large", "small"], conditional: true }),
];

export function builtinWidget(id: string): WidgetManifest | undefined {
  return BUILTIN_TODAY_WIDGETS.find((w) => w.id === id);
}
