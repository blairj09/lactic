import { describe, expect, it } from "vitest";
import { bikeSetup } from "../engine/course/pacing";
import { courseProfile } from "../engine/course/profile";
import type { Track } from "../engine/race/track";
import { COURSE_START, advance, climbAhead, courseSections, customSection, elevationAt, gradeAt, nextSpeed, roadAhead, sectionById, sectionSeconds, trainerGrade } from "./course-ride";

/** 30 km heading north: 10 km flat, 8 km at 6%, 2 km flat, 5 km down at 4%, 5 km flat. */
function course(): Track {
  const points = [];
  let ele = 1000;
  for (let m = 0; m <= 30000; m += 50) {
    const grade = m <= 10000 ? 0 : m <= 18000 ? 0.06 : m <= 20000 ? 0 : m <= 25000 ? -0.04 : 0;
    if (m > 0) ele += grade * 50;
    points.push({ lat: 42 + m / 111320, lng: -111, ele, t: null, hr: null, watts: null, cadence: null });
  }
  return { name: "Test", points };
}

const rider = { massKg: 83, setup: bikeSetup("roadRace") };

describe("course ride", () => {
  const profile = courseProfile(course());

  it("offers the climb with a run-in, the finish and the whole course", () => {
    const sections = courseSections(profile);
    expect(sections.map((s) => s.id)).toEqual(["climb:1", "finish", "course"]);
    const climb = sections[0];
    expect(climb.from).toBeGreaterThan(8500);
    expect(climb.from).toBeLessThan(9500);
    expect(climb.to).toBeGreaterThan(18000);
    expect(climb.gain).toBeGreaterThan(430);
    expect(sectionById(profile, "finish")?.from).toBe(profile.meters - 10000);
    expect(sectionById(profile, "custom:2000-6000")).toMatchObject({ from: 2000, to: 6000 });
    expect(sectionById(profile, "nope")).toBeNull();
  });

  it("keeps a custom section inside the course", () => {
    const s = customSection(profile, 29900, 99999);
    expect(s.to).toBe(profile.meters);
    expect(s.to - s.from).toBeGreaterThanOrEqual(500);
  });

  it("reads grade and height along the road without jumps", () => {
    expect(gradeAt(profile, 5000)).toBeCloseTo(0, 2);
    expect(gradeAt(profile, 14000)).toBeCloseTo(0.06, 2);
    expect(gradeAt(profile, 23000)).toBeCloseTo(-0.04, 2);
    for (let m = 9000; m < 11000; m += 10) expect(Math.abs(gradeAt(profile, m + 10) - gradeAt(profile, m))).toBeLessThan(0.01);
    expect(elevationAt(profile, 14000)).toBeCloseTo(1240, -1);
  });

  it("sends the trainer half percents within its range", () => {
    expect(trainerGrade(0.0613)).toBe(6);
    expect(trainerGrade(0.064)).toBe(6.5);
    expect(trainerGrade(0.3)).toBe(20);
    expect(trainerGrade(-0.2)).toBe(-10);
    expect(trainerGrade(0.08, 0.5)).toBe(4);
    expect(trainerGrade(NaN)).toBe(0);
  });

  it("settles at a believable speed for the power and the road", () => {
    let flat = 0;
    let up = 0;
    for (let s = 0; s < 600; s++) {
      flat = nextSpeed(flat, 200, 0, 1000, rider);
      up = nextSpeed(up, 250, 0.06, 1500, rider);
    }
    expect(flat * 3.6).toBeGreaterThan(30);
    expect(flat * 3.6).toBeLessThan(38);
    expect(up * 3.6).toBeGreaterThan(13);
    expect(up * 3.6).toBeLessThan(18);
    // Coasting downhill tops out at the bike's limit, never past it.
    let down = 0;
    for (let s = 0; s < 600; s++) down = nextSpeed(down, 0, -0.08, 1000, rider);
    expect(down * 3.6).toBeCloseTo(rider.setup.maxKmh, 0);
  });

  it("moves along the section with power and stops at its end", () => {
    const section = sectionById(profile, "climb:1")!;
    let state = COURSE_START;
    state = advance(state, 250, 60, profile, section, rider);
    expect(state.meters).toBeGreaterThan(300);
    expect(advance(state, 0, 30, profile, section, rider).speed).toBeLessThan(state.speed);
    const seconds = sectionSeconds(profile, section, 250, rider);
    expect(seconds).toBeGreaterThan(25 * 60);
    expect(seconds).toBeLessThan(45 * 60);
    const done = advance(COURSE_START, 250, seconds + 60, profile, section, rider);
    expect(done.meters).toBe(section.to - section.from);
    expect(done.speed).toBe(0);
  });

  it("says what's left of the climb and draws the road ahead", () => {
    const section = sectionById(profile, "course")!;
    const before = climbAhead(profile, section, 5000)!;
    expect(before.toStart).toBeGreaterThan(4000);
    const on = climbAhead(profile, section, 14000)!;
    expect(on.toStart).toBe(0);
    expect(on.gainLeft).toBeGreaterThan(200);
    expect(on.grade).toBeCloseTo(0.06, 1);
    expect(climbAhead(profile, section, 21000)).toBeNull();
    const road = roadAhead(profile, section, 14000);
    expect(road).toHaveLength(41);
    expect(road[40] - road[0]).toBeCloseTo(120, -1);
  });
});
