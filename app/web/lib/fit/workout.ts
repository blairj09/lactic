// Writes a structured workout as a FIT workout file, the format Garmin (and other head units that
// take workout files) load by hand. Power targets are a share of FTP, so the device uses the rider's
// own FTP. Ramps become short steps, repeated blocks become repeat steps to save room on devices
// that cap the step count. No browser or Node APIs, so it runs and tests anywhere.

import { FIT_SPORT_CYCLING } from "./decode";
import { FIT_MANUFACTURER_LACTIC, FIT_PRODUCT_NAME } from "./encode";
import { FIT_EPOCH, fitWriter, type FitMessage } from "./writer";
import { outdoorRange, outdoorWorkout } from "@/lib/engine/outdoor";
import type { Workout } from "@/lib/engine/workout";

const FILE_WORKOUT = 5;
const DURATION_TIME = 0;
const DURATION_REPEAT = 6;
const TARGET_OPEN = 2;
const TARGET_POWER = 4;
const INTENSITY = { active: 0, rest: 1, warmup: 2, cooldown: 3 } as const;
/** Below this share of FTP a step counts as recovery. */
const REST_BELOW = 0.6;
/** Longest block of steps looked at when folding repeats. */
const MAX_BLOCK = 4;

const MESSAGES = {
  fileId: { local: 0, global: 0, fields: [[0, "enum"], [1, "uint16"], [2, "uint16"], [3, "uint32z"], [4, "uint32"], [8, "string16"]] },
  workout: { local: 1, global: 26, fields: [[4, "enum"], [6, "uint16"], [8, "string32"]] },
  step: {
    local: 2,
    global: 27,
    fields: [[254, "uint16"], [0, "string16"], [1, "enum"], [2, "uint32"], [3, "enum"], [4, "uint32"], [5, "uint32"], [6, "uint32"], [7, "enum"]],
  },
} satisfies Record<string, FitMessage>;

/** One timed step, before repeats are folded. */
export interface FitStep {
  name: string;
  seconds: number;
  /** Power range as whole percent of FTP; null rides open (free ride, all out). */
  power: { low: number; high: number } | null;
  intensity: keyof typeof INTENSITY;
}

type Planned = FitStep | { repeatFrom: number; times: number };

/** The workout as timed FIT steps: ramps split into short steps, every steady target a range. */
export function workoutSteps(workout: Workout): FitStep[] {
  const segments = workout.segments.filter((s) => s.duration > 0);
  const firstWork = segments.findIndex((s) => s.kind === "steady" && s.target >= REST_BELOW);
  const lastWork = segments.findLastIndex((s) => s.kind === "steady" && s.target >= REST_BELOW);
  return segments.flatMap((segment, index): FitStep[] => {
    const seconds = Math.round(segment.duration);
    if (segment.kind === "freeRide") return [{ name: "Free ride", seconds, power: null, intensity: "active" }];
    if (segment.kind === "steady" && segment.allOut) return [{ name: "All out", seconds, power: null, intensity: "active" }];
    const warm = segment.kind === "ramp" ? index < Math.max(firstWork, 1) && segment.to >= segment.from : false;
    const cool = segment.kind === "ramp" ? index > lastWork && segment.to < segment.from : false;
    const parts = outdoorWorkout({ name: "", segments: [segment] }).segments;
    return parts.map((part) => {
      const target = part.kind === "steady" ? part.target : 0;
      const { low, high } = outdoorRange(target);
      return {
        name: warm ? "Warm up" : cool ? "Cool down" : segment.kind === "ramp" ? "Ramp" : target < REST_BELOW ? "Easy" : "Work",
        seconds: Math.round(part.duration),
        power: { low: Math.round(low * 100), high: Math.round(high * 100) },
        intensity: warm ? "warmup" : cool ? "cooldown" : target < REST_BELOW ? "rest" : "active",
      };
    });
  });
}

const same = (a: FitStep, b: FitStep) =>
  a.name === b.name && a.seconds === b.seconds && a.intensity === b.intensity && a.power?.low === b.power?.low && a.power?.high === b.power?.high;

/** Folds back-to-back copies of a block of steps into the block plus a repeat step. */
export function foldRepeats(steps: FitStep[]): Planned[] {
  const out: Planned[] = [];
  let i = 0;
  while (i < steps.length) {
    // The block size whose repeats save the most steps: (times - 1) * size go, one repeat step comes.
    let best = { size: 0, times: 1, saved: 0 };
    for (let size = 1; size <= MAX_BLOCK && i + size * 2 <= steps.length; size++) {
      let times = 1;
      while (i + size * (times + 1) <= steps.length && steps.slice(i, i + size).every((s, k) => same(s, steps[i + size * times + k]))) times++;
      const saved = (times - 1) * size - 1;
      if (saved > best.saved) best = { size, times, saved };
    }
    if (best.saved > 0) {
      const from = out.length;
      out.push(...steps.slice(i, i + best.size), { repeatFrom: from, times: best.times });
      i += best.size * best.times;
    } else {
      out.push(steps[i]);
      i++;
    }
  }
  return out;
}

export function encodeWorkoutFit(workout: Workout, createdAt = new Date()): Uint8Array {
  const { write, finish } = fitWriter();
  const steps = foldRepeats(workoutSteps(workout));
  const created = Math.round(createdAt.getTime() / 1000) - FIT_EPOCH;
  write(MESSAGES.fileId, [FILE_WORKOUT, FIT_MANUFACTURER_LACTIC, 0, 1, created, FIT_PRODUCT_NAME]);
  write(MESSAGES.workout, [FIT_SPORT_CYCLING, steps.length, workout.name || "Workout"]);
  steps.forEach((step, index) => {
    if ("repeatFrom" in step) {
      write(MESSAGES.step, [index, null, DURATION_REPEAT, step.repeatFrom, null, step.times, null, null, null]);
      return;
    }
    const target = step.power ? TARGET_POWER : TARGET_OPEN;
    // Power targets of 0-1000 are percent of FTP (1000 and up would be watts + 1000).
    write(MESSAGES.step, [
      index,
      step.name,
      DURATION_TIME,
      step.seconds * 1000,
      target,
      step.power ? 0 : null,
      step.power?.low ?? null,
      step.power?.high ?? null,
      INTENSITY[step.intensity],
    ]);
  });
  return finish();
}
