// Workouts generated to fit a time slot, with a difficulty level per zone (the open version of
// TrainerRoad's progression levels) and a structure per workout (templates.ts). Targets are
// fractions of FTP, as in workout.ts.

import { alignRamps, plannedStress, ramp, steady, workoutDuration, type Segment, type Workout } from "./workout";
import { classicTemplate, clampTweaks, templateById, type Params, type Template } from "./templates";

export const ZONES = ["recovery", "endurance", "tempo", "sweetSpot", "threshold", "vo2max", "anaerobic"] as const;
export type Zone = (typeof ZONES)[number];

export const ZONE_LABELS: Record<Zone, string> = {
  recovery: "Recovery",
  endurance: "Endurance",
  tempo: "Tempo",
  sweetSpot: "Sweet spot",
  threshold: "Threshold",
  vo2max: "VO2 max",
  anaerobic: "Anaerobic",
};

/** Zones with structured intervals, where levels progress. Recovery and endurance are steady rides. */
export const INTERVAL_ZONES: Zone[] = ["tempo", "sweetSpot", "threshold", "vo2max", "anaerobic"];

export const MIN_LEVEL = 1;
export const MAX_LEVEL = 10;

export type Levels = Record<Zone, number>;

export const STARTING_LEVELS: Levels = { recovery: 1, endurance: 3, tempo: 3, sweetSpot: 3, threshold: 2, vo2max: 2, anaerobic: 2 };

/** A workout plus what it is: the zone it trains, its level, and planned training stress. */
export interface Session {
  zone: Zone;
  level: number;
  workout: Workout;
  /** Seconds. */
  duration: number;
  stress: number;
  /** The structure it was built from (templates.ts), its targets, and the ones set directly. Missing on older stored sessions. */
  template?: string;
  params?: Params;
  tweaks?: Params;
  /** Set when you edited the workout on the Plan page, so it's no longer one the engine built. */
  edited?: boolean;
  /** The starter library workout it is (workout-library.ts), when it is one. */
  library?: string;
}

const clampLevel = (level: number) => Math.min(Math.max(level, MIN_LEVEL), MAX_LEVEL);
const roundTo = (value: number, step: number) => Math.round(value / step) * step;

/** Which structure to build (templates.ts), and any of its targets set directly. */
export interface SessionOptions {
  template?: string | null;
  tweaks?: Params;
}

/**
 * A workout in `zone` that fills `durationSeconds`, in the classic structure unless `template` names
 * another one for the zone. Interval zones fall back to a lower level when the slot is too short to
 * fit the requested one, then to the classic structure; the session reports the level it actually
 * reached. Durations are rounded to 5 minutes.
 */
export function buildSession(zone: Zone, level: number, durationSeconds: number, options: SessionOptions = {}): Session {
  const duration = Math.max(roundTo(durationSeconds, 300), 1200);
  const requested = clampLevel(level);
  const chosen = templateById(options.template);
  const template = chosen && chosen.zone === zone ? chosen : null;

  if (zone === "recovery" || (zone === "endurance" && !template)) {
    const target = zone === "recovery" ? 0.5 : 0.6 + 0.012 * requested;
    const warm = Math.min(600, duration * 0.15);
    const cool = Math.min(300, duration * 0.1);
    const segments: Segment[] = [ramp(warm, 0.45, target), steady(duration - warm - cool, target), ramp(cool, target, 0.45)];
    const name = `${ZONE_LABELS[zone]} ${minutes(duration)} min`;
    return finish(zone, zone === "recovery" ? 1 : requested, { name, segments });
  }

  if (template) {
    for (let l = requested; l >= MIN_LEVEL - 1e-9; l -= 0.5) {
      const session = fromTemplate(template, l, duration, clampTweaks(template, options.tweaks));
      if (session) return session;
    }
    if (zone === "endurance") return buildSession("endurance", requested, duration);
  }
  if (zone !== "endurance") {
    const classic = classicTemplate(zone);
    for (let l = requested; l >= MIN_LEVEL - 1e-9; l -= 0.5) {
      const session = fromTemplate(classic, l, duration, {});
      if (session) return session;
    }
  }
  // Too short for any structure: ride it as tempo-flavored endurance.
  return buildSession("endurance", 5, duration);
}

/** Warm-up, the structure's main set, endurance for any time it leaves, and a cool-down. */
function fromTemplate(template: Template, level: number, duration: number, tweaks: Params): Session | null {
  const warm = 600;
  const cool = 300;
  const main = duration - warm - cool;
  const params = { ...template.defaults(level), ...tweaks };
  const set = template.main(params, level, main);
  if (!set) return null;
  const segments: Segment[] = [ramp(warm, 0.45, 0.7), ...set.segments];
  const used = set.segments.reduce((s, x) => s + x.duration, 0);
  if (main - used > 0) segments.push(steady(main - used, template.pad?.(params) ?? 0.6));
  segments.push(ramp(cool, 0.65, 0.4));
  return {
    ...finish(template.zone, level, { name: set.title, segments }),
    template: template.id,
    params,
    ...(Object.keys(tweaks).length ? { tweaks } : {}),
  };
}

function finish(zone: Zone, level: number, built: Workout): Session {
  const workout = { ...built, segments: alignRamps(built.segments) };
  return { zone, level: Math.round(level * 10) / 10, workout, duration: workoutDuration(workout), stress: plannedStress(workout) };
}

/** A short ride with a few hard efforts, two days before an event. */
export function openers(durationSeconds = 2700): Session {
  const duration = Math.max(roundTo(durationSeconds, 300), 1800);
  const segments: Segment[] = [ramp(600, 0.45, 0.7), steady(300, 0.65)];
  for (let i = 0; i < 3; i++) segments.push(steady(60, 1.1), steady(120, 0.5));
  const used = 600 + 300 + 3 * 180 + 300;
  segments.push(steady(Math.max(duration - used, 0), 0.6), ramp(300, 0.6, 0.4));
  return finish("vo2max", 1, { name: `Openers ${minutes(duration)} min`, segments });
}

/**
 * A ramp test in ERG: 1 minute steps of 6% FTP from 50% until you can't hold it. Planned to 150%;
 * stop when you fail and the ride's best minute sets the new FTP estimate.
 */
export function rampTest(): Session {
  const segments: Segment[] = [ramp(480, 0.45, 0.5)];
  for (let target = 0.5; target <= 1.5 + 1e-9; target += 0.06) segments.push(steady(60, Math.round(target * 100) / 100));
  segments.push(ramp(300, 0.5, 0.4));
  return finish("vo2max", 1, { name: RAMP_TEST_NAME, segments });
}

export const RAMP_TEST_NAME = "Ramp test";

/** The engine's ramp test, so the ride can set FTP from it (`rampTestFtp`). */
export const isRampTest = (workout: Workout) => workout.name === RAMP_TEST_NAME;

const minutes = (seconds: number) => Math.round(seconds / 60);
