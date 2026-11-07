// A small, fixed athlete for the coach's tests and the model eval: one ride, a plan with no events.

import { STARTING_LEVELS } from "../engine/library";
import { buildPlan, DEFAULT_RAMP_RATE, type Availability } from "../engine/plan";
import type { TrainingState } from "../training";
import type { CoachData } from "./tools";

export const today = "2026-10-29";
const availability: Availability = [0, 60, 90, 60, 0, 180, 120];
export const plan = buildPlan({ today, goals: [], availability, fitness: 55, fatigue: 60, levels: STARTING_LEVELS });
export const state = {
  athlete: {
    userId: "u",
    ftp: 250,
    thresholdHr: 170,
    maxHr: 190,
    weightKg: 75,
    heightCm: 180,
    birthDate: "1985-06-01",
    sex: "male",
    sleepNeedHours: 8,
    timezone: "America/Los_Angeles",
    ftpHistory: [{ effectiveDate: "2026-09-01", watts: 250 }],
    availability,
    rampRate: DEFAULT_RAMP_RATE,
  },
  today,
  plans: [],
  activePlan: null,
  breaks: [],
  rides: [
    {
      id: "r1",
      source: "app",
      name: "Sweet spot 3 x 12",
      startedAt: new Date("2026-10-28T01:00:00Z"),
      durationSeconds: 3600,
      distanceMeters: 30000,
      averagePower: 200,
      normalizedPower: 215,
      intensityFactor: 0.86,
      trainingStress: 74,
      stressMethod: "power",
      averageHr: 150,
      powerCurve: { 60: 320, 300: 270, 1200: 240 },
      duplicateOf: null,
      intervalsId: null,
    },
  ],
  series: [
    { date: "2026-10-27", stress: 74, fitness: 55, fatigue: 60, form: -4 },
    { date: "2026-10-28", stress: 0, fitness: 54, fatigue: 52, form: -5 },
  ],
  fitness: 55,
  fatigue: 60,
  form: -5,
  recovery: null,
  goals: [],
  levels: STARTING_LEVELS,
  levelSeed: STARTING_LEVELS,
  levelOutcomes: [],
  plan,
  basePlan: plan,
  changedDays: [],
  todayPlan: null,
  todayStored: null,
  recentDays: [],
  storedDays: [],
  rideLinks: new Map(),
  feedback: [],
  outdoor: [],
} as unknown as TrainingState;
export const data: CoachData = { state, planDays: [], recoveryDays: [], body: [], memory: [] };

