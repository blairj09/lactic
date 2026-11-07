import { describe, expect, it } from "vitest";
import { isRide, rideFromStrava } from "./convert";

const activity = {
  id: 123,
  name: "Zwift - Watopia",
  sport_type: "VirtualRide",
  start_date: "2026-10-28T17:00:00Z",
  moving_time: 1200,
  distance: 10000,
};

describe("Strava rides", () => {
  it("summarizes streams, skipping a paused stretch", () => {
    const time = [...Array.from({ length: 600 }, (_, i) => i), ...Array.from({ length: 600 }, (_, i) => 1000 + i)];
    const ride = rideFromStrava(activity, {
      time: { data: time },
      watts: { data: time.map(() => 200) },
      heartrate: { data: time.map(() => 150) },
    });
    expect(ride).toMatchObject({ source: "strava", externalId: "123", startedAt: "2026-10-28T17:00:00Z", distanceMeters: 10000 });
    expect(ride.summary.durationSeconds).toBe(1200);
    expect(ride.summary.normalizedPower).toBeCloseTo(200);
    expect(ride.summary.averageHeartRate).toBe(150);
  });

  it("falls back to moving time without streams", () => {
    const ride = rideFromStrava({ ...activity, manual: true }, null);
    expect(ride.summary).toMatchObject({ durationSeconds: 1200, normalizedPower: null, powerCurve: null });
  });

  it("knows which sports are rides", () => {
    expect(isRide({ sport_type: "GravelRide" })).toBe(true);
    expect(isRide({ sport_type: "Run" })).toBe(false);
  });
});
