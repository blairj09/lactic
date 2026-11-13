// Progression levels: where you are in each zone, seeded from your power curve and moved by how
// planned workouts actually went.

import { INTERVAL_ZONES, MAX_LEVEL, MIN_LEVEL, STARTING_LEVELS, buildSession, type Levels, type Zone } from "./library";
import type { Difficulty } from "./feedback";
import type { PowerCurve } from "./power";

/** Best average power for any duration, interpolated on log time between the curve's durations. */
export function bestPowerAt(curve: PowerCurve, seconds: number): number | null {
  const points = Object.entries(curve)
    .map(([d, w]) => [Number(d), w] as const)
    .sort((a, b) => a[0] - b[0]);
  if (points.length === 0 || seconds > points[points.length - 1][0]) return null;
  for (let i = 0; i < points.length; i++) {
    const [d, w] = points[i];
    if (d === seconds) return w;
    if (d > seconds) {
      if (i === 0) return w;
      const [d0, w0] = points[i - 1];
      const t = (Math.log(seconds) - Math.log(d0)) / (Math.log(d) - Math.log(d0));
      return w0 + (w - w0) * t;
    }
  }
  return null;
}

/**
 * Starting levels from the last few months of riding. For each interval zone, the highest level
 * whose single work interval your power curve shows you can hold, minus one because a workout
 * repeats it. Endurance from your longest recent ride. Zones with no evidence keep the defaults.
 */
export function seedLevels(curve: PowerCurve | null, ftp: number | null, longestRideSeconds: number): Levels {
  const levels = { ...STARTING_LEVELS };
  levels.endurance = clamp(1 + (2 * longestRideSeconds) / 3600);
  if (!curve || !ftp) return levels;
  for (const zone of INTERVAL_ZONES) {
    let best: number | null = null;
    for (let level = MIN_LEVEL; level <= MAX_LEVEL; level += 0.5) {
      const { work, target } = mainInterval(zone, level);
      const power = bestPowerAt(curve, work);
      if (power !== null && power >= target * ftp * 0.98) best = level;
    }
    if (best !== null) levels[zone] = clamp(best - 1);
  }
  return levels;
}

/** The first work interval of a workout at this level (from a long slot, so the level isn't cut down). */
function mainInterval(zone: Zone, level: number): { work: number; target: number } {
  const steps = buildSession(zone, level, 3 * 3600).workout.segments;
  const work = steps.find((s, i) => i > 0 && s.kind === "steady" && !s.opener && s.target >= 0.75);
  return work && work.kind === "steady" ? { work: work.duration, target: work.target } : { work: 0, target: 0 };
}

/** How a planned workout went. */
export interface Outcome {
  /** YYYY-MM-DD, so outcomes apply in order. */
  date: string;
  zone: Zone;
  level: number;
  /** Fraction of the planned time ridden. */
  completion: number;
  /** 1 easy, 2 moderate, 3 hard, 4 very hard, 5 all out. Unknown counts as hard. Asked before ride feedback existed. */
  feel?: 1 | 2 | 3 | 4 | 5;
  /** The post-ride survey's answer, which wins over `feel`. */
  difficulty?: Difficulty;
  /** Perceived exertion, 1 to 10, from the survey. */
  rpe?: number | null;
}

export const FEEL_AFTER_LABELS = ["Easy", "Moderate", "Hard", "Very hard", "All out"] as const;

/**
 * Applies outcomes in date order. Finishing a workout takes your level to at least the workout's
 * level, plus a bit more when it felt easy; an all-out finish counts for slightly less. Stopping
 * early (under 80% of the time) drops you half a level below the workout.
 *
 * With the post-ride survey: too easy is a level up; about right moves up 0.3 (0.6 at RPE 6 or
 * less, nothing at 9 or more); too hard drops you half a level below the workout, and not
 * finishing a full level below.
 */
export function applyOutcomes(start: Levels, outcomes: Outcome[]): Levels {
  const levels = { ...start };
  for (const o of [...outcomes].sort((a, b) => a.date.localeCompare(b.date))) {
    if (o.zone === "recovery") continue;
    const current = levels[o.zone];
    if (o.difficulty === "failed") {
      levels[o.zone] = clamp(Math.min(current, o.level - 1));
      continue;
    }
    if (o.completion < 0.8 || o.difficulty === "tooHard") {
      levels[o.zone] = clamp(Math.min(current, o.level - 0.5));
      continue;
    }
    const bump = o.difficulty ? surveyBump(o.difficulty, o.rpe ?? null) : { 1: 1, 2: 0.6, 3: 0.3, 4: 0, 5: -0.5 }[o.feel ?? 3];
    levels[o.zone] = clamp(Math.max(current, o.level + bump));
  }
  return levels;
}

function surveyBump(difficulty: "tooEasy" | "right", rpe: number | null): number {
  if (difficulty === "tooEasy") return 1;
  if (rpe !== null && rpe <= 6) return 0.6;
  if (rpe !== null && rpe >= 9) return 0;
  return 0.3;
}

const clamp = (level: number) => Math.round(Math.min(Math.max(level, MIN_LEVEL), MAX_LEVEL) * 10) / 10;

/**
 * How a chosen session went, from the rides that day. A ride saved against the session counts
 * whatever its intensity; other rides count only when they were about as hard as planned (an
 * unstructured ride on an interval day says nothing about the intervals). Null when nothing counts.
 */
export function outcomeFromRides(
  date: string,
  session: { zone: Zone; level: number; duration: number; stress: number },
  rides: { durationSeconds: number; trainingStress: number | null; linked: boolean }[],
  answer: Pick<Outcome, "feel" | "difficulty" | "rpe"> = {},
): Outcome | null {
  const plannedIntensity = intensity(session.stress, session.duration);
  const counted = rides.filter((r) => r.linked || (r.trainingStress !== null && intensity(r.trainingStress, r.durationSeconds) >= plannedIntensity * 0.9));
  if (counted.length === 0 || session.duration <= 0) return null;
  const seconds = counted.reduce((sum, r) => sum + r.durationSeconds, 0);
  return { date, zone: session.zone, level: session.level, completion: Math.min(1, seconds / session.duration), ...answer };
}

/** Intensity factor implied by stress over a duration (stress = hours x IF^2 x 100). */
const intensity = (stress: number, seconds: number) => (seconds > 0 ? Math.sqrt((stress * 36) / seconds) : 0);
