import { describe, expect, it } from "vitest";
import { decodeFit, FIT_SPORT_CYCLING } from "./decode";
import { encodeRideFit, FIT_MANUFACTURER_DEVELOPMENT, fitCrc } from "./encode";
import { rideFromFit } from "./ride";

const startedAt = new Date("2026-10-31T13:00:00Z");
const seconds = 600;
const ride = {
  startedAt,
  watts: Array.from({ length: seconds }, (_, i) => (i < 300 ? 150 : 250)),
  heartRate: Array.from({ length: seconds }, (_, i) => (i < 10 ? 0 : 140)),
  cadence: Array.from({ length: seconds }, () => 90),
};

describe("FIT encoding", () => {
  it("uses the FIT checksum", () => {
    expect(fitCrc([..."123456789"].map((c) => c.charCodeAt(0)))).toBe(0xbb3d);
  });

  it("writes a file whose header and whole-file checksums hold", () => {
    const bytes = encodeRideFit(ride);
    expect(fitCrc(bytes.subarray(0, 14))).toBe(0);
    expect(fitCrc(bytes)).toBe(0);
  });

  it("reads back as the same indoor ride", () => {
    const fit = decodeFit(encodeRideFit(ride));
    expect(fit.manufacturer).toBe(FIT_MANUFACTURER_DEVELOPMENT);
    expect(fit.sport).toBe(FIT_SPORT_CYCLING);
    expect(fit.subSport).toBe(6);
    expect(fit.startTime).toEqual(startedAt);
    expect(fit.totalTimerSeconds).toBe(seconds);
    expect(fit.records).toHaveLength(seconds);
    expect(fit.records[0]).toMatchObject({ timestamp: startedAt, power: 150, cadence: 90, heartRate: undefined });
    expect(fit.records[599]).toMatchObject({ power: 250, heartRate: 140 });

    const imported = rideFromFit(fit, "Sweet spot");
    expect(imported.summary.durationSeconds).toBe(seconds);
    expect(imported.summary.averagePower).toBe(200);
  });

  it("writes a stored 5-second stream with its GPS track as an outdoor ride", () => {
    const fit = decodeFit(
      encodeRideFit({
        startedAt,
        stepSeconds: 5,
        indoor: false,
        watts: [200, 210, 220, 230],
        heartRate: [130, 131, 132, 133],
        cadence: [85, 86, 87, 88],
        route: [
          [45.5, -122.6, 0],
          [45.501, -122.601, 10],
        ],
      }),
    );
    expect(fit.subSport).toBe(7);
    expect(fit.totalTimerSeconds).toBe(20);
    expect(fit.records).toHaveLength(4);
    expect(fit.records[1].timestamp).toEqual(new Date(startedAt.getTime() + 5000));
    expect(fit.records[0].lat).toBeCloseTo(45.5, 5);
    expect(fit.records[0].lng).toBeCloseTo(-122.6, 5);
    expect(fit.records[1].lat).toBeUndefined();
    expect(fit.records[2].lat).toBeCloseTo(45.501, 5);
  });
});
