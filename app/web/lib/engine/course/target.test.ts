import { describe, expect, it } from "vitest";
import { buildPlan, targetNote, type Goal } from "../plan";
import { STARTING_LEVELS } from "../library";
import type { Track } from "../race/track";
import { DRAFT, packOf, paceCourse } from "./pacing";
import { preRaceReport } from "./prerace";
import { courseProfile } from "./profile";
import { droppedTime, ftpForTime, ftpGain, parseFinishTime, targetPlan } from "./target";

function course(segments: [number, number][]): Track {
  const points: Track["points"] = [];
  let lat = 40;
  let ele = 1000;
  points.push({ t: null, lat, lng: -111, ele, hr: null, watts: null, cadence: null });
  for (const [meters, grade] of segments) {
    for (let m = 0; m < meters; m += 20) {
      lat += 20 / 111_195;
      ele += 20 * grade;
      points.push({ t: null, lat, lng: -111, ele: Math.round(ele * 10) / 10, hr: null, watts: null, cadence: null });
    }
  }
  return { name: "Test", points };
}

const goal = (over: Partial<Goal> = {}): Goal => ({ id: "g1", name: "Valley Road Race", date: "2027-03-06", priority: "A", kind: "roadRace", minutes: 180, intensity: "hard", ...over });
const rider = { ftp: 280, weightKg: 75 };
const hilly = courseProfile(course([[15000, 0], [6000, 0.06], [6000, -0.06], [25000, 0.001], [2000, 0.05], [8000, 0]]));
const flat = courseProfile(course([[40000, 0.0005]]));

describe("riding in a group", () => {
  it("uses the kind's usual pack, never a draft in a time trial", () => {
    expect(packOf(goal())).toBe("bunch");
    expect(packOf(goal({ kind: "granFondo" }))).toBe("group");
    expect(packOf(goal({ kind: "timeTrial", pack: "bunch" }))).toBe("solo");
    expect(packOf(goal({ pack: "solo" }))).toBe("solo");
  });

  it("goes faster on the flat in a bunch than in a group, and in a group than alone", () => {
    const solo = paceCourse(flat, goal({ pack: "solo" }), rider).seconds;
    const group = paceCourse(flat, goal({ pack: "group" }), rider).seconds;
    const bunch = paceCourse(flat, goal({ pack: "bunch" }), rider).seconds;
    expect(group).toBeLessThan(solo);
    expect(bunch).toBeLessThan(group);
    // A real but not absurd difference: a big field is a few km/h faster, not twice as fast.
    expect(solo / bunch).toBeGreaterThan(1.08);
    expect(solo / bunch).toBeLessThan(1.35);
    expect(DRAFT.bunch).toBeGreaterThan(DRAFT.group);
  });

  it("matters much less on a climb", () => {
    const climb = courseProfile(course([[6000, 0.07]]));
    const solo = paceCourse(climb, goal({ pack: "solo" }), rider).seconds;
    const bunch = paceCourse(climb, goal({ pack: "bunch" }), rider).seconds;
    expect(solo / bunch).toBeLessThan(1.03);
  });

  it("prices getting dropped on the main climb", () => {
    const g = goal();
    const pacing = paceCourse(hilly, g, rider);
    const dropped = droppedTime(hilly, g, rider, pacing);
    expect(dropped?.climb).toBe(pacing.climbs.sort((a, b) => b.seconds - a.seconds)[0].n);
    expect(dropped!.cost).toBeGreaterThan(120);
    expect(droppedTime(hilly, goal({ pack: "solo" }), rider, paceCourse(hilly, goal({ pack: "solo" }), rider))).toBeNull();
  });
});

describe("target time", () => {
  it("finds the FTP that rides the course in a time", () => {
    const g = goal({ pack: "solo" });
    const now = paceCourse(hilly, g, rider).seconds;
    // Its own time takes its own FTP.
    expect(Math.abs(ftpForTime(hilly, g, rider, now) - 280)).toBeLessThanOrEqual(2);
    const faster = ftpForTime(hilly, g, rider, now * 0.93);
    expect(faster).toBeGreaterThan(290);
    expect(Math.abs(paceCourse(hilly, g, rider, { ftp: faster }).seconds - now * 0.93)).toBeLessThan(60);
  });

  it("expects realistic FTP gains", () => {
    expect(ftpGain(0)).toBe(0);
    expect(ftpGain(4)).toBeGreaterThan(0.025);
    expect(ftpGain(4)).toBeLessThan(0.04);
    expect(ftpGain(8)).toBeLessThan(0.07);
    expect(ftpGain(52)).toBeLessThan(0.12);
  });

  it("says whether a target is on track, a stretch or out of reach", () => {
    const g = goal({ pack: "solo" });
    const now = paceCourse(hilly, g, rider).seconds;
    // 16 weeks out.
    const today = "2026-11-14";
    expect(targetPlan(hilly, g, rider, now * 1.05, today).status).toBe("onTrack");
    const stretch = targetPlan(hilly, g, rider, now * 0.97, today);
    expect(stretch.status).toBe("stretch");
    expect(stretch.neededFtp).toBeGreaterThan(280);
    expect(stretch.neededFtp).toBeLessThanOrEqual(stretch.raceDayFtp * 1.01);
    expect(stretch.pacing.seconds).toBeLessThan(now);
    const far = targetPlan(hilly, g, rider, now * 0.8, today);
    expect(far.status).toBe("outOfReach");
    expect(far.raceDaySeconds).toBeGreaterThan(now * 0.8);
    expect(far.raceDaySeconds).toBeLessThan(now);
  });

  it("puts the target and the dropped time in the pre-race report", () => {
    const g = goal();
    const report = preRaceReport({ goal: g, profile: hilly, rider, forecast: null, today: "2026-11-14", targetSeconds: 5400 });
    expect(report.pack).toBe("bunch");
    expect(report.target?.seconds).toBe(5400);
    expect(report.dropped).not.toBeNull();
    expect(report.tips.some((t) => /bunch/.test(t))).toBe(true);
    expect(preRaceReport({ goal: g, profile: hilly, rider, forecast: null, today: "2026-11-14" }).target).toBeNull();
  });

  it("reads finish times the ways riders type them", () => {
    expect(parseFinishTime("4:30")).toBe(16200);
    expect(parseFinishTime("4h30")).toBe(16200);
    expect(parseFinishTime("1:05:30")).toBe(3930);
    expect(parseFinishTime("95")).toBe(5700);
    expect(parseFinishTime("95 min")).toBe(5700);
    expect(parseFinishTime("4:75")).toBeNull();
    expect(parseFinishTime("soon")).toBeNull();
    expect(parseFinishTime("")).toBeNull();
  });
});

describe("a plan chasing a target time", () => {
  const input = {
    today: "2026-11-10",
    availability: [0, 90, 75, 90, 0, 180, 120] as [number, number, number, number, number, number, number],
    fitness: 50,
    fatigue: 50,
    levels: { ...STARTING_LEVELS, threshold: 5, sweetSpot: 5, tempo: 5 },
  };

  it("trains threshold in base and marks the days that build FTP", () => {
    const chasing = goal({ timeTarget: { seconds: 9000, neededFtp: 300, ftp: 280 } });
    const plan = buildPlan({ ...input, goals: [chasing] });
    const plain = buildPlan({ ...input, goals: [goal()] });
    const base = (p: typeof plan) => p.weeks.filter((w) => w.phase === "base" && !w.recoveryWeek).flatMap((w) => w.days).filter((d) => d.role === "key");
    expect(base(plan).some((d) => d.session?.zone === "threshold")).toBe(true);
    expect(base(plain).some((d) => d.session?.zone === "threshold")).toBe(false);
    const marked = plan.weeks.flatMap((w) => w.days).filter((d) => d.course);
    expect(marked.length).toBeGreaterThan(0);
    expect(marked[0].course).toContain("300 W");
    expect(plain.weeks.flatMap((w) => w.days).some((d) => d.course)).toBe(false);
  });

  it("leaves the plan alone when the rider already has the FTP", () => {
    expect(targetNote(goal({ timeTarget: { seconds: 9000, neededFtp: 270, ftp: 280 } }))).toBeNull();
    expect(targetNote(goal())).toBeNull();
  });
});
