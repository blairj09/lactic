// Power profile: best W/kg at five durations, from sprint to endurance, rated against
// Allen and Coggan's power profile table (Training and Racing with a Power Meter).

import type { PowerCurve } from "./power";

export type ProfileAxis = "sprint" | "anaerobic" | "vo2max" | "threshold" | "endurance";

/** The Coggan table's four columns. */
type TableColumn = "5s" | "1min" | "5min" | "ft";

export interface AxisSpec {
  axis: ProfileAxis;
  label: string;
  /** Seconds; one of the power curve's standard durations. */
  duration: number;
  column: TableColumn;
  /** Multiplies the best power before rating it: 95% of 20 minutes stands in for FTP. */
  factor: number;
}

export const PROFILE_AXES: readonly AxisSpec[] = [
  { axis: "sprint", label: "Sprint", duration: 5, column: "5s", factor: 1 },
  { axis: "anaerobic", label: "Anaerobic", duration: 60, column: "1min", factor: 1 },
  { axis: "vo2max", label: "VO2 max", duration: 300, column: "5min", factor: 1 },
  { axis: "threshold", label: "Threshold", duration: 1200, column: "ft", factor: 0.95 },
  // An hour's best is FTP by definition, so it's rated on the same column without a factor.
  { axis: "endurance", label: "Endurance", duration: 3600, column: "ft", factor: 1 },
];

/** Lowest first. The table spreads them evenly between its untrained and world class anchors. */
export const PROFILE_CATEGORIES = [
  "Untrained",
  "Fair",
  "Moderate",
  "Good",
  "Very good",
  "Excellent",
  "Exceptional",
  "World class",
] as const;
export type ProfileCategory = (typeof PROFILE_CATEGORIES)[number];

/**
 * The table's bottom (untrained) and top (world class) rows in W/kg. The rows between are close
 * to a straight line, so ratings interpolate between these anchors rather than storing every row.
 */
const ANCHORS: Record<"male" | "female", Record<TableColumn, { untrained: number; worldClass: number }>> = {
  male: {
    "5s": { untrained: 10.17, worldClass: 25.18 },
    "1min": { untrained: 5.64, worldClass: 11.5 },
    "5min": { untrained: 2.33, worldClass: 7.6 },
    ft: { untrained: 1.86, worldClass: 6.4 },
  },
  female: {
    "5s": { untrained: 8.37, worldClass: 19.42 },
    "1min": { untrained: 4.66, worldClass: 9.29 },
    "5min": { untrained: 2.01, worldClass: 6.61 },
    ft: { untrained: 1.68, worldClass: 5.69 },
  },
};

export interface ProfilePoint {
  axis: ProfileAxis;
  label: string;
  duration: number;
  /** Best average watts at this duration, or null without an effort that long. */
  watts: number | null;
  wattsPerKg: number | null;
  /** 0 is the table's untrained row and 100 its world class row; clamped to that range. */
  score: number | null;
  category: ProfileCategory | null;
}

export interface PowerProfile {
  points: ProfilePoint[];
  /** The strongest axis relative to the table, which is what the rider type reads from. */
  strongest: ProfileAxis | null;
  weakest: ProfileAxis | null;
  type: RiderType | null;
}

export type RiderType = "sprinter" | "pursuiter" | "time trialist" | "all-rounder";

/** Where a W/kg value sits between the table's untrained (0) and world class (100) rows. */
export function profileScore(wattsPerKg: number, column: TableColumn, sex: "male" | "female" = "male"): number {
  const { untrained, worldClass } = ANCHORS[sex][column];
  const score = ((wattsPerKg - untrained) / (worldClass - untrained)) * 100;
  return Math.min(100, Math.max(0, score));
}

export function profileCategory(score: number): ProfileCategory {
  const band = Math.min(PROFILE_CATEGORIES.length - 1, Math.floor((score / 100) * PROFILE_CATEGORIES.length));
  return PROFILE_CATEGORIES[band];
}

/** Score at the bottom of each category above untrained: where the radar draws its rings. */
export const CATEGORY_RINGS = PROFILE_CATEGORIES.slice(1).map((_, i) => ((i + 1) / PROFILE_CATEGORIES.length) * 100);

/** Sex defaults to male, the table's main set, when Settings doesn't say. */
export function powerProfile(curve: PowerCurve, weightKg: number, sex: "male" | "female" | null = null): PowerProfile {
  const table = sex ?? "male";
  const points = PROFILE_AXES.map(({ axis, label, duration, column, factor }): ProfilePoint => {
    const watts = curve[duration] ?? null;
    if (watts === null || weightKg <= 0) return { axis, label, duration, watts, wattsPerKg: null, score: null, category: null };
    const wattsPerKg = watts / weightKg;
    const score = profileScore(wattsPerKg * factor, column, table);
    return { axis, label, duration, watts, wattsPerKg, score, category: profileCategory(score) };
  });
  return { points, ...riderType(points) };
}

/**
 * Coggan's reading of the profile's shape: a sprinter is strongest at 5 s and 1 min, a pursuiter
 * at 1 and 5 min, a time trialist at threshold, and an all-rounder has no standout (within 10 points).
 */
function riderType(points: ProfilePoint[]): Pick<PowerProfile, "strongest" | "weakest" | "type"> {
  const rated = points.filter((p) => p.score !== null) as (ProfilePoint & { score: number })[];
  if (rated.length < 3) return { strongest: null, weakest: null, type: null };
  const sorted = [...rated].sort((a, b) => b.score - a.score);
  const strongest = sorted[0].axis;
  const weakest = sorted[sorted.length - 1].axis;
  const spread = sorted[0].score - sorted[sorted.length - 1].score;
  const score = (axis: ProfileAxis) => rated.find((p) => p.axis === axis)?.score ?? null;
  let type: RiderType;
  if (spread < 10) type = "all-rounder";
  else if (strongest === "sprint" || (strongest === "anaerobic" && (score("sprint") ?? 0) >= (score("vo2max") ?? 0))) type = "sprinter";
  else if (strongest === "anaerobic" || strongest === "vo2max") type = "pursuiter";
  else type = "time trialist";
  return { strongest, weakest, type };
}
