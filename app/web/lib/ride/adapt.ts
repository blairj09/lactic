// Adaptive workouts (experimental): while a workout is under way, read how each hard rep went and
// change the reps of the same kind still to come. Pure, so it tests in Node and runs anywhere.
//
// The science it follows:
// - Struggling is easy to see and changes things on its own: cadence fading at the end of a rep
//   (in ERG the trainer forces the watts, so cadence is what gives), riding well under target with
//   ERG off, stopping mid-rep, and heart rate drifting up or not coming down between reps.
// - Too easy is hard to see from sensors (a low heart rate can be fatigue as much as freshness), so
//   it's only ever suggested, never applied without the rider's tap.
// - Heart rate lags the power by a minute or more, so it's never read on a rep under 3 minutes.
// - Small steps (4%), never more than 10% either way over the workout, never the rep under way.

import type { Workout } from "../engine/workout";

/** Easiest target that counts as a hard rep: sweet spot and up. */
export const REP_FROM = 0.85;
/** Shortest rep worth adapting. */
export const REP_MIN_SECONDS = 60;
/** Heart rate is only read on reps at least this long: it takes a minute or two to catch up. */
export const HR_REP_SECONDS = 180;
/** One change. */
export const STEP = 0.04;
/** The most a workout's reps move either way. */
export const MAX_CHANGE = 0.1;
/** How long an ease offers Undo. */
export const UNDO_SECONDS = 20;
/** Seconds into the recovery to read how far heart rate came down. */
const RECOVERY_READ = 60;

/** Thresholds, named so the reasons and tests read the same. */
export const CADENCE_FADE_RPM = 10;
export const POWER_UNDER = 0.92;
export const POWER_OVER = 1.04;
export const HR_DRIFT_BPM = 8;
export const HR_DROP_LOW = 20;
export const HR_UNDER_BPM = 10;

/** A hard rep in the workout: segment index, where it sits, and its planned target (fraction of FTP). */
export interface Rep {
  index: number;
  start: number;
  end: number;
  target: number;
}

/** Workouts that are never adapted: tests and race openers. */
export function adaptable(workout: Workout): boolean {
  return !/^(ramp test|20[- ]min|ftp test|openers)/i.test(workout.name.trim());
}

/** Hard steady reps, from the workout as planned (before any adapting), in order. */
export function workReps(workout: Workout): Rep[] {
  const reps: Rep[] = [];
  let start = 0;
  workout.segments.forEach((s, index) => {
    const end = start + s.duration;
    if (s.kind === "steady" && !s.hold && !s.opener && !s.allOut && s.target >= REP_FROM && s.target < 2 && s.duration >= REP_MIN_SECONDS)
      reps.push({ index, start, end, target: s.target });
    start = end;
  });
  return reps;
}

/** Reps of the same kind: targets within 5% and lengths within a factor of two. */
export function sameKind(a: Rep, b: Rep): boolean {
  const ratio = (a.end - a.start) / (b.end - b.start);
  return Math.abs(a.target - b.target) <= 0.05 * b.target && ratio >= 0.5 && ratio <= 2;
}

/** The ride so far, one value per ridden second (paused seconds aren't in it). */
export interface RideSoFar {
  power: number[];
  heartRate: number[];
  cadence: number[];
  target: (number | null)[];
  /** Segment index each second was in (-1 for none). */
  interval: number[];
}

/** What a finished rep showed. Null where there's nothing to read. */
export interface RepRead {
  index: number;
  seconds: number;
  /** rpm lost from the first two thirds of the rep to the last third. */
  cadence: { early: number; late: number } | null;
  /** Mean power over mean target. */
  powerRatio: number | null;
  /** Mean heart rate over the last third (only on reps of HR_REP_SECONDS or more). */
  hrEnd: number | null;
  /** How far heart rate came down in the first minute after the rep. */
  hrDrop: number | null;
  /** The rider paused during the rep. */
  paused: boolean;
}

const mean = (values: number[]) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : null);
const positive = (values: number[]) => values.filter((v) => v > 0);

/**
 * Reads a rep from the ride's seconds. `pausedIn` lists segment indexes the rider paused in (the
 * ride clock stops while paused, so the seconds alone can't tell).
 */
export function readRep(ride: RideSoFar, rep: Rep, pausedIn: ReadonlySet<number> = new Set()): RepRead {
  const at: number[] = [];
  ride.interval.forEach((i, s) => i === rep.index && at.push(s));
  const seconds = at.length;
  const third = Math.floor(seconds / 3);
  const early = at.slice(0, seconds - third);
  const late = at.slice(seconds - third);
  const pick = (values: number[], idx: number[]) => idx.map((s) => values[s] ?? 0);

  const cadenceEarly = mean(positive(pick(ride.cadence, early)));
  const cadenceLate = mean(positive(pick(ride.cadence, late)));
  const watts = mean(pick(ride.power, at));
  const target = mean(at.map((s) => ride.target[s] ?? 0).filter((t) => t > 0));
  const hrLate = seconds >= HR_REP_SECONDS ? mean(positive(pick(ride.heartRate, late))) : null;

  // Heart rate at the rep's end (last 10 s) against 50-60 s into what follows.
  let hrDrop: number | null = null;
  const last = at[at.length - 1];
  if (last !== undefined && ride.interval.length > last + RECOVERY_READ) {
    const end = mean(positive(pick(ride.heartRate, at.slice(-10))));
    const after = Array.from({ length: 10 }, (_, k) => last + RECOVERY_READ - 9 + k);
    const easy = after.every((s) => ride.interval[s] !== rep.index);
    const then = mean(positive(pick(ride.heartRate, after)));
    if (end !== null && then !== null && easy) hrDrop = Math.round(end - then);
  }

  return {
    index: rep.index,
    seconds,
    cadence: cadenceEarly !== null && cadenceLate !== null && late.length >= 10 ? { early: Math.round(cadenceEarly), late: Math.round(cadenceLate) } : null,
    powerRatio: watts !== null && target ? watts / target : null,
    hrEnd: hrLate === null ? null : Math.round(hrLate),
    hrDrop,
    paused: pausedIn.has(rep.index),
  };
}

/**
 * When a rep is read: a minute into the recovery when one that long follows (so heart rate has had
 * time to come down), else as it ends. Only while a later rep of its kind is still to come.
 */
export function readAt(workout: Workout, rep: Rep): number {
  const next = workout.segments[rep.index + 1];
  const easy = next && !(next.kind === "steady" && next.target >= REP_FROM);
  return easy && next.duration >= RECOVERY_READ + 15 ? rep.end + RECOVERY_READ : rep.end;
}

/** Heart rate a rep like this would usually end at, from threshold heart rate: an estimate. */
export function expectedHr(thresholdHr: number, rep: Rep): number {
  const level = Math.min(1.03, 0.72 + 0.28 * rep.target);
  const seconds = rep.end - rep.start;
  const settle = seconds >= 480 ? 1 : 0.95 + (0.05 * seconds) / 480;
  return Math.round(thresholdHr * level * settle);
}

export type Change = {
  kind: "ease" | "bump";
  /** Segment indexes of the later reps it changes. */
  reps: number[];
  /** The factor those reps go to (1 is as planned). */
  factor: number;
  /** Whole percent the change moves them by. */
  percent: number;
  /** Plain words, most telling first. */
  reasons: string[];
};

export interface Judge {
  /** Every hard rep, as planned. */
  reps: Rep[];
  /** The rep just read. */
  rep: Rep;
  /** Reads of the reps of its kind so far, in order, including this one. */
  reads: RepRead[];
  /** Where the workout is now (seconds). */
  position: number;
  /** Factor each segment is at now (missing is 1). */
  factors: ReadonlyMap<number, number>;
  ergOn: boolean;
  thresholdHr: number | null;
  /** The rider moved the intensity since the last read: they're steering, so hands off. */
  riderSteered: boolean;
  /** A bump for this kind of rep was turned down already, or an ease undone: don't ask again. */
  bumpDeclined: boolean;
  /** An ease of this kind of rep was undone: don't ease it again on its own. */
  easeUndone: boolean;
}

const pct = (x: number) => Math.round(x * 100);
const round2 = (x: number) => Math.round(x * 100) / 100;

/** Easier, harder (to suggest) or no change after a rep. */
export function judge(j: Judge): Change | null {
  if (j.riderSteered) return null;
  const later = j.reps.filter((r) => r.start > j.position && sameKind(r, j.rep));
  if (!later.length) return null;
  const factor = j.factors.get(later[0].index) ?? 1;
  const read = j.reads[j.reads.length - 1];
  const first = j.reads[0];
  const repNo = j.reads.length;

  // Too hard: points, most telling first.
  const signs: [number, string][] = [];
  if (read.cadence && read.cadence.early - read.cadence.late >= CADENCE_FADE_RPM)
    signs.push([2, `Cadence fell from ${read.cadence.early} to ${read.cadence.late} rpm at the end of rep ${repNo}.`]);
  if (!j.ergOn && read.powerRatio !== null && read.powerRatio < POWER_UNDER) signs.push([2, `You rode ${100 - pct(read.powerRatio)}% under the target in rep ${repNo}.`]);
  if (read.paused) signs.push([1, `You stopped during rep ${repNo}.`]);
  if (read.hrEnd !== null && first !== read && first.hrEnd !== null && read.hrEnd - first.hrEnd >= HR_DRIFT_BPM)
    signs.push([1, `Heart rate ended ${read.hrEnd - first.hrEnd} bpm higher than in rep 1 for the same effort.`]);
  if (read.hrDrop !== null && read.hrDrop < HR_DROP_LOW && (first === read || first.hrDrop === null || first.hrDrop - read.hrDrop >= 5))
    signs.push([1, `Heart rate came down only ${read.hrDrop} bpm in the first minute easy.`]);
  const points = signs.reduce((n, [p]) => n + p, 0);

  if (points >= 2) {
    if (j.easeUndone) return null;
    const next = round2(Math.max(1 - MAX_CHANGE, factor - STEP));
    if (next >= factor) return null;
    return { kind: "ease", reps: later.map((r) => r.index), factor: next, percent: pct(factor - next), reasons: signs.sort((a, b) => b[0] - a[0]).map(([, w]) => w) };
  }
  if (points > 0 || j.bumpDeclined || factor < 1) return null;

  // Too easy: only suggested, and only on clear evidence over the last two reps of the kind.
  if (j.reads.length < 2) return null;
  const [prev, last] = j.reads.slice(-2);
  const steady = [prev, last].every((r) => !r.paused && (!r.cadence || r.cadence.early - r.cadence.late <= 4));
  if (!steady) return null;
  let reason: string | null = null;
  if (!j.ergOn) {
    if (prev.powerRatio !== null && last.powerRatio !== null && prev.powerRatio >= POWER_OVER && last.powerRatio >= POWER_OVER)
      reason = `You rode ${pct(Math.min(prev.powerRatio, last.powerRatio)) - 100}% over the target on the last two reps.`;
  } else if (j.thresholdHr) {
    const expected = expectedHr(j.thresholdHr, j.rep);
    const ends = [prev.hrEnd, last.hrEnd];
    const calm = ends.every((h) => h !== null && h <= expected - HR_UNDER_BPM);
    const flat = prev.hrEnd !== null && last.hrEnd !== null && last.hrEnd - prev.hrEnd <= 3;
    const recovers = prev.hrDrop === null || prev.hrDrop >= 25;
    if (calm && flat && recovers) reason = `Heart rate stayed about ${expected - Math.max(prev.hrEnd!, last.hrEnd!)} bpm under where reps like this usually put you, and steady.`;
  }
  if (!reason) return null;
  const next = round2(Math.min(1 + MAX_CHANGE, factor + STEP));
  if (next <= factor) return null;
  return { kind: "bump", reps: later.map((r) => r.index), factor: next, percent: pct(next - factor), reasons: [reason] };
}

/** The workout with each segment's target scaled by its factor. */
export function applyFactors(workout: Workout, factors: ReadonlyMap<number, number>): Workout {
  if (!factors.size) return workout;
  return {
    ...workout,
    segments: workout.segments.map((s, i) => {
      const f = factors.get(i);
      return f === undefined || f === 1 || s.kind !== "steady" ? s : { ...s, target: s.target * f };
    }),
  };
}

/** A change as it ended up, kept with the ride so its page can say what changed and why. */
export interface Adaptation {
  /** Ride second it was made. */
  at: number;
  kind: "ease" | "bump";
  percent: number;
  /** Interval numbers (1-based) it changed. */
  intervals: number[];
  reasons: string[];
  /** applied: eased and kept; undone: eased then undone; accepted: bump taken; declined: bump turned down or let go. */
  outcome: "applied" | "undone" | "accepted" | "declined";
}

/** Reads saved adaptations, dropping anything malformed. */
export function readAdaptations(value: unknown): Adaptation[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((a) => {
    if (!a || typeof a !== "object") return [];
    const x = a as Record<string, unknown>;
    const outcomes = ["applied", "undone", "accepted", "declined"];
    if ((x.kind !== "ease" && x.kind !== "bump") || typeof x.at !== "number" || typeof x.percent !== "number" || !outcomes.includes(x.outcome as string)) return [];
    return [
      {
        at: x.at,
        kind: x.kind,
        percent: x.percent,
        intervals: Array.isArray(x.intervals) ? x.intervals.filter((n): n is number => Number.isInteger(n)) : [],
        reasons: Array.isArray(x.reasons) ? x.reasons.filter((r): r is string => typeof r === "string").slice(0, 6) : [],
        outcome: x.outcome as Adaptation["outcome"],
      },
    ];
  });
}

/** One line for a change, e.g. "Intervals 9 and 11 eased 4%", or "Suggested 4% harder for interval 9" when it didn't happen. */
export function describeAdaptation(a: Pick<Adaptation, "kind" | "percent" | "intervals" | "outcome">): string {
  const n = a.intervals;
  const which = n.length === 1 ? `interval ${n[0]}` : `intervals ${n.slice(0, -1).join(", ")} and ${n[n.length - 1]}`;
  if (a.kind === "bump" && a.outcome === "declined") return `Suggested ${a.percent}% harder for ${which}`;
  const line = `${which} ${a.kind === "ease" ? "eased" : "made harder by"} ${a.percent}%`;
  return line[0].toUpperCase() + line.slice(1);
}
