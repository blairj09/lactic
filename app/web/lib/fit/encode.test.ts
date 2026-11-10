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

  it("names Lactic as the product", () => {
    const bytes = encodeRideFit(ride);
    const text = String.fromCharCode(...bytes.subarray(0, 80));
    expect(text).toContain("Lactic\u0000");
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

  it("writes a lap per workout block, each with its own numbers", () => {
    const fit = decodeFit(encodeRideFit({ ...ride, laps: [300, 450] }));
    expect(fit.laps.map((l) => [l.startTime.getTime() - startedAt.getTime(), l.totalElapsedSeconds])).toEqual([
      [0, 300],
      [300_000, 150],
      [450_000, 150],
    ]);
    expect(fit.laps.map((l) => l.averagePower)).toEqual([150, 250, 250]);
    expect(fit.laps[0].averageHeartRate).toBe(140); // the seconds without a reading are left out
    expect(fit.totalTimerSeconds).toBe(seconds);
    expect(fitCrc(encodeRideFit({ ...ride, laps: [300, 450] }))).toBe(0);
  });

  it("keeps one lap without blocks, and drops lap starts outside the ride", () => {
    expect(decodeFit(encodeRideFit(ride)).laps).toHaveLength(1);
    expect(decodeFit(encodeRideFit({ ...ride, laps: [0, 600, 900] })).laps).toHaveLength(1);
    // A 5-second stream puts the boundary on the nearest sample.
    const stored = decodeFit(encodeRideFit({ startedAt, stepSeconds: 5, watts: [100, 100, 200, 200], heartRate: [], cadence: [], laps: [10] }));
    expect(stored.laps.map((l) => [l.totalElapsedSeconds, l.averagePower])).toEqual([
      [10, 100],
      [10, 200],
    ]);
  });
});
