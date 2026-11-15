import { describe, expect, it } from "vitest";
import { intervalAt, intervals, ramp, steady, type Workout } from "../engine/workout";
import { liveActivity, NUMBERS_EVERY, worthSending, type LiveRide } from "./live-activity";

const workout: Workout = {
  name: "Sweet spot 3x12",
  segments: [ramp(600, 0.5, 0.7), steady(720, 0.9), steady(300, 0.5), steady(720, 0.9), steady(300, 0.5), steady(720, 0.9), ramp(600, 0.65, 0.45)],
};
const NOW = 1_800_000_000_000;

function at(position: number, extra: Partial<LiveRide> = {}): LiveRide {
  const current = intervalAt(workout, position);
  const all = intervals(workout);
  return {
    workout,
    ftp: 300,
    position,
    duration: 3960,
    current,
    upcoming: current ? all.slice(current.index + 1) : [],
    intervalCount: all.length,
    targetWatts: 270,
    powerAverage: 268.4,
    heartRate: 152,
    cadence: 92,
    running: true,
    elapsed: position,
    erg: null,
    allOut: false,
    finished: false,
    ended: false,
    totals: { power: 210, heartRate: 140, cadence: 90, tss: 87.6 },
    ...extra,
  };
}

describe("ride Live Activity", () => {
  it("counts down the interval and the workout from now", () => {
    const s = liveActivity(at(1900), NOW)!;
    expect(s).toMatchObject({ phase: "riding", title: "Sweet spot 3x12", place: null, counter: "Interval 4 of 7", target: "270 W", power: 268, heartRate: 152, cadence: 92, tone: "on" });
    expect(s.intervalEnd).toBe(NOW / 1000 + (2340 - 1900));
    expect(s.rideEnd).toBe(NOW / 1000 + (3960 - 1900));
    expect(s.step).toBe(4);
    expect(s.next).toMatch(/^.+ 5:00 · 150 W$/);
    expect(s.at).toBeCloseTo(1900 / 3960, 3);
    expect(s.bar.reduce((t, b) => t + b.share, 0)).toBeCloseTo(1, 3);
  });

  it("says where the ride is when it's on the computer", () => {
    expect(liveActivity(at(1900), NOW, "On MacBook")?.place).toBe("On MacBook");
  });

  it("judges power against the target", () => {
    expect(liveActivity(at(1900, { powerAverage: 240 }), NOW)?.tone).toBe("under");
    expect(liveActivity(at(1900, { powerAverage: 300 }), NOW)?.tone).toBe("over");
    expect(liveActivity(at(1900, { allOut: true, targetWatts: null }), NOW)).toMatchObject({ tone: null, target: "All out" });
  });

  it("holds the countdowns and hides live numbers while paused", () => {
    const s = liveActivity(at(1900, { running: false }), NOW)!;
    expect(s).toMatchObject({ phase: "paused", intervalEnd: null, rideEnd: null, intervalLeft: 440, rideLeft: 2060, power: null, heartRate: null, tone: null });
  });

  it("waits for the first pedal stroke with the first interval", () => {
    const s = liveActivity(at(0, { running: false, elapsed: 0 }), NOW)!;
    expect(s.phase).toBe("ready");
    expect(s.note).toMatch(/^Warm-up 10:00 · 150-210 W first$/);
  });

  it("is done with the ride's time and stress, and goes away after End", () => {
    expect(liveActivity(at(3960, { running: false, finished: true, current: null, elapsed: 4500 }), NOW)).toMatchObject({ phase: "done", note: "1:15:00 · 88 TSS" });
    expect(liveActivity(at(3960, { ended: true }), NOW)).toBeNull();
    expect(liveActivity(null, NOW)).toBeNull();
  });

  it("shows free ERG's target and clock with no workout bar", () => {
    const s = liveActivity(at(600, { erg: { watts: 210 }, powerAverage: 212, elapsed: 1445 }), NOW)!;
    expect(s).toMatchObject({ title: "Free ERG", target: "210 W", tone: "on", interval: null, counter: null, rideEnd: null, bar: [], next: null });
    expect(s.started).toBe(NOW / 1000 - 1445);
  });

  it("keeps a long workout's bar short", () => {
    const many: Workout = { name: "Over-unders", segments: Array.from({ length: 200 }, (_, i) => steady(30 + (i % 7), i % 2 ? 0.5 : 1.1)) };
    const s = liveActivity({ ...at(10), workout: many, current: intervals(many)[0], upcoming: [] }, NOW)!;
    expect(s.bar.length).toBeLessThanOrEqual(48);
    expect(s.bar.reduce((t, b) => t + b.share, 0)).toBeCloseTo(1, 2);
  });
});

describe("when to update the Live Activity", () => {
  const first = liveActivity(at(1900), NOW)!;

  it("sends a new interval, phase or moved countdown straight away", () => {
    expect(worthSending(null, 0, first, NOW)).toBe(true);
    expect(worthSending(first, NOW, liveActivity(at(2400), NOW + 500)!, NOW + 500)).toBe(true);
    expect(worthSending(first, NOW, liveActivity(at(1900, { running: false }), NOW + 500)!, NOW + 500)).toBe(true);
    // The clock and the ride agree a second later: nothing to say.
    expect(worthSending(first, NOW, liveActivity(at(1901), NOW + 1000)!, NOW + 1000)).toBe(false);
    // Skipped ahead 30 seconds within the interval: the countdown moved.
    expect(worthSending(first, NOW, liveActivity(at(1930), NOW + 1000)!, NOW + 1000)).toBe(true);
  });

  it("sends new power and heart rate at most every two seconds", () => {
    const busier = liveActivity(at(1901, { powerAverage: 280, heartRate: 155 }), NOW + 1000)!;
    expect(worthSending(first, NOW, busier, NOW + 1000)).toBe(false);
    expect(worthSending(first, NOW, busier, NOW + NUMBERS_EVERY)).toBe(true);
  });
});
