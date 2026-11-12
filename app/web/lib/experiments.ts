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

export type ExperimentId = "race_report" | "strava_upload" | "course_prep" | "adaptive_workouts";

export const EXPERIMENTS: Experiment[] = [
  {
    id: "race_report",
    title: "Race reports",
    line: "Line your race up against other riders' files, lap by lap and corner by corner, to see where you lost time and what to work on. Long races that aren't laps (a point-to-point road race, a gran fondo) get pacing, fade, climbs, stops and your past years instead. Opens from a race's ride page.",
  },
  {
    id: "course_prep",
    title: "Race courses",
    line: "Attach a race's course file (GPX, TCX or FIT) to an event on the Plan. You get a pre-race report with the profile, the climbs and how hard to ride each one, fueling, and the forecast from two weeks out, and the plan's key workouts train for the course's climbs.",
  },
  {
    id: "adaptive_workouts",
    title: "Adaptive workouts",
    line: "During a workout, Lactic watches your cadence, heart rate and how you're riding. If a workout is clearly too hard, it eases the efforts still to come and offers Undo. If it looks too easy, it asks before making them harder. It never changes the effort you're in, FTP tests or race openers, and never more than 10%. Turn it off for one ride in the ride controls.",
  },
  {
    id: "strava_upload",
    title: "Post rides to Strava",
    line: "Rides you record in Lactic go to your Strava as Lactic activities, titled with the workout and described with how each interval went. Connect Strava in Settings → Connections.",
  },
];

export type Experiments = Record<ExperimentId, boolean>;

export const NO_EXPERIMENTS: Experiments = { race_report: false, strava_upload: false, course_prep: false, adaptive_workouts: false };
export const EXPERIMENTS_SETTING = "experiments";
export const EXPERIMENTS_EVENT = "lactic:experiments";

/** A saved value, with anything missing or not exactly true counted as off. */
export function parseExperiments(value: unknown): Experiments {
  const v = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  return { race_report: v.race_report === true, strava_upload: v.strava_upload === true, course_prep: v.course_prep === true, adaptive_workouts: v.adaptive_workouts === true };
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
