import { describe, expect, it } from "vitest";
import { ramp, steady, intervals, type Workout } from "../engine/workout";
import { adaptable, applyFactors, describeAdaptation, expectedHr, judge, readAdaptations, readAt, readRep, workReps, type Judge, type RideSoFar } from "./adapt";

const FTP = 250;
// Threshold 5x5: warm-up, five 5 min reps at FTP with 3 min easy between, cool-down.
const fiveByFive: Workout = {
  name: "Threshold 5×5",
  segments: [
    ramp(480, 0.45, 0.6),
    ...Array.from({ length: 5 }, (_, i) => (i < 4 ? [steady(300, 1), steady(180, 0.5)] : [steady(300, 1)])).flat(),
    ramp(300, 0.5, 0.4),
  ],
};

type Feel = (rep: number, second: number, length: number) => { power?: number; hr?: number; cadence?: number };

/** A ride of the workout up to `until` seconds, with each second shaped by `feel`. */
function ride(workout: Workout, until: number, feel: Feel = () => ({})): RideSoFar {
  const out: RideSoFar = { power: [], heartRate: [], cadence: [], target: [], interval: [] };
  const all = intervals(workout);
  const reps = workReps(workout).map((r) => r.index);
  for (let t = 0; t < until; t++) {
    const iv = all.find((i) => t < i.end)!;
    const target = iv.segment.kind === "steady" ? iv.segment.target * FTP : 150;
    const rep = reps.indexOf(iv.index);
    const f = rep >= 0 ? feel(rep, t - iv.start, iv.end - iv.start) : {};
    // Easy riding: heart rate falls from where the last rep left it.
    out.power.push(f.power ?? target);
    out.heartRate.push(f.hr ?? (rep >= 0 ? 160 : 115));
    out.cadence.push(f.cadence ?? 90);
    out.target.push(Math.round(target));
    out.interval.push(iv.index);
  }
  return out;
}

function judgeAfter(workout: Workout, rideSoFar: RideSoFar, repNo: number, extra: Partial<Judge> = {}) {
  const reps = workReps(workout);
  const rep = reps[repNo];
  const reads = reps.slice(0, repNo + 1).map((r) => readRep(rideSoFar, r));
  return judge({
    reps,
    rep,
    reads,
    position: readAt(workout, rep),
    factors: new Map(),
    ergOn: true,
    thresholdHr: null,
    riderSteered: false,
    bumpDeclined: false,
    easeUndone: false,
    ...extra,
  });
}

describe("work reps", () => {
  it("finds the hard reps and skips warm-up, recoveries and cool-down", () => {
    const reps = workReps(fiveByFive);
    expect(reps.map((r) => r.index)).toEqual([1, 3, 5, 7, 9]);
    expect(reps[0]).toMatchObject({ start: 480, end: 780, target: 1 });
  });

  it("leaves tests and openers alone", () => {
    expect(adaptable(fiveByFive)).toBe(true);
    expect(adaptable({ name: "Ramp test", segments: [] })).toBe(false);
    expect(adaptable({ name: "20-minute FTP test", segments: [] })).toBe(false);
    expect(adaptable({ name: "Openers 45 min", segments: [] })).toBe(false);
  });

  it("reads a rep a minute into the recovery", () => {
    const [first] = workReps(fiveByFive);
    expect(readAt(fiveByFive, first)).toBe(first.end + 60);
  });
});

describe("judging a rep", () => {
  it("leaves a rep that went to plan alone", () => {
    const r = ride(fiveByFive, 780 + 180 + 300 + 60);
    expect(judgeAfter(fiveByFive, r, 1)).toBeNull();
  });

  it("eases the later reps when cadence fades at the end of a rep", () => {
    const r = ride(fiveByFive, 1740 + 60, (rep, s, len) => (rep === 2 && s > (len * 2) / 3 ? { cadence: 76 } : {}));
    const change = judgeAfter(fiveByFive, r, 2);
    expect(change).toMatchObject({ kind: "ease", reps: [7, 9], factor: 0.96, percent: 4 });
    expect(change!.reasons[0]).toContain("Cadence fell from 90 to 76 rpm at the end of rep 3");
  });

  it("needs more than one weak sign to ease", () => {
    // Heart rate drift alone (1 point) isn't enough.
    const r = ride(fiveByFive, 1740 + 60, (rep) => (rep === 2 ? { hr: 170 } : {}));
    expect(judgeAfter(fiveByFive, r, 2)).toBeNull();
    // Drift and a pause together are.
    const reps = workReps(fiveByFive);
    const reads = reps.slice(0, 3).map((rep, i) => readRep(r, rep, new Set(i === 2 ? [rep.index] : [])));
    const paused = judge({ reps, rep: reps[2], reads, position: 1800, factors: new Map(), ergOn: true, thresholdHr: null, riderSteered: false, bumpDeclined: false, easeUndone: false });
    expect(paused?.kind).toBe("ease");
    expect(paused!.reasons).toContain("Heart rate ended 10 bpm higher than in rep 1 for the same effort.");
  });

  it("eases with ERG off when you ride well under the target", () => {
    const r = ride(fiveByFive, 1740 + 60, (rep) => (rep === 2 ? { power: 220 } : {}));
    expect(judgeAfter(fiveByFive, r, 2, { ergOn: false })?.kind).toBe("ease");
    // In ERG the trainer holds the watts, so power says nothing.
    expect(judgeAfter(fiveByFive, r, 2, { ergOn: true })).toBeNull();
  });

  it("never eases more than 10% in all", () => {
    const r = ride(fiveByFive, 1740 + 60, (rep, s, len) => (rep === 2 && s > (len * 2) / 3 ? { cadence: 70 } : {}));
    const eased = judgeAfter(fiveByFive, r, 2, { factors: new Map([[7, 0.92], [9, 0.92]]) });
    expect(eased).toMatchObject({ factor: 0.9, percent: 2 });
    expect(judgeAfter(fiveByFive, r, 2, { factors: new Map([[7, 0.9], [9, 0.9]]) })).toBeNull();
  });

  it("keeps its hands off while the rider steers, and after an undo", () => {
    const r = ride(fiveByFive, 1740 + 60, (rep, s, len) => (rep === 2 && s > (len * 2) / 3 ? { cadence: 76 } : {}));
    expect(judgeAfter(fiveByFive, r, 2, { riderSteered: true })).toBeNull();
    expect(judgeAfter(fiveByFive, r, 2, { easeUndone: true })).toBeNull();
  });

  it("has nothing to change after the last rep", () => {
    const r = ride(fiveByFive, 2700, (_rep, s, len) => (s > (len * 2) / 3 ? { cadence: 70 } : {}));
    expect(judgeAfter(fiveByFive, r, 4)).toBeNull();
  });
});

describe("suggesting harder", () => {
  const calm: Feel = () => ({ hr: 145 });

  it("suggests a bump when heart rate sits well under the usual for two reps", () => {
    // Threshold HR 170: a 5 min rep at FTP usually ends near 167.
    expect(expectedHr(170, workReps(fiveByFive)[0])).toBe(167);
    const r = ride(fiveByFive, 1260 + 60, calm);
    const change = judgeAfter(fiveByFive, r, 1, { thresholdHr: 170 });
    expect(change).toMatchObject({ kind: "bump", reps: [5, 7, 9], factor: 1.04, percent: 4 });
  });

  it("doesn't suggest from heart rate without a threshold heart rate, or after one rep", () => {
    const r = ride(fiveByFive, 1260 + 60, calm);
    expect(judgeAfter(fiveByFive, r, 1)).toBeNull();
    expect(judgeAfter(fiveByFive, ride(fiveByFive, 840, calm), 0, { thresholdHr: 170 })).toBeNull();
  });

  it("suggests with ERG off when you ride over the target two reps running", () => {
    const r = ride(fiveByFive, 1260 + 60, () => ({ power: 265 }));
    const change = judgeAfter(fiveByFive, r, 1, { ergOn: false });
    expect(change?.kind).toBe("bump");
    expect(change!.reasons[0]).toBe("You rode 6% over the target on the last two reps.");
  });

  it("asks once: not again after a no, and not after an ease", () => {
    const r = ride(fiveByFive, 1260 + 60, calm);
    expect(judgeAfter(fiveByFive, r, 1, { thresholdHr: 170, bumpDeclined: true })).toBeNull();
    expect(judgeAfter(fiveByFive, r, 1, { thresholdHr: 170, factors: new Map([[5, 0.96]]) })).toBeNull();
  });
});

describe("applying and keeping changes", () => {
  it("scales only the changed reps", () => {
    const next = applyFactors(fiveByFive, new Map([[7, 0.96], [9, 0.96]]));
    expect(next.segments[7]).toMatchObject({ target: 0.96 });
    expect(next.segments[5]).toMatchObject({ target: 1 });
    expect(next.segments[8]).toBe(fiveByFive.segments[8]);
  });

  it("reads back what it saved and describes it", () => {
    const saved = [{ at: 1800, kind: "ease", percent: 4, intervals: [8, 10], reasons: ["Cadence fell."], outcome: "applied" }, { kind: "nope" }];
    const read = readAdaptations(saved);
    expect(read).toHaveLength(1);
    expect(describeAdaptation(read[0])).toBe("Intervals 8 and 10 eased 4%");
    expect(describeAdaptation({ kind: "bump", percent: 4, intervals: [10], outcome: "accepted" })).toBe("Interval 10 made harder by 4%");
    expect(describeAdaptation({ kind: "bump", percent: 4, intervals: [8, 10, 12], outcome: "declined" })).toBe("Suggested 4% harder for intervals 8, 10 and 12");
  });
});
