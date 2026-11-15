// Riding part of an event's course indoors: the trainer follows the course's grade, and how far
// you've gone comes from your power and the physics of the road (the same model the pre-race report
// paces with). Pure, so it tests in Node.

import { airDensity, type BikeSetup } from "../engine/course/pacing";
import { STEP, type CourseProfile } from "../engine/course/profile";

export interface CourseSection {
  id: string;
  name: string;
  /** Meters from the course's start. */
  from: number;
  to: number;
  /** Meters climbed in it. */
  gain: number;
  /** A climb's average grade, as a fraction; null for other sections. */
  grade: number | null;
}

/** Road before a climb starts, so you arrive at it rolling. */
export const RUN_IN = 1000;
/** Road past the top. */
const RUN_OUT = 300;
const FINISH = 10000;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Meters climbed between two points of a course. */
export function gainBetween(profile: CourseProfile, from: number, to: number): number {
  let gain = 0;
  const a = Math.max(0, Math.floor(from / STEP));
  const b = Math.min(profile.ele.length - 1, Math.ceil(to / STEP));
  for (let i = a + 1; i <= b; i++) gain += Math.max(0, profile.ele[i] - profile.ele[i - 1]);
  return gain;
}

/** A part of the course between two distances, kept inside the course and at least 500 m long. */
export function customSection(profile: CourseProfile, from: number, to: number): CourseSection {
  const a = clamp(Math.min(from, to), 0, Math.max(0, profile.meters - 500));
  const b = clamp(Math.max(from, to), a + 500, profile.meters);
  return { id: `custom:${Math.round(a)}-${Math.round(b)}`, name: "Your section", from: a, to: b, gain: gainBetween(profile, a, b), grade: null };
}

/**
 * The parts of a course worth riding ahead of the day: each climb with a run-in, the finish, and
 * the whole thing. Climbs come in course order, numbered as the pre-race report numbers them.
 */
export function courseSections(profile: CourseProfile): CourseSection[] {
  const out: CourseSection[] = [];
  for (const c of profile.climbs) {
    const from = Math.max(0, c.from - RUN_IN);
    const to = Math.min(profile.meters, c.to + RUN_OUT);
    out.push({ id: `climb:${c.n}`, name: `Climb ${c.n}`, from, to, gain: c.gain, grade: c.grade });
  }
  if (profile.meters > FINISH * 1.5) {
    const from = profile.meters - FINISH;
    out.push({ id: "finish", name: "The finish", from, to: profile.meters, gain: gainBetween(profile, from, profile.meters), grade: null });
  }
  out.push({ id: "course", name: "Whole course", from: 0, to: profile.meters, gain: profile.gain, grade: null });
  return out;
}

/** A section by id (as `courseSections` names them, or `custom:<from>-<to>`); null when the course has none like it. */
export function sectionById(profile: CourseProfile, id: string | null | undefined): CourseSection | null {
  if (!id) return null;
  const custom = /^custom:(\d+)-(\d+)$/.exec(id);
  if (custom) return customSection(profile, Number(custom[1]), Number(custom[2]));
  return courseSections(profile).find((s) => s.id === id) ?? null;
}

/** The road's grade at a distance along the course, as a fraction, eased between the 100 m samples so it never jumps. */
export function gradeAt(profile: CourseProfile, meters: number): number {
  const n = profile.grade.length;
  if (n === 0) return 0;
  // Each sample's grade holds at the middle of its 100 m; in between, blend to the next.
  const x = clamp(meters, 0, profile.meters) / STEP - 0.5;
  const i = Math.floor(x);
  const a = profile.grade[clamp(i, 0, n - 1)] ?? 0;
  const b = profile.grade[clamp(i + 1, 0, n - 1)] ?? 0;
  return a + (b - a) * (x - i);
}

/** Height at a distance along the course, meters. */
export function elevationAt(profile: CourseProfile, meters: number): number {
  const x = clamp(meters, 0, profile.meters) / STEP;
  const i = Math.min(profile.ele.length - 2, Math.floor(x));
  if (i < 0) return profile.ele[0] ?? 0;
  return profile.ele[i] + (profile.ele[i + 1] - profile.ele[i]) * (x - i);
}

/** Where on the map a distance along the course is, and which way the road points there (degrees from north). */
export function placeAt(profile: CourseProfile, meters: number): { lat: number; lng: number; bearing: number } {
  const x = clamp(meters, 0, profile.meters) / STEP;
  const i = Math.max(0, Math.min(profile.lat.length - 2, Math.floor(x)));
  const f = x - i;
  return {
    lat: profile.lat[i] + (profile.lat[i + 1] - profile.lat[i]) * f,
    lng: profile.lng[i] + (profile.lng[i + 1] - profile.lng[i]) * f,
    bearing: profile.bearing[i] ?? 0,
  };
}

/** What trainers take for a road: -10% to 20%. */
export const TRAINER_MIN = -10;
export const TRAINER_MAX = 20;

/** The grade to send the trainer for a road grade (a fraction), in percent to the nearest half. */
export function trainerGrade(grade: number, feel = 1): number {
  if (!Number.isFinite(grade)) return 0;
  return clamp(Math.round(grade * 100 * feel * 2) / 2, TRAINER_MIN, TRAINER_MAX);
}

export interface CourseRider {
  /** Rider and bike, kg. */
  massKg: number;
  setup: BikeSetup;
}

const G = 9.80665;

/**
 * Speed a moment later, m/s: your power pushes, and gravity, rolling resistance and the air push
 * back. Carries momentum, so a crest or a dip rides the way it does outside.
 */
export function nextSpeed(speed: number, watts: number, grade: number, ele: number, rider: CourseRider, seconds = 1): number {
  const { massKg, setup } = rider;
  const top = setup.maxKmh / 3.6;
  let v = Math.max(0, speed);
  const steps = Math.max(1, Math.ceil(seconds / 0.25));
  const dt = seconds / steps;
  const slope = Math.atan(grade);
  const rho = airDensity(ele);
  for (let k = 0; k < steps; k++) {
    // Power over speed is force; below walking pace use walking pace, so starting off isn't infinite.
    const push = Math.max(0, watts) / Math.max(v, 1.5);
    const drag = massKg * G * (Math.sin(slope) + setup.crr * Math.cos(slope)) + 0.5 * rho * setup.cda * v * v;
    v = clamp(v + ((push - drag) / massKg) * dt, 0, top);
  }
  return v;
}

export interface CourseRideState {
  /** Meters ridden from the section's start. */
  meters: number;
  /** m/s. */
  speed: number;
}

export const COURSE_START: CourseRideState = { meters: 0, speed: 0 };

/** The ride `seconds` later at `watts`, stopping at the section's end. */
export function advance(state: CourseRideState, watts: number, seconds: number, profile: CourseProfile, section: CourseSection, rider: CourseRider): CourseRideState {
  const length = section.to - section.from;
  let { meters, speed } = state;
  for (let s = 0; s < seconds && meters < length; s++) {
    const at = section.from + meters;
    speed = nextSpeed(speed, watts, gradeAt(profile, at), elevationAt(profile, at), rider);
    meters = Math.min(length, meters + speed);
  }
  return { meters, speed: meters >= length ? 0 : speed };
}

/** Seconds a section takes at a steady power; the ride's length is sized from it. */
export function sectionSeconds(profile: CourseProfile, section: CourseSection, watts: number, rider: CourseRider): number {
  let state = COURSE_START;
  let t = 0;
  const length = section.to - section.from;
  // A day is long enough for anything; stops a zero-watt climb from never ending.
  while (state.meters < length && t < 86400) {
    state = advance(state, Math.max(watts, 60), 10, profile, section, rider);
    t += 10;
  }
  return t;
}

export interface ClimbAhead {
  n: number;
  /** Meters to its start (0 once on it) and to its top. */
  toStart: number;
  toTop: number;
  /** Meters still to climb. */
  gainLeft: number;
  /** Average grade from here (or from its start) to the top, as a fraction. */
  grade: number;
}

/** The climb you're on, or the next one before the section ends; null when there's none left. */
export function climbAhead(profile: CourseProfile, section: CourseSection, meters: number): ClimbAhead | null {
  const at = section.from + meters;
  const climb = profile.climbs.find((c) => c.to > at + 20 && c.from < section.to);
  if (!climb) return null;
  const from = Math.max(at, climb.from);
  const gainLeft = Math.max(0, climb.top - elevationAt(profile, from));
  return { n: climb.n, toStart: Math.max(0, climb.from - at), toTop: climb.to - at, gainLeft, grade: gainLeft / Math.max(1, climb.to - from) };
}

/** Heights every `step` meters for the next `span` meters of the section, for the strip of road ahead. */
export function roadAhead(profile: CourseProfile, section: CourseSection, meters: number, span = 2000, step = 50): number[] {
  const at = section.from + meters;
  const out: number[] = [];
  for (let d = 0; d <= span; d += step) out.push(elevationAt(profile, Math.min(section.to, at + d)));
  return out;
}
