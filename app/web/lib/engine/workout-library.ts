// Lactic's starter workout library: fixed, named workouts written for Lactic (original, MIT like
// the rest of the app), covering every zone plus sprints and FTP tests. Each one is a Session the
// plan can schedule: its zone, a level worked out from its time in zone (the same scale as the
// engine's generated workouts in library.ts), length and planned stress. Targets are fractions of FTP.

import { openers, rampTest, ZONE_LABELS, MAX_LEVEL, MIN_LEVEL, type Session, type Zone } from "./library";
import { plannedStress, ramp, sprint, steady, workoutDuration, type Segment, type Workout } from "./workout";

/** How the library is browsed: the zones, with sprints and tests apart from the anaerobic and VO2 work they count as. */
export const LIBRARY_CATEGORIES = ["recovery", "endurance", "tempo", "sweetSpot", "threshold", "vo2max", "anaerobic", "sprints", "tests"] as const;
export type LibraryCategory = (typeof LIBRARY_CATEGORIES)[number];

export const LIBRARY_CATEGORY_LABELS: Record<LibraryCategory, string> = {
  ...ZONE_LABELS,
  sprints: "Sprints",
  tests: "FTP tests",
};

export interface LibraryWorkout {
  /** The starter workout's id, or the My workouts id when `custom` is set. */
  id: string;
  /** One of My workouts: zone and level worked out from its intervals (`customLibraryWorkout`). */
  custom?: true;
  category: LibraryCategory;
  /** The zone it trains, for levels and the plan. */
  zone: Zone;
  level: number;
  description: string;
  workout: Workout;
  /** Seconds. */
  duration: number;
  stress: number;
}

const min = (m: number) => Math.round(m * 60);
/** Minutes at a target. */
const at = (minutes: number, target: number) => steady(min(minutes), target);
/** Seconds at a target. */
const sec = (seconds: number, target: number) => steady(seconds, target);
const warmup = (minutes = 10): Segment => ramp(min(minutes), 0.45, 0.7);
const cooldown = (minutes = 5): Segment => ramp(min(minutes), 0.65, 0.4);
const easy = (minutes: number) => at(minutes, 0.55);

/** `block` `n` times with `between` after each but the last. */
function reps(n: number, block: Segment[], between: Segment[] = []): Segment[] {
  const out: Segment[] = [];
  for (let i = 0; i < n; i++) out.push(...block, ...(i < n - 1 ? between : []));
  return out;
}

/** `minutes` at `target` with a `burst` of seconds at `peak` closing every `every` seconds. */
function withBursts(minutes: number, target: number, every: number, burst: number, peak: number): Segment[] {
  return reps(Math.round(min(minutes) / every), [sec(every - burst, target), sec(burst, peak)]);
}

/** Target where a zone's work starts, for counting time in zone. */
const ZONE_FLOOR: Partial<Record<Zone, number>> = { tempo: 0.76, sweetSpot: 0.86, threshold: 0.95, vo2max: 1.06, anaerobic: 1.2 };

/** Minutes of work at each level, per zone: the totals the engine's generated workouts hold (templates.ts). */
const WORK_MINUTES: Partial<Record<Zone, (level: number) => number>> = {
  tempo: (l) => 20 + 7 * l,
  sweetSpot: (l) => 16 + 6 * l,
  threshold: (l) => 12 + 4 * l,
  vo2max: (l) => 8 + 1.6 * l,
  anaerobic: (l) => 3 + 0.6 * l,
};

/** Seconds of a workout at or above a target; ramps count at their average. */
function secondsFrom(workout: Workout, floor: number): number {
  return workout.segments.reduce((total, s) => {
    const target = s.kind === "steady" ? s.target : s.kind === "ramp" ? (s.from + s.to) / 2 : 0;
    return target >= floor - 1e-9 ? total + s.duration : total;
  }, 0);
}

/**
 * Level of an interval workout from its time in zone, on the generated workouts' scale: the level
 * whose main set holds that much work, to the nearest half, 1 to 10.
 */
export function levelFor(zone: Zone, workout: Workout): number | null {
  const floor = ZONE_FLOOR[zone];
  const work = WORK_MINUTES[zone];
  if (floor === undefined || !work) return null;
  const minutes = secondsFrom(workout, floor) / 60;
  const base = work(0);
  const perLevel = work(1) - base;
  const level = Math.round(((minutes - base) / perLevel) * 2) / 2;
  return Math.min(MAX_LEVEL, Math.max(MIN_LEVEL, level));
}

/** The 20-minute test's name, so a ride of it can set FTP (`twentyMinuteTestFtp`). */
export const TWENTY_MINUTE_TEST_NAME = "20-minute FTP test";

interface Entry {
  id: string;
  category: LibraryCategory;
  zone?: Zone;
  name: string;
  description: string;
  segments: Segment[];
  /** Set for steady rides, sprints and workouts whose difficulty the time in zone doesn't show (short on-off efforts). */
  level?: number;
}

const ENTRIES: Entry[] = [
  // Recovery: easy spinning, level 1.
  { id: "recovery-30", category: "recovery", name: "Easy spin 30", description: "Half an hour of easy pedaling to loosen the legs.", segments: [ramp(min(5), 0.4, 0.5), at(22, 0.5), ramp(min(3), 0.5, 0.4)] },
  {
    id: "recovery-openers-45",
    category: "recovery",
    name: "Easy spin with leg openers",
    description: "Easy spinning with five one-minute pickups to wake the legs without tiring them.",
    segments: [ramp(min(5), 0.4, 0.5), at(10, 0.5), ...reps(5, [at(1, 0.62), at(1, 0.5)]), at(15, 0.5), cooldown()],
  },
  { id: "recovery-60", category: "recovery", name: "Recovery hour", description: "A full hour, all of it easy. For the day after a hard one.", segments: [ramp(min(5), 0.4, 0.52), at(50, 0.52), cooldown()] },

  // Endurance: steady aerobic riding; levels set by length and pace.
  { id: "endurance-60", category: "endurance", name: "Steady endurance 60", description: "An hour at a pace you could hold all day.", segments: [warmup(), at(45, 0.65), cooldown()], level: 3 },
  { id: "endurance-surges-60", category: "endurance", name: "Endurance with surges", description: "Steady riding with a one-minute tempo surge every nine minutes.", segments: [warmup(), ...reps(5, [at(8, 0.65), at(1, 0.85)]), cooldown()], level: 3.5 },
  { id: "endurance-rolling-75", category: "endurance", name: "Rolling endurance", description: "Like a rolling road: seven minutes easy, three minutes steadier, six times.", segments: [warmup(), ...reps(6, [at(7, 0.62), at(3, 0.74)]), cooldown()], level: 4 },
  { id: "endurance-90", category: "endurance", name: "Steady endurance 90", description: "Ninety minutes of aerobic base.", segments: [warmup(), at(75, 0.67), cooldown()], level: 4.5 },
  { id: "endurance-build-90", category: "endurance", name: "Endurance build", description: "Three 25-minute steps, each a little firmer than the last.", segments: [warmup(), at(25, 0.62), at(25, 0.67), at(25, 0.72), cooldown()], level: 5 },
  { id: "endurance-120", category: "endurance", name: "Long endurance 2 h", description: "Two hours of steady riding. Eat and drink as you go.", segments: [warmup(), at(105, 0.66), cooldown()], level: 5.5 },
  {
    id: "endurance-tempo-150",
    category: "endurance",
    name: "Long ride with tempo",
    description: "Two and a half hours, with two 15-minute tempo blocks in the second half.",
    segments: [warmup(), at(70, 0.65), at(15, 0.8), at(15, 0.65), at(15, 0.8), at(20, 0.63), cooldown()],
    level: 6.5,
  },
  { id: "endurance-180", category: "endurance", name: "Long endurance 3 h", description: "Three hours of steady riding for big base weeks.", segments: [warmup(), at(165, 0.64), cooldown()], level: 7 },

  // Tempo.
  { id: "tempo-3x10", category: "tempo", name: "Tempo 3 × 10", description: "Three 10-minute tempo blocks: a first step above endurance.", segments: [warmup(), ...reps(3, [at(10, 0.82)], [easy(5)]), at(5, 0.6), cooldown()] },
  {
    id: "tempo-bursts-60",
    category: "tempo",
    name: "Tempo with bursts",
    description: "Forty minutes of tempo with a 20-second push every two minutes, as when holding a wheel.",
    segments: [warmup(), ...withBursts(20, 0.8, 120, 20, 1.1), easy(5), ...withBursts(20, 0.8, 120, 20, 1.1), cooldown()],
  },
  { id: "tempo-45", category: "tempo", name: "Tempo 45", description: "Forty-five unbroken minutes of tempo. Settle in and hold it.", segments: [warmup(), at(45, 0.8), cooldown()] },
  { id: "tempo-2x20", category: "tempo", name: "Tempo 2 × 20", description: "Two 20-minute tempo blocks.", segments: [warmup(), ...reps(2, [at(20, 0.83)], [easy(5)]), at(10, 0.62), cooldown()] },
  { id: "tempo-2x30", category: "tempo", name: "Tempo 2 × 30", description: "Two half-hour tempo blocks for muscular endurance.", segments: [warmup(), ...reps(2, [at(30, 0.82)], [easy(5)]), cooldown()] },
  { id: "tempo-3x20", category: "tempo", name: "Tempo 3 × 20", description: "An hour of tempo in three blocks.", segments: [warmup(), ...reps(3, [at(20, 0.84)], [easy(5)]), cooldown()] },
  { id: "tempo-4x20", category: "tempo", name: "Tempo 4 × 20", description: "Eighty minutes of tempo. A big day for long-event riders.", segments: [warmup(), ...reps(4, [at(20, 0.84)], [easy(5)]), cooldown()] },

  // Sweet spot.
  { id: "sweetspot-3x10", category: "sweetSpot", name: "Sweet spot 3 × 10", description: "Three 10-minute sweet spot efforts: a good first sweet spot workout.", segments: [warmup(), ...reps(3, [at(10, 0.89)], [easy(5)]), at(5, 0.6), cooldown()] },
  {
    id: "sweetspot-overunder",
    category: "sweetSpot",
    name: "Sweet spot over-unders",
    description: "Three 12-minute blocks that swing between sweet spot and just under threshold.",
    segments: [warmup(), ...reps(3, reps(4, [at(2, 0.88), at(1, 0.97)]), [easy(5)]), at(9, 0.6), cooldown()],
  },
  { id: "sweetspot-2x20", category: "sweetSpot", name: "Sweet spot 2 × 20", description: "Two 20-minute sweet spot intervals.", segments: [warmup(), ...reps(2, [at(20, 0.9)], [easy(5)]), cooldown()] },
  {
    id: "sweetspot-surges",
    category: "sweetSpot",
    name: "Sweet spot with surges",
    description: "Two 20-minute sweet spot efforts with a 15-second surge every two minutes.",
    segments: [warmup(), ...withBursts(20, 0.89, 120, 15, 1.3), easy(5), ...withBursts(20, 0.89, 120, 15, 1.3), cooldown()],
  },
  { id: "sweetspot-3x15", category: "sweetSpot", name: "Sweet spot 3 × 15", description: "Three 15-minute sweet spot intervals.", segments: [warmup(), ...reps(3, [at(15, 0.9)], [easy(5)]), cooldown()] },
  {
    id: "sweetspot-ladder",
    category: "sweetSpot",
    name: "Sweet spot ladder",
    description: "Up and back down a ladder: 5, 10, 15, 10 and 5 minutes of sweet spot.",
    segments: [warmup(), ...[5, 10, 15, 10, 5].flatMap((m, i, all) => [at(m, 0.9), ...(i < all.length - 1 ? [easy(3)] : [])]), at(3, 0.6), cooldown()],
  },
  { id: "sweetspot-3x20", category: "sweetSpot", name: "Sweet spot 3 × 20", description: "An hour of sweet spot in three blocks.", segments: [warmup(), ...reps(3, [at(20, 0.9)], [easy(5)]), cooldown()] },
  { id: "sweetspot-2x30", category: "sweetSpot", name: "Sweet spot 2 × 30", description: "Two half-hour sweet spot efforts. Long, steady and tough.", segments: [warmup(), ...reps(2, [at(30, 0.89)], [easy(5)]), cooldown()] },

  // Threshold.
  { id: "threshold-3x8", category: "threshold", name: "Threshold 3 × 8", description: "Three 8-minute efforts at FTP with plenty of rest.", segments: [warmup(), ...reps(3, [at(8, 1)], [easy(4)]), at(13, 0.6), cooldown()] },
  {
    id: "threshold-overunder",
    category: "threshold",
    name: "Threshold over-unders",
    description: "Three 9-minute blocks: two minutes just under FTP, one minute over, three times.",
    segments: [warmup(), ...reps(3, reps(3, [at(2, 0.95), at(1, 1.08)]), [easy(5)]), at(8, 0.6), cooldown()],
  },
  { id: "threshold-2x15", category: "threshold", name: "Threshold 2 × 15", description: "Two 15-minute efforts at FTP.", segments: [warmup(), ...reps(2, [at(15, 0.98)], [easy(5)]), at(10, 0.6), cooldown()] },
  {
    id: "threshold-hardstarts",
    category: "threshold",
    name: "Threshold hard starts",
    description: "Four 8-minute efforts that open with 30 seconds hard, then settle at FTP.",
    segments: [warmup(), ...reps(4, [sec(30, 1.3), sec(450, 0.98)], [easy(4)]), at(6, 0.6), cooldown()],
  },
  { id: "threshold-3x12", category: "threshold", name: "Threshold 3 × 12", description: "Three 12-minute efforts at FTP.", segments: [warmup(), ...reps(3, [at(12, 0.98)], [easy(6)]), at(2, 0.6), cooldown()] },
  { id: "threshold-2x20", category: "threshold", name: "Threshold 2 × 20", description: "Two 20-minute efforts at FTP: the classic.", segments: [warmup(), ...reps(2, [at(20, 0.97)], [easy(10)]), at(5, 0.6), cooldown()] },
  { id: "threshold-3x15", category: "threshold", name: "Threshold 3 × 15", description: "Forty-five minutes at FTP in three blocks.", segments: [warmup(), ...reps(3, [at(15, 0.97)], [easy(5)]), cooldown()] },

  // VO2 max.
  { id: "vo2-6x2", category: "vo2max", name: "VO2 max 6 × 2", description: "Six 2-minute efforts well above FTP, with equal rest.", segments: [warmup(), ...reps(6, [at(2, 1.18)], [at(2, 0.5)]), at(8, 0.6), cooldown()] },
  {
    id: "vo2-30-30",
    category: "vo2max",
    name: "30/30s",
    description: "Two sets of ten: 30 seconds hard, 30 seconds easy.",
    segments: [warmup(), ...reps(2, reps(10, [sec(30, 1.2), sec(30, 0.5)]), [easy(5)]), at(10, 0.6), cooldown()],
    level: 3,
  },
  { id: "vo2-5x3", category: "vo2max", name: "VO2 max 5 × 3", description: "Five 3-minute efforts with three minutes easy between.", segments: [warmup(), ...reps(5, [at(3, 1.15)], [at(3, 0.5)]), at(18, 0.6), cooldown()] },
  { id: "vo2-4x4", category: "vo2max", name: "VO2 max 4 × 4", description: "Four 4-minute efforts with four minutes easy between.", segments: [warmup(), ...reps(4, [at(4, 1.13)], [at(4, 0.5)]), at(17, 0.6), cooldown()] },
  {
    id: "vo2-40-20",
    category: "vo2max",
    name: "40/20s",
    description: "Three sets of eight: 40 seconds hard, 20 seconds easy.",
    segments: [warmup(), ...reps(3, reps(8, [sec(40, 1.2), sec(20, 0.5)]), [easy(5)]), at(11, 0.6), cooldown()],
    level: 5.5,
  },
  {
    id: "vo2-pyramid",
    category: "vo2max",
    name: "VO2 max pyramid",
    description: "1, 2, 3, 4, 3, 2 and 1 minutes hard, each followed by as long easy.",
    segments: [warmup(), ...[1, 2, 3, 4, 3, 2, 1].flatMap((m, i, all) => [at(m, 1.15), ...(i < all.length - 1 ? [at(m, 0.5)] : [])]), at(14, 0.6), cooldown()],
  },
  { id: "vo2-5x5", category: "vo2max", name: "VO2 max 5 × 5", description: "Five 5-minute efforts. Long VO2 work for experienced riders.", segments: [warmup(), ...reps(5, [at(5, 1.08)], [at(5, 0.5)]), cooldown()], level: 8.5 },
  { id: "openers-45", category: "vo2max", name: "Race openers", description: "A short ride with three hard minutes to wake the legs a day or two before a race.", segments: [] },

  // Anaerobic.
  {
    id: "anaerobic-attacks",
    category: "anaerobic",
    name: "Attacks on tempo",
    description: "Three 8-minute tempo blocks with a 20-second attack every two minutes.",
    segments: [warmup(), ...reps(3, withBursts(8, 0.85, 120, 20, 1.6), [easy(5)]), at(11, 0.6), cooldown()],
    level: 3.5,
  },
  {
    id: "anaerobic-microbursts",
    category: "anaerobic",
    name: "Micro-bursts",
    description: "Three sets of ten: 15 seconds hard, 15 seconds easy.",
    segments: [warmup(), ...reps(3, reps(10, [sec(15, 1.5), sec(15, 0.5)]), [easy(5)]), at(20, 0.6), cooldown()],
    level: 4,
  },
  { id: "anaerobic-6x1", category: "anaerobic", name: "Anaerobic 6 × 1", description: "Six one-minute efforts far above FTP, with three minutes easy between.", segments: [warmup(), ...reps(6, [at(1, 1.3)], [at(3, 0.5)]), at(24, 0.6), cooldown()] },
  {
    id: "anaerobic-10x40s",
    category: "anaerobic",
    name: "Anaerobic 10 × 40 s",
    description: "Ten 40-second efforts with plenty of rest, for punchy climbs and attacks.",
    segments: [warmup(), ...reps(10, [sec(40, 1.4), sec(140, 0.5)]), at(15, 0.6), cooldown()],
  },

  // Sprints: ridden all out, with ERG let go.
  {
    id: "sprints-10x10s",
    category: "sprints",
    zone: "anaerobic",
    name: "Short sprints 10 × 10 s",
    description: "Ten 10-second sprints with nearly three minutes easy between. Quality over fatigue.",
    segments: [warmup(), at(5, 0.65), ...reps(10, [sprint(10, 2), sec(170, 0.55)]), at(10, 0.6), cooldown()],
    level: 1.5,
  },
  {
    id: "sprints-8x15s",
    category: "sprints",
    zone: "anaerobic",
    name: "Sprints 8 × 15 s",
    description: "Eight 15-second all-out sprints with nearly five minutes of easy riding between.",
    segments: [warmup(), ...reps(8, [sprint(15, 2), sec(285, 0.55)]), at(5, 0.6), cooldown()],
    level: 2,
  },
  {
    id: "sprints-6x20s",
    category: "sprints",
    zone: "anaerobic",
    name: "Sprints 6 × 20 s",
    description: "Six longer sprints, held to the line, with five minutes easy between.",
    segments: [warmup(), ...reps(6, [sprint(20, 1.9), sec(280, 0.55)]), at(10, 0.6), cooldown()],
    level: 3,
  },
  {
    id: "sprints-leadout",
    category: "sprints",
    zone: "anaerobic",
    name: "Lead-out sprints",
    description: "Five race finishes: 45 seconds winding up, then a 15-second sprint.",
    segments: [warmup(), ...reps(5, [sec(45, 1.1), sprint(15, 1.9)], [at(5, 0.55)]), at(10, 0.6), cooldown()],
    level: 4,
  },

  // Tests.
  { id: "test-ramp", category: "tests", name: "Ramp test", description: "One-minute steps that get harder until you can't hold them. Sets FTP from your best minute.", segments: [] },
  {
    id: "test-20min",
    category: "tests",
    zone: "threshold",
    name: TWENTY_MINUTE_TEST_NAME,
    description: "Warm up, open the legs, then ride 20 minutes as hard as you can hold. Sets FTP to 95% of it.",
    segments: [
      warmup(),
      ...reps(3, [at(1, 1)], [at(1, 0.55)]),
      at(1, 0.55),
      at(5, 1.05),
      at(9, 0.5),
      { kind: "steady", duration: min(20), target: 1.05, allOut: true },
      ramp(min(10), 0.6, 0.4),
    ],
    level: 1,
  },
];

/** The library's 20-minute test, unedited. */
export const isTwentyMinuteTest = (workout: Workout) => workout.name === TWENTY_MINUTE_TEST_NAME;

function toLibrary(entry: Entry): LibraryWorkout {
  // The engine's own sessions where they exist, so the ramp test still sets FTP and openers match the plan's.
  const built = entry.id === "test-ramp" ? rampTest() : entry.id === "openers-45" ? openers(2700) : null;
  const workout: Workout = built ? built.workout : { name: entry.name, segments: entry.segments };
  const zone: Zone = built ? built.zone : (entry.zone ?? (entry.category as Zone));
  const level = built ? built.level : (entry.level ?? levelFor(zone, workout) ?? 1);
  return {
    id: entry.id,
    category: entry.category,
    zone,
    level,
    description: entry.description,
    workout,
    duration: workoutDuration(workout),
    stress: Math.round(plannedStress(workout) * 10) / 10,
  };
}

export const WORKOUT_LIBRARY: LibraryWorkout[] = ENTRIES.map(toLibrary);

export const libraryWorkout = (id: string | null | undefined): LibraryWorkout | null => (id ? (WORKOUT_LIBRARY.find((w) => w.id === id) ?? null) : null);

/** A library workout (or one of My workouts) as a session to ride or schedule. */
export function librarySession(entry: LibraryWorkout): Session {
  const base = { zone: entry.zone, level: entry.level, workout: entry.workout, duration: entry.duration, stress: entry.stress };
  return entry.custom ? { ...base, custom: entry.id } : { ...base, library: entry.id };
}

/** Where each zone's band of targets starts (fractions of FTP); recovery is everything below endurance. Anaerobic starts above 120% so 30/30s there read as VO2 max. */
const BANDS: [Zone, number][] = [
  ["anaerobic", 1.25],
  ["vo2max", 1.06],
  ["threshold", 0.95],
  ["sweetSpot", 0.86],
  ["tempo", 0.76],
  ["endurance", 0.55],
  ["recovery", 0],
];
/** Below this share of a mid-level workout's work, efforts don't make an interval workout of it. */
const MIN_WORK_SHARE = 0.25;

const bandOf = (target: number): Zone => BANDS.find(([, from]) => target >= from - 1e-9)![0];

/**
 * The zone a workout trains, from its work (time at tempo or above): the band its middle second of
 * work falls in (so short surges in a sweet spot workout, or the overs of over-unders, don't move it),
 * provided it holds at least a quarter of a mid-level workout's work in that zone (level 5 in
 * WORK_MINUTES); else endurance when at least half its time is at endurance pace or above, else
 * recovery. Free-ride time counts for nothing; a workout that's mostly free ride has no zone (null).
 */
export function zoneFor(workout: Workout): Zone | null {
  const work: { target: number; duration: number }[] = [];
  let total = 0;
  let structured = 0;
  let aerobic = 0;
  for (const s of workout.segments) {
    total += s.duration;
    if (s.kind === "freeRide") continue;
    structured += s.duration;
    const target = s.kind === "steady" ? s.target : (s.from + s.to) / 2;
    if (target >= 0.55 - 1e-9) aerobic += s.duration;
    if (target >= 0.76 - 1e-9) work.push({ target, duration: s.duration });
  }
  if (total <= 0 || structured < total / 2) return null;
  const workSeconds = work.reduce((sum, w) => sum + w.duration, 0);
  if (workSeconds > 0) {
    work.sort((a, b) => a.target - b.target);
    let seen = 0;
    const middle = work.find((w) => (seen += w.duration) >= workSeconds / 2)!;
    const zone = bandOf(middle.target);
    const typical = WORK_MINUTES[zone]?.(5);
    if (typical && workSeconds >= MIN_WORK_SHARE * typical * 60) return zone;
  }
  return aerobic >= total / 2 ? "endurance" : "recovery";
}

/** Endurance levels go by length, as the starter library's do: about 3.5 for an hour, 5 for two, 7 for three. */
const enduranceLevel = (seconds: number) => Math.min(MAX_LEVEL, Math.max(MIN_LEVEL, Math.round((1.5 + seconds / 1920) * 2) / 2));

/** One of My workouts as the plan and coach see it: its zone and level worked out from its intervals. Null when it has no zone. */
export function customLibraryWorkout(id: string, workout: Workout): LibraryWorkout | null {
  const zone = zoneFor(workout);
  if (!zone) return null;
  const duration = workoutDuration(workout);
  const level = zone === "recovery" ? 1 : zone === "endurance" ? enduranceLevel(duration) : (levelFor(zone, workout) ?? 1);
  return {
    id,
    custom: true,
    category: zone,
    zone,
    level,
    description: "One of your workouts.",
    workout,
    duration,
    stress: Math.round(plannedStress(workout) * 10) / 10,
  };
}

/** A workout from a favorite-style key (`library:<id>` or `custom:<id>`), with My workouts given. Null when it's gone. */
export function workoutByKey(key: string, customs: readonly { id: string; workout: Workout }[]): LibraryWorkout | null {
  if (key.startsWith("library:")) return libraryWorkout(key.slice(8));
  if (key.startsWith("custom:")) {
    const found = customs.find((c) => c.id === key.slice(7));
    return found ? customLibraryWorkout(found.id, found.workout) : null;
  }
  return null;
}

/** The key a library workout or one of My workouts is stored and named by. */
export const keyOf = (entry: Pick<LibraryWorkout, "id" | "custom">) => (entry.custom ? customKey(entry.id) : libraryKey(entry.id));

/** Favorite workouts the plan and coach can use: starter ones and My workouts, newest favorite first. */
export function favoriteWorkouts(keys: Iterable<string>, customs: readonly { id: string; workout: Workout }[]): LibraryWorkout[] {
  return [...keys].flatMap((k) => workoutByKey(k, customs) ?? []);
}

/** How close to its slot a library workout must run for the plan to use it: within this many seconds under, never over. */
const FIT_UNDER_SECONDS = 15 * 60;
/** And how far from the planned level. */
const FIT_LEVELS = 1;

/** Whether a library workout (or one of My workouts) can stand in for a session: see `libraryFits`. */
export const fitsSlot = (w: LibraryWorkout, zone: Zone, level: number, seconds: number) =>
  w.category !== "tests" &&
  !(w.id === "openers-45" && !w.custom) &&
  w.zone === zone &&
  w.duration <= seconds + 1e-9 &&
  w.duration >= seconds - FIT_UNDER_SECONDS &&
  Math.abs(w.level - level) <= FIT_LEVELS;

/**
 * Library workouts that could stand in for a session the plan built: same zone (tests and openers
 * never), no longer than the slot and at most 15 minutes shorter, within a level of it. `pool` is
 * starter ids or workouts (favorites, My workouts included); the whole starter library when left out.
 */
export function libraryFits(zone: Zone, level: number, seconds: number, pool?: Iterable<string | LibraryWorkout>): LibraryWorkout[] {
  const workouts = pool ? [...pool].flatMap((w) => (typeof w === "string" ? (libraryWorkout(w) ?? []) : w)) : WORKOUT_LIBRARY;
  return workouts.filter((w) => fitsSlot(w, zone, level, seconds));
}

/** Favorites are stored as keys: a library workout or one of My workouts. */
export const libraryKey = (id: string) => `library:${id}`;
export const customKey = (id: string) => `custom:${id}`;

/** Library ids among favorite keys. */
export const favoriteLibraryIds = (keys: Iterable<string>): string[] => [...keys].flatMap((k) => (k.startsWith("library:") && libraryWorkout(k.slice(8)) ? [k.slice(8)] : []));
