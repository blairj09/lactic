// Experimental features: new parts of Lactic still being tried out, off until the rider turns them
// on in Settings → Experimental features. Each one is labelled Experimental wherever it shows, and
// may change or go away. Turning one off hides it; anything it saved stays.
//
// The shell loads the saved choice at start and keeps it here, so screens read it without waiting.

export interface Experiment {
  id: ExperimentId;
  title: string;
  line: string;
}

export type ExperimentId = "race_report" | "course_prep" | "adaptive_workouts";

export const EXPERIMENTS: Experiment[] = [
  {
    id: "race_report",
    title: "Race reports",
    line: "Compare a race with other riders' files, lap by lap. Opens from a race's ride page.",
  },
  {
    id: "course_prep",
    title: "Race courses",
    line: "Add a course file to a Plan event for a pre-race report and climb-specific workouts.",
  },
  {
    id: "adaptive_workouts",
    title: "Adaptive workouts",
    line: "Eases a workout that's clearly too hard, and asks before making an easy one harder.",
  },
];

export type Experiments = Record<ExperimentId, boolean>;

export const NO_EXPERIMENTS: Experiments = { race_report: false, course_prep: false, adaptive_workouts: false };
export const EXPERIMENTS_SETTING = "experiments";
export const EXPERIMENTS_EVENT = "lactic:experiments";

/** A saved value, with anything missing or not exactly true counted as off. */
export function parseExperiments(value: unknown): Experiments {
  const v = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  return { race_report: v.race_report === true, course_prep: v.course_prep === true, adaptive_workouts: v.adaptive_workouts === true };
}

let current: Experiments = NO_EXPERIMENTS;

export function experiments(): Experiments {
  return current;
}

/** Sets what's on for this session (the shell saves it); open screens follow. */
export function setCurrentExperiments(next: Experiments) {
  current = parseExperiments(next);
  globalThis.dispatchEvent?.(new Event(EXPERIMENTS_EVENT));
}
