import { describe, expect, it } from "vitest";
import { checkin } from "./checkin";
import { applyOutcomes, bestPowerAt, seedLevels } from "./levels";
import { buildSession, openers, STARTING_LEVELS, type Session } from "./library";
import { buildPlan, eventStress, phaseLengths, specialtyZones, weekStart, type Availability, type Break, type Goal, type PlanFrame } from "./plan";
import { workoutDuration } from "./workout";

const availability: Availability = [0, 60, 90, 60, 0, 180, 120];
const race: Goal = { id: "a", name: "Spring classic", date: "2027-03-20", priority: "A", kind: "roadRace" };
const plan = (overrides: Partial<Parameters<typeof buildPlan>[0]> = {}) =>
  buildPlan({ today: "2026-10-29", goals: [race], availability, fitness: 55, fatigue: 60, levels: STARTING_LEVELS, ...overrides });

describe("workout library", () => {
  it("fills the slot exactly", () => {
    for (const zone of ["endurance", "tempo", "sweetSpot", "threshold", "vo2max"] as const) {
      for (const minutes of [45, 60, 90]) {
        expect(workoutDuration(buildSession(zone, 5, minutes * 60).workout)).toBe(minutes * 60);
      }
    }
  });

  it("higher levels mean more time in zone", () => {
    const timeAbove = (s: Session, fraction: number) =>
      s.workout.segments.reduce((t, seg) => t + (seg.kind === "steady" && seg.target >= fraction ? seg.duration : 0), 0);
    expect(timeAbove(buildSession("threshold", 6, 5400), 0.95)).toBeGreaterThan(timeAbove(buildSession("threshold", 2, 5400), 0.95));
    expect(buildSession("threshold", 6, 5400).stress).toBeGreaterThan(buildSession("threshold", 2, 5400).stress);
  });

  it("drops the level when the slot is too short", () => {
    const s = buildSession("threshold", 10, 40 * 60);
    expect(s.level).toBeLessThan(10);
    expect(s.workout.segments.filter((seg) => seg.kind === "steady" && seg.target >= 0.95).length).toBeGreaterThanOrEqual(2);
  });

  it("one hour of endurance is roughly 40 TSS", () => {
    expect(buildSession("endurance", 3, 3600).stress).toBeGreaterThan(35);
    expect(buildSession("endurance", 3, 3600).stress).toBeLessThan(45);
  });

  it("openers are short with a few hard efforts", () => {
    const s = openers(2700);
    expect(s.duration).toBe(2700);
    expect(s.workout.segments.filter((seg) => seg.kind === "steady" && seg.target > 1).length).toBe(3);
  });
});

describe("plan", () => {
  it("splits phases back from the event", () => {
    expect(phaseLengths(20)).toEqual({ base: 8, build: 8, specialty: 4 });
    expect(phaseLengths(12)).toEqual({ base: 4, build: 5, specialty: 3 });
    expect(phaseLengths(2)).toEqual({ base: 0, build: 0, specialty: 2 });
  });

  it("weeks start on Monday", () => {
    expect(weekStart("2026-10-29")).toBe("2026-10-26");
    expect(weekStart("2026-10-26")).toBe("2026-10-26");
    expect(weekStart("2026-11-01")).toBe("2026-10-26");
  });

  it("runs from this week to the event week, in phase order, ending with a taper", () => {
    const { weeks, target } = plan();
    expect(target?.id).toBe("a");
    expect(weeks[0].start).toBe("2026-10-26");
    expect(weeks.at(-1)!.start).toBe("2027-03-15");
    expect(weeks.at(-1)!.phase).toBe("taper");
    const order = ["base", "build", "specialty", "taper"];
    for (let i = 1; i < weeks.length; i++) expect(order.indexOf(weeks[i].phase)).toBeGreaterThanOrEqual(order.indexOf(weeks[i - 1].phase));
  });

  it("only schedules riding on available days, never two key days in a row, and rests at least once a week", () => {
    for (const week of plan({ availability: [60, 60, 60, 60, 60, 120, 120] }).weeks) {
      expect(week.days.some((d) => d.role === "rest")).toBe(true);
      week.days.forEach((d, i) => {
        if (d.role === "key") expect(week.days[i - 1]?.role).not.toBe("key");
      });
    }
    for (const week of plan().weeks) {
      expect(week.days[0].session).toBeNull();
      expect(week.days[4].session).toBeNull();
      week.days.forEach((d, i) => d.session && expect(d.session.duration).toBeLessThanOrEqual(availability[i] * 60));
    }
  });

  it("has a recovery week every fourth week before specialty, and the week before specialty is one", () => {
    const { weeks } = plan();
    const firstSpecialty = weeks.findIndex((w) => w.phase === "specialty");
    expect(weeks[firstSpecialty - 1].recoveryWeek).toBe(true);
    expect(weeks[firstSpecialty - 5].recoveryWeek).toBe(true);
    expect(weeks[firstSpecialty - 2].recoveryWeek).toBe(false);
    expect(weeks.filter((w) => w.phase === "specialty" || w.phase === "taper").some((w) => w.recoveryWeek)).toBe(false);
  });

  it("recovery weeks are lighter", () => {
    const { weeks } = plan();
    const recovery = weeks.find((w) => w.recoveryWeek)!;
    const load = weeks.find((w) => !w.recoveryWeek && w.phase === "base")!;
    expect(recovery.stress).toBeLessThan(load.stress * 0.75);
  });

  it("tapers into the A event: openers two days out, and fresh on the day", () => {
    const p = plan();
    const taper = p.weeks.at(-1)!;
    const event = taper.days.find((d) => d.role === "event")!;
    expect(event.goal?.id).toBe("a");
    expect(taper.days.find((d) => d.date === "2027-03-18")?.role).toBe("openers");
    const raceDay = p.forecast.find((d) => d.date === "2027-03-20")!;
    expect(raceDay.form).toBeGreaterThan(0);
  });

  it("builds fitness when there's time to", () => {
    const p = plan({ availability: [0, 90, 90, 90, 0, 240, 180], fitness: 40, fatigue: 40 });
    const peak = Math.max(...p.forecast.map((d) => d.fitness));
    expect(peak).toBeGreaterThan(55);
    // Ramp stays sustainable: no week gains more than 8 fitness.
    for (let i = 7; i < p.forecast.length; i += 7) expect(p.forecast[i].fitness - p.forecast[i - 7].fitness).toBeLessThan(8);
  });

  it("progresses levels through the plan", () => {
    const { weeks } = plan();
    const thresholdLevels = weeks.flatMap((w) => w.days.filter((d) => d.role === "key" && d.session?.zone === "threshold").map((d) => d.session!.level));
    expect(thresholdLevels.at(-1)!).toBeGreaterThan(thresholdLevels[0]);
  });

  it("a B event gets openers the day before and a recovery day after", () => {
    const b: Goal = { id: "b", name: "Crit", date: "2026-11-21", priority: "B", kind: "criterium" };
    const week = plan({ goals: [race, b] }).weeks.find((w) => w.start === "2026-11-16")!;
    const i = week.days.findIndex((d) => d.date === b.date);
    expect(week.days[i].role).toBe("event");
    expect(week.days[i - 1].role).toBe("rest"); // Friday has no time available
    expect(week.days[i + 1].session?.zone).toBe("recovery");
  });

  it("keeps both races on a back-to-back race weekend", () => {
    const sat: Goal = { id: "sat", name: "Saturday crit", date: "2026-11-21", priority: "B", kind: "criterium" };
    const sun: Goal = { id: "sun", name: "Sunday road race", date: "2026-11-22", priority: "B", kind: "roadRace" };
    for (const goals of [[race, sat, sun], [race, sun, sat]]) {
      const week = plan({ goals }).weeks.find((w) => w.start === "2026-11-16")!;
      expect(week.days.find((d) => d.date === sat.date)).toMatchObject({ role: "event", goal: sat });
      expect(week.days.find((d) => d.date === sun.date)).toMatchObject({ role: "event", goal: sun });
    }
  });

  it("keeps a B race next to the A race in the taper week", () => {
    for (const [aDate, bDate] of [["2027-03-20", "2027-03-21"], ["2027-03-21", "2027-03-20"]]) {
      const a: Goal = { ...race, date: aDate };
      const b: Goal = { id: "b", name: "Warm-up race", date: bDate, priority: "B", kind: "criterium" };
      const week = plan({ goals: [a, b] }).weeks.find((w) => w.start === "2027-03-15")!;
      expect(week.days.find((d) => d.date === a.date)).toMatchObject({ role: "event", goal: a });
      expect(week.days.find((d) => d.date === b.date)).toMatchObject({ role: "event", goal: b });
    }
  });

  it("without an A event, plans a few weeks of base", () => {
    const p = plan({ goals: [] });
    expect(p.target).toBeNull();
    expect(p.weeks).toHaveLength(6);
    expect(p.weeks.every((w) => w.phase === "base")).toBe(true);
  });

  it("starts the forecast today", () => {
    expect(plan().forecast[0].date).toBe("2026-10-29");
  });
});

describe("progression levels", () => {
  it("interpolates the power curve", () => {
    expect(bestPowerAt({ 60: 400, 600: 300 }, 60)).toBe(400);
    const mid = bestPowerAt({ 60: 400, 600: 300 }, 190)!;
    expect(mid).toBeGreaterThan(300);
    expect(mid).toBeLessThan(400);
    expect(bestPowerAt({ 60: 400 }, 600)).toBeNull();
  });

  it("seeds higher levels from a stronger curve", () => {
    const ftp = 250;
    const curve = (k: number) => Object.fromEntries([60, 120, 180, 300, 480, 600, 720, 1200, 1800, 2400, 3600].map((t) => [t, ftp * (1 + 20000 / ftp / t) * k]));
    const weak = seedLevels(curve(0.9), ftp, 3600);
    const strong = seedLevels(curve(1.05), ftp, 3 * 3600);
    expect(strong.threshold).toBeGreaterThan(weak.threshold);
    expect(strong.endurance).toBeGreaterThan(weak.endurance);
  });

  it("finishing raises the level, bailing lowers it", () => {
    const start = { ...STARTING_LEVELS, threshold: 4 };
    expect(applyOutcomes(start, [{ date: "2026-10-01", zone: "threshold", level: 4.5, completion: 1, feel: 2 }]).threshold).toBe(5.1);
    expect(applyOutcomes(start, [{ date: "2026-10-01", zone: "threshold", level: 4.5, completion: 1, feel: 5 }]).threshold).toBe(4);
    expect(applyOutcomes(start, [{ date: "2026-10-01", zone: "threshold", level: 4.5, completion: 0.5 }]).threshold).toBe(4);
    expect(applyOutcomes(start, [{ date: "2026-10-01", zone: "threshold", level: 3, completion: 0.5 }]).threshold).toBe(2.5);
  });
});

describe("check-in", () => {
  const planned = buildSession("threshold", 5, 3600);
  const base = { planned, recovery: 55, form: -5, fitness: 60, feel: 3 as const };

  it("rides as planned on a normal day", () => {
    expect(checkin(base).recommended).toBe("asPlanned");
  });

  it("eases off when recovery is low and you feel tired", () => {
    const result = checkin({ ...base, recovery: 30, feel: 2 });
    expect(result.recommended).toBe("endurance");
    expect(result.reasons[0]).toMatch(/Recovery is low/);
  });

  it("a level easier on a slightly off day", () => {
    const result = checkin({ ...base, recovery: 40, feel: 2 });
    expect(result.recommended).toBe("easier");
    expect(result.options.find((o) => o.id === "easier")!.session!.level).toBeLessThan(planned.level);
  });

  it("rests when sick or wrecked and deeply fatigued", () => {
    expect(checkin({ ...base, sick: true }).recommended).toBe("rest");
    expect(checkin({ ...base, feel: 1, form: -35 }).recommended).toBe("rest");
  });

  it("offers harder when fresh, recovered and feeling great", () => {
    const result = checkin({ ...base, recovery: 75, feel: 5, form: 10 });
    expect(result.recommended).toBe("harder");
    expect(result.options.find((o) => o.id === "harder")!.session!.level).toBeGreaterThan(planned.level);
  });

  it("fits the time you have", () => {
    const result = checkin({ ...base, minutes: 40 });
    expect(result.recommended).toBe("shorter");
    expect(result.options.find((o) => o.id === "shorter")!.session!.duration).toBe(40 * 60);
  });

  it("on a rest day, rest stays the pick", () => {
    expect(checkin({ ...base, planned: null }).recommended).toBe("rest");
  });

  it("every option the engine offers is a valid workout or rest", () => {
    for (const option of checkin(base).options) {
      if (option.session) expect(workoutDuration(option.session.workout)).toBe(option.session.duration);
    }
  });
});

describe("saved plans", () => {
  const frame = (f: Partial<PlanFrame>): PlanFrame => ({ start: "2026-11-02", end: "2027-01-31", goal: "base", ...f });

  it("starts on the plan's start date and leaves the days before it open", () => {
    const p = plan({ frame: frame({ start: "2026-11-04" }) });
    const first = p.weeks.find((w) => !w.beforePlan)!;
    expect(first.start).toBe("2026-11-02");
    expect(p.weeks.filter((w) => w.start < first.start).every((w) => w.beforePlan)).toBe(true);
    expect(first.days.filter((d) => d.date < "2026-11-04").every((d) => d.session === null)).toBe(true);
    expect(p.weeks.at(-1)!.start).toBe("2027-01-25");
  });

  it("keeps phases counted from the plan's start as weeks pass", () => {
    const f = frame({ goal: "event", goalId: "a", start: "2026-10-26" });
    const now = plan({ frame: f });
    const later = plan({ frame: f, today: "2026-12-10" });
    const phaseOf = (p: ReturnType<typeof plan>, start: string) => p.weeks.find((w) => w.start === start);
    expect(phaseOf(later, "2027-01-04")!.phase).toBe(phaseOf(now, "2027-01-04")!.phase);
    expect(phaseOf(later, "2027-01-04")!.recoveryWeek).toBe(phaseOf(now, "2027-01-04")!.recoveryWeek);
    expect(later.weeks[0].start).toBe("2026-12-07");
    expect(later.target?.id).toBe("a");
  });

  it("peaks for the chosen event even when it isn't an A", () => {
    const b: Goal = { id: "b", name: "Winter TT", date: "2027-01-23", priority: "B", kind: "timeTrial" };
    const p = plan({ goals: [race, b], frame: frame({ goal: "event", goalId: "b" }) });
    expect(p.target?.id).toBe("b");
    expect(p.weeks.at(-1)!.phase).toBe("taper");
    expect(p.weeks.flatMap((w) => w.days).some((d) => d.goal?.id === "a")).toBe(false);
  });

  it("an FTP plan builds, then ends with a test week and a ramp test", () => {
    const p = plan({ goals: [], frame: frame({ goal: "ftp", end: "2027-01-31" }) });
    const order = ["base", "build", "test"];
    for (let i = 1; i < p.weeks.length; i++) expect(order.indexOf(p.weeks[i].phase)).toBeGreaterThanOrEqual(order.indexOf(p.weeks[i - 1].phase));
    const last = p.weeks.at(-1)!;
    expect(last.phase).toBe("test");
    const test = last.days.find((d) => d.role === "test")!;
    expect(test.session?.workout.name).toBe("Ramp test");
    expect(test.date >= "2027-01-29").toBe(true);
    expect(p.weeks.some((w) => w.phase === "build")).toBe(true);
  });

  it("fits the first week into the days from the start, so setup day gets a ride when it has time", () => {
    // Mon rest, Tue-Thu 1 h, Fri rest, Sat 2 h, Sun 1.5 h; set up on a Thursday.
    const availability: [number, number, number, number, number, number, number] = [0, 60, 60, 60, 0, 120, 90];
    for (const goal of ["ftp", "fitness", "base"] as const) {
      const p = plan({ goals: [], availability, today: "2026-11-12", frame: frame({ goal, start: "2026-11-12", end: "2027-02-03" }) });
      const first = p.weeks.find((w) => !w.beforePlan)!;
      const rides = first.days.filter((d) => d.session);
      expect(rides.every((d) => d.date >= "2026-11-12")).toBe(true);
      expect(first.days.find((d) => d.date === "2026-11-12")!.session).not.toBeNull();
      expect(rides.length).toBe(3);
    }
  });

  it("never opens with a recovery week, whatever day the plan starts", () => {
    // 12 weeks from a Thursday: counting back from the test week used to make the first week a recovery week.
    for (const goal of ["ftp", "fitness", "base"] as const) {
      for (const [start, end] of [["2026-11-12", "2027-02-03"], ["2026-11-10", "2027-01-05"], ["2026-11-15", "2027-03-06"]]) {
        const first = plan({ goals: [], today: start, frame: frame({ goal, start, end }) }).weeks.find((w) => !w.beforePlan)!;
        expect(first.recoveryWeek).toBe(false);
      }
    }
  });

  it("a base plan has no peak and a recovery week every fourth week", () => {
    const weeks = plan({ goals: [], frame: frame({ goal: "base" }) }).weeks.filter((w) => !w.beforePlan);
    expect(weeks.every((w) => w.phase === "base")).toBe(true);
    expect(weeks.map((w) => w.recoveryWeek)).toEqual(weeks.map((_, i) => i % 4 === 3));
  });

  it("a fitness plan ends in build without a taper", () => {
    const p = plan({ goals: [], frame: frame({ goal: "fitness" }) });
    expect(p.weeks[0].phase).toBe("base");
    expect(p.weeks.at(-1)!.phase).toBe("build");
  });

  it("leaves days after the end open and is empty once the plan is over", () => {
    const p = plan({ goals: [], frame: frame({ end: "2027-01-27" }) });
    expect(p.weeks.at(-1)!.days.filter((d) => d.date > "2027-01-27").every((d) => d.session === null)).toBe(true);
    expect(plan({ goals: [], frame: frame({}), today: "2027-02-01" }).weeks).toHaveLength(0);
  });

  it("an A event inside a plan that isn't peaking for it gets openers like a B", () => {
    const a: Goal = { id: "x", name: "Sat race", date: "2026-11-21", priority: "A", kind: "criterium" };
    const p = plan({ goals: [a], availability: [0, 60, 60, 60, 60, 120, 90], frame: frame({ goal: "base" }) });
    const days = p.weeks.flatMap((w) => w.days);
    expect(days.find((d) => d.date === "2026-11-21")!.role).toBe("event");
    expect(days.find((d) => d.date === "2026-11-20")!.role).toBe("openers");
  });

  it("shows your events before a saved plan starts, and nothing else", () => {
    const c: Goal = { id: "c", name: "Friday 'cross", date: "2026-10-30", priority: "C", kind: "cyclocross" };
    const p = plan({ goals: [c], frame: frame({ start: "2026-11-02" }) });
    expect(p.weeks[0].beforePlan).toBe(true);
    const lead = p.weeks[0].days.filter((d) => d.date >= "2026-10-29");
    expect(lead.find((d) => d.date === "2026-10-30")).toMatchObject({ role: "event", goal: { id: "c" } });
    expect(lead.filter((d) => d.date !== "2026-10-30").every((d) => d.session === null)).toBe(true);
  });
});

describe("breaks", () => {
  const trip = (b: Partial<Break>): Break => ({ id: "t", start: "2026-11-23", end: "2026-11-29", kind: "travel", riding: "off", ...b });
  const days = (p: ReturnType<typeof plan>) => p.weeks.flatMap((w) => w.days);

  it("plans nothing on days off the bike and shows the dip in the forecast", () => {
    const p = plan({ breaks: [trip({})] });
    const off = days(p).filter((d) => d.date >= "2026-11-23" && d.date <= "2026-11-29");
    expect(off.every((d) => d.session === null && d.stress === 0 && d.break?.id === "t")).toBe(true);
    const before = p.forecast.find((d) => d.date === "2026-11-22")!.fitness;
    expect(p.forecast.find((d) => d.date === "2026-11-29")!.fitness).toBeLessThan(before);
  });

  it("a week mostly off is the block's recovery week, the next scheduled one moves on, and the week back is gentle", () => {
    const without = plan();
    const p = plan({ breaks: [trip({ start: "2026-11-30", end: "2026-12-06" })] });
    const week = (start: string) => p.weeks.find((w) => w.start === start)!;
    expect(week("2026-11-30").recoveryWeek).toBe(true);
    expect(week("2026-11-30").breakNote).toBe("break");
    expect(week("2026-12-07").breakNote).toBe("reentry");
    expect(week("2026-12-07").days.filter((d) => d.role === "key")).toHaveLength(1);
    // The recovery week that was due straight after isn't needed.
    expect(without.weeks.find((w) => w.start === "2026-12-14")!.recoveryWeek).toBe(true);
    expect(week("2026-12-14").recoveryWeek).toBe(false);
  });

  it("limited days fit the break's minutes", () => {
    const p = plan({ breaks: [trip({ riding: "limited", minutes: 45 })] });
    for (const d of days(p).filter((d) => d.date >= "2026-11-23" && d.date <= "2026-11-29")) {
      if (d.session) expect(d.session.duration).toBeLessThanOrEqual(45 * 60);
    }
  });

  it("outdoor-only days have no intervals", () => {
    const p = plan({ breaks: [trip({ riding: "outdoor" })] });
    const tripDays = days(p).filter((d) => d.date >= "2026-11-23" && d.date <= "2026-11-29");
    expect(tripDays.some((d) => d.session)).toBe(true);
    for (const d of tripDays) if (d.session) expect(["endurance", "recovery"]).toContain(d.session.zone);
  });
});

describe("event details", () => {
  const goal = (overrides: Partial<Goal>): Goal => ({ ...race, ...overrides });

  it("cyclocross trains VO2 max and short anaerobic efforts before the race", () => {
    const cx = goal({ kind: "cyclocross" });
    expect(specialtyZones(cx)).toEqual(["vo2max", "anaerobic"]);
    const specialty = plan({ goals: [cx] }).weeks.filter((w) => w.phase === "specialty");
    const zones = specialty.flatMap((w) => w.days.filter((d) => d.role === "key").map((d) => d.session!.zone));
    expect(zones).toContain("anaerobic");
    for (const day of specialty.flatMap((w) => w.days).filter((d) => d.session?.zone === "anaerobic")) {
      const efforts = day.session!.workout.segments.filter((s) => s.kind === "steady" && s.target > 1.3);
      expect(efforts.length).toBeGreaterThanOrEqual(2);
      expect(efforts.every((s) => s.duration <= 70)).toBe(true);
    }
    // Race-like structures, not the same workout every week.
    const structures = new Set(specialty.flatMap((w) => w.days).flatMap((d) => (d.role === "key" && d.session?.template ? [d.session.template] : [])));
    expect(structures.size).toBeGreaterThan(1);
  });

  it("intensity and duration change what specialty trains", () => {
    expect(specialtyZones(goal({ kind: "granFondo", minutes: 300, intensity: "easy" }))).toEqual(["tempo", "sweetSpot"]);
    expect(specialtyZones(goal({ kind: "granFondo", minutes: 300, intensity: "hard" }))).toEqual(["sweetSpot", "threshold"]);
    expect(specialtyZones(goal({ kind: "timeTrial", minutes: 20, intensity: "max" }))).toEqual(["vo2max", "threshold"]);
    expect(specialtyZones(goal({ kind: "roadRace", minutes: 90, intensity: "hard" }))).toEqual(["vo2max", "threshold"]);
  });

  it("estimates event stress from duration and intensity", () => {
    expect(eventStress(goal({ minutes: 60, intensity: "max" }))).toBe(90);
    expect(eventStress(goal({ minutes: 300, intensity: "moderate" }))).toBeGreaterThan(eventStress(goal({ minutes: 120, intensity: "moderate" })));
    expect(eventStress(goal({ minutes: 60, intensity: "easy" }))).toBeLessThan(eventStress(goal({ minutes: 60, intensity: "hard" })));
    // Without details, the kind's defaults apply.
    expect(eventStress(goal({ kind: "cyclocross" }))).toBe(eventStress(goal({ kind: "cyclocross", minutes: 50, intensity: "max" })));
  });

  it("long events get longer long rides in build and specialty", () => {
    const long = { availability: [0, 60, 60, 60, 0, 300, 90] as Availability };
    const longest = (g: Goal) =>
      Math.max(...plan({ ...long, goals: [g] }).weeks.filter((w) => w.phase === "specialty").flatMap((w) => w.days.map((d) => d.session?.duration ?? 0)));
    expect(longest(goal({ kind: "gravel", minutes: 360, intensity: "moderate" }))).toBeGreaterThan(longest(goal({ kind: "criterium", minutes: 60, intensity: "max" })));
  });
});
