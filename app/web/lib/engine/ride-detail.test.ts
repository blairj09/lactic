import { describe, expect, it } from "vitest";
import { bestWindow, chartStream, completion, dayRides, plannedTargets, smooth, MAX_ROUTE_POINTS, rideIntervals, routeBetween, targetHit, thinRoute } from "./ride-detail";
import { gridTimes } from "./activity";
import { steady, type Workout } from "./workout";

describe("chartStream", () => {
  it("thins channels to step means and leaves out empty ones", () => {
    const s = chartStream({ watts: [100, 200, 300, 400], heartRate: [0, 0, 0, 0], cadence: [90, 90, 0, 0], target: [200, 200, null, null] }, 2);
    expect(s.watts).toEqual([150, 350]);
    expect(s.heartRate).toBeNull();
    expect(s.cadence).toEqual([90, 0]);
    expect(s.target).toEqual([200, null]);
  });

  it("skips heart rate dropouts in the mean", () => {
    expect(chartStream({ heartRate: [140, 0, 150, 150] }, 2).heartRate).toEqual([140, 150]);
  });
});

describe("rideIntervals", () => {
  const workout: Workout = { name: "Test", segments: [steady(3, 0.5), steady(2, 1), steady(4, 0.5)] };

  it("groups ride seconds by the interval they were in", () => {
    const result = rideIntervals(workout, {
      interval: [0, 0, 0, 1, 1],
      target: [125, 125, 125, 250, 250],
      watts: [120, 130, 125, 240, 260],
      heartRate: [120, 0, 124, 150, 160],
      cadence: [90, 90, 90, 95, 95],
    });
    expect(result[0]).toMatchObject({ planned: 3, ridden: 3, target: 125, power: 125, heartRate: 122, cadence: 90 });
    expect(result[1]).toMatchObject({ planned: 2, ridden: 2, target: 250, power: 250 });
    // Never reached: the ride stopped before it.
    expect(result[2]).toMatchObject({ planned: 4, ridden: 0, power: null, heartRate: null });
  });
});

describe("targetHit and completion", () => {
  it("uses the Ride page's 5% band", () => {
    expect(targetHit(250, 250)).toBe("on");
    expect(targetHit(230, 250)).toBe("under");
    expect(targetHit(270, 250)).toBe("over");
  });

  it("compares by stress, else by time", () => {
    expect(completion({ duration: 3600, stress: 60 }, { durationSeconds: 1800, trainingStress: 45 })).toBe(0.75);
    expect(completion({ duration: 3600, stress: 60 }, { durationSeconds: 1800, trainingStress: null })).toBe(0.5);
  });
});

describe("thinRoute", () => {
  it("drops points closer than the spacing and missing fixes", () => {
    const route = thinRoute([{ lat: 45, lng: -122 }, { lat: 45.00001, lng: -122 }, {}, { lat: 0, lng: 0 }, { lat: 45.001, lng: -122 }, { lat: 45.002, lng: -122 }]);
    expect(route).toEqual([
      [45, -122],
      [45.001, -122],
      [45.002, -122],
    ]);
  });

  it("is null for an indoor ride", () => {
    expect(thinRoute([{}, {}])).toBeNull();
  });

  it("caps the points kept", () => {
    const points = Array.from({ length: 10_000 }, (_, i) => ({ lat: 45 + i * 0.001, lng: -122 }));
    expect(thinRoute(points)!.length).toBeLessThanOrEqual(MAX_ROUTE_POINTS + 1);
  });
});

describe("timed routes and best efforts", () => {
  it("keeps each point's ride second and finds the part ridden between two", () => {
    const route = thinRoute([{ lat: 45, lng: -122, t: 0 }, { lat: 45.001, lng: -122, t: 30 }, { lat: 45.002, lng: -122, t: 60 }])!;
    expect(route[1]).toEqual([45.001, -122, 30]);
    expect(routeBetween(route, 20, 70)).toEqual([
      [45.001, -122],
      [45.002, -122],
    ]);
  });

  it("finds the best window of a chart stream", () => {
    expect(bestWindow([100, 100, 300, 320, 100], 5, 10)).toEqual({ from: 10, to: 20, watts: 310 });
    expect(bestWindow([100], 5, 60)).toBeNull();
  });

  it("puts readings on the resampled clock, gaps over 10 s counting as one", () => {
    expect(gridTimes([0, 1, 2, 60, 61])).toEqual([0, 1, 2, 3, 4]);
  });
});

describe("today's ride", () => {
  const r = (id: string, minutes: number, stress: number | null, hour: number) => ({
    id,
    durationSeconds: minutes * 60,
    trainingStress: stress,
    startedAt: new Date(`2026-11-03T${String(hour).padStart(2, "0")}:00:00Z`),
  });

  it("picks the ride with the most stress and skips short spins", () => {
    const day = dayRides([r("spin", 5, 3, 9), r("easy", 40, 25, 18), r("workout", 70, 73, 12)]);
    expect(day?.main.id).toBe("workout");
    expect(day?.others.map((o) => o.id)).toEqual(["easy"]);
  });

  it("falls back to the longest without stress, and is null without a real ride", () => {
    expect(dayRides([r("a", 30, null, 9), r("b", 50, null, 10)])?.main.id).toBe("b");
    expect(dayRides([r("spin", 4, 2, 9)])).toBeNull();
  });

  it("shows the ride linked to the day first", () => {
    const day = dayRides([r("easy", 40, 25, 18), r("workout", 70, 73, 12)], "easy");
    expect(day?.main.id).toBe("easy");
    expect(day?.others.map((o) => o.id)).toEqual(["workout"]);
  });

  it("smooths and lines the plan up with the stream", () => {
    expect(smooth([100, 200, null, null, 300], 2)).toEqual([150, null, 300]);
    const workout: Workout = { name: "w", segments: [steady(10, 0.5), steady(10, 1)] };
    const targets = plannedTargets(workout, 200, { step: 5, watts: [1, 1, 1, 1, 1], heartRate: null, cadence: null, target: null });
    expect(targets).toEqual([100, 100, 200, 200, null]);
  });
});
