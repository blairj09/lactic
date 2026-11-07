// Extending a workout at its end: a free ride where the trainer rides like a road, an ERG hold at
// a wattage you can move while riding, or another workout block from the engine's structures.
// Pure, so it tests in Node.

import { TEMPLATES, templateById, type Template } from "../engine/templates";
import { steady, type Segment, type Workout } from "../engine/workout";
import { clampErg } from "./erg";

export type Extension =
  | { kind: "erg"; watts: number; minutes: number }
  | { kind: "freeRide"; minutes: number }
  | { kind: "block"; template: string; level: number; minutes: number };

export type ExtendKind = Extension["kind"];

export const EXTEND_KINDS: { kind: ExtendKind; label: string }[] = [
  { kind: "freeRide", label: "Free ride" },
  { kind: "erg", label: "ERG hold" },
  { kind: "block", label: "Workout block" },
];

export const EXTEND_MAX_MINUTES = 180;
export const DEFAULT_BLOCK = "vo2max-intervals";

export const clampMinutes = (minutes: number) => (Number.isFinite(minutes) ? Math.min(EXTEND_MAX_MINUTES, Math.max(1, Math.round(minutes))) : 5);

/** Blocks on offer, in the order the picker steps through them. */
export const BLOCKS: Template[] = TEMPLATES;

/** The fewest whole minutes the block's main set fits in at `level`. */
export function blockMinutes(template: Template, level: number): number {
  const p = template.defaults(level);
  for (let m = 1; m <= EXTEND_MAX_MINUTES; m++) if (template.main(p, level, m * 60)) return m;
  return EXTEND_MAX_MINUTES;
}

/** Minutes an extension will really add: a block can't be shorter than its main set. */
export function extensionMinutes(extension: Extension): number {
  const minutes = clampMinutes(extension.minutes);
  if (extension.kind !== "block") return minutes;
  const template = templateById(extension.template);
  return template ? Math.max(minutes, blockMinutes(template, extension.level)) : minutes;
}

/**
 * The workout with the extension added at the end. Targets are fractions of FTP and the player
 * scales the whole workout by its intensity, so an ERG hold's fraction is divided by that scale to
 * land on the watts asked for, and is marked `hold` so the player's − and + move its watts.
 */
export function extendWorkout(workout: Workout, extension: Extension, ftp: number, intensity = 1): Workout {
  const duration = extensionMinutes(extension) * 60;
  const add = (segments: Segment[]) => ({ ...workout, segments: [...workout.segments, ...segments] });
  if (extension.kind === "freeRide") return add([{ kind: "freeRide", duration }]);
  if (extension.kind === "erg") {
    const target = ftp > 0 && intensity > 0 ? clampErg(extension.watts) / ftp / intensity : 0.6;
    return add([{ ...steady(duration, target), hold: true }]);
  }
  const template = templateById(extension.template);
  const p = template?.defaults(extension.level);
  const main = template && p ? template.main(p, extension.level, duration) : null;
  if (!template || !p || !main) return add([steady(duration, 0.6)]);
  // Time the main set leaves over: up to two minutes easy into it, the rest easy after.
  const easy = template.pad?.(p) ?? 0.6;
  const spare = duration - main.segments.reduce((t, s) => t + s.duration, 0);
  const before = Math.min(120, spare);
  return add([...(before > 0 ? [steady(before, easy)] : []), ...main.segments, ...(spare > before ? [steady(spare - before, easy)] : [])]);
}

/** Where an ERG hold's wattage starts: the last steady target you rode, else endurance pace. */
export function defaultExtendWatts(workout: Workout, ftp: number, intensity = 1): number {
  const last = [...workout.segments].reverse().find((s) => s.kind === "steady" && !s.allOut);
  const fraction = last?.kind === "steady" ? last.target : 0.6;
  return clampErg(Math.min(fraction, 0.75) * intensity * (ftp > 0 ? ftp : 250));
}
