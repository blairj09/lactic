import { describe, expect, it } from "vitest";
import type { Session } from "../engine/library";
import type { Goal, Plan } from "../engine/plan";
import { ramp, steady } from "../engine/workout";
import { calendarChanges, calendarEvents, duration, workoutText, type ListedEvent } from "./calendar";

const session: Session = {
  zone: "threshold",
  level: 3,
  duration: 3630,
  stress: 61.4,
  workout: { name: "Threshold 3 x 10:00", segments: [ramp(600, 0.5, 0.75), steady(600, 0.95), { kind: "freeRide", duration: 330 }, steady(2100, 0.55)] },
};

const day = (date: string, s: Session | null) => ({ date, role: s ? "train" : "rest", session: s, stress: s?.stress ?? 0 });
const plan = {
  target: null,
  forecast: [],
  weeks: [{ start: "2026-10-26", phase: "base", recoveryWeek: false, target: 0, stress: 0, days: [day("2026-10-29", session), day("2026-10-30", session), day("2026-10-31", null), day("2026-11-01", session)] }],
} as unknown as Plan;
const goals: Goal[] = [
  { id: "g1", name: "Old race", date: "2026-06-01", priority: "A", kind: "roadRace" },
  { id: "g2", name: "Gravel worlds", date: "2027-05-02", priority: "B", kind: "gravel" },
];

describe("intervals.icu calendar", () => {
  it("writes workouts in intervals.icu's text format", () => {
    expect(duration(330)).toBe("5m30s");
    expect(duration(3600)).toBe("1h");
    expect(workoutText(session.workout)).toBe("- 10m ramp 50%-75%\n- 10m 95%\n- 5m30s freeride\n- 35m 55%");
  });

  it("sends workouts from today and goals still to come", () => {
    const events = calendarEvents(plan, goals, "2026-10-30");
    expect(events.map((e) => e.external_id)).toEqual(["mycoach-workout-2026-10-30", "mycoach-workout-2026-11-01", "mycoach-goal-g2"]);
    expect(events[0]).toMatchObject({ category: "WORKOUT", start_date_local: "2026-10-30T00:00:00", moving_time: 3630, icu_training_load: 61 });
    expect(events[2]).toMatchObject({ category: "RACE_B", name: "Gravel worlds", start_date_local: "2027-05-02T00:00:00" });
  });

  it("only sends what changed and only removes its own stale events", () => {
    const wanted = calendarEvents(plan, goals, "2026-10-30");
    const listed: ListedEvent[] = [
      { id: 1, ...wanted[0] },
      { id: 2, ...wanted[1], name: "Old name" },
      { id: 3, external_id: "mycoach-workout-2026-10-31", category: "WORKOUT", start_date_local: "2026-10-31T00:00:00" },
      { id: 4, external_id: "mycoach-workout-2026-10-29", category: "WORKOUT", start_date_local: "2026-10-29T00:00:00" },
      { id: 5, external_id: null, category: "WORKOUT", start_date_local: "2026-11-02T00:00:00", name: "My own workout" },
    ];
    const { upsert, remove } = calendarChanges(wanted, listed, "2026-10-30");
    expect(upsert.map((e) => e.external_id)).toEqual(["mycoach-workout-2026-11-01", "mycoach-goal-g2"]);
    expect(remove).toEqual([3]);
  });
});

describe("race types", () => {
  it("sends mountain bike races with intervals.icu's sport type, and others as rides", () => {
    const kinds: Goal[] = [
      { id: "x1", name: "CX", date: "2027-01-10", priority: "B", kind: "cyclocross" },
      { id: "x2", name: "MTB", date: "2027-02-10", priority: "B", kind: "mountainBike" },
      { id: "x3", name: "Crit", date: "2027-03-10", priority: "C", kind: "criterium" },
    ];
    const types = calendarEvents({ target: null, frame: null, weeks: [], forecast: [] }, kinds, "2026-12-01").map((e) => e.type);
    expect(types).toEqual(["Ride", "MountainBikeRide", "Ride"]);
  });
});

describe("outdoor rides", () => {
  it("sends outdoor days with ranges and steps, and a chosen workout in place of the plan's", () => {
    const chosen = { name: "Hill repeats", segments: [steady(600, 0.6), steady(300, 1.05)] };
    const events = calendarEvents(plan, [], "2026-10-30", [
      { date: "2026-10-30", workout: null },
      { date: "2026-10-31", workout: chosen },
    ]);
    expect(events.map((e) => e.name)).toEqual(["Threshold 3 x 10:00 (outdoor)", "Hill repeats (outdoor)", "Threshold 3 x 10:00"]);
    expect(events[0].description).toContain("- 2m 50%-56%\n- 2m 55%-61%\n");
    expect(events[0].description).toContain("- 10m 92%-98%\n- 5m30s freeride\n- 35m 52%-58%");
    expect(events[0]).toMatchObject({ moving_time: 3630, icu_training_load: 61 });
    expect(events[1]).toMatchObject({ external_id: "mycoach-workout-2026-10-31", moving_time: 900 });
    expect(events[1].description).toContain("- 10m 57%-63%\n- 5m 102%-108%");
  });
});
