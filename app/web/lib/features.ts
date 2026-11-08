// What the rider tracks in Lactic beyond rides and the plan, which are always on: sleep and
// recovery (from a watch or ring), and weight (a smart scale or typed in). Each one turned off
// hides its Today step, its part of Health, its gear and setup, and keeps the coach from asking
// about it. Data that arrives anyway (intervals.icu wellness, say) is still kept, so turning one
// back on shows its history.
//
// The shell loads the saved choice at start and keeps it here, so screens and the coach read it
// without waiting. Riders from before the choice existed have no saved value and keep everything.

export interface Features {
  recovery: boolean;
  weight: boolean;
}

export type Feature = keyof Features;

export const ALL_FEATURES: Features = { recovery: true, weight: true };
export const FEATURES_SETTING = "features";
export const FEATURES_EVENT = "lactic:features";

export const FEATURE_LABELS: Record<Feature, string> = { recovery: "sleep and recovery", weight: "weight" };

/** A saved value, with anything missing or not true/false counted as on. */
export function parseFeatures(value: unknown): Features {
  const v = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  return { recovery: v.recovery !== false, weight: v.weight !== false };
}

let current: Features = ALL_FEATURES;

export function features(): Features {
  return current;
}

/** Sets what's on for this session (the shell saves it); open screens follow. */
export function setCurrentFeatures(next: Features) {
  current = parseFeatures(next);
  globalThis.dispatchEvent?.(new Event(FEATURES_EVENT));
}

/** Whether Health has anything to show. */
export const hasHealth = (f: Features) => f.recovery || f.weight;
