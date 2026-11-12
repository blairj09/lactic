import { describe, expect, it } from "vitest";
import type { Goal } from "../plan";
import type { Track } from "../race/track";
import { fluidPerHour, sodiumPerHour } from "./fuel";
import { altitudeFactor, altitudeShare, heatFactor, paceCourse } from "./pacing";
import { preRaceReport } from "./prerace";
import { courseProfile } from "./profile";

function course(segments: [number, number][], start = 1000): Track {
  const points: Track["points"] = [];
  let lat = 40;
  let ele = start;
  points.push({ t: null, lat, lng: -111, ele, hr: null, watts: null, cadence: null });
  for (const [meters, grade] of segments) {
    for (let m = 0; m < meters; m += 20) {
      lat += 20 / 111_195;
      ele += 20 * grade;
      points.push({ t: null, lat, lng: -111, ele: Math.round(ele * 10) / 10, hr: null, watts: null, cadence: null });
    }
  }
  return { name: "Test", points };
}

const goal = (over: Partial<Goal> = {}): Goal => ({ id: "g1", name: "High Mountain Fondo", date: "2027-07-10", priority: "A", kind: "granFondo", minutes: 240, intensity: "hard", ...over });
const rider = { ftp: 280, weightKg: 75 };

describe("altitude (Bassett et al. 1999)", () => {
  it("matches the published curves", () => {
    expect(altitudeShare(0, true)).toBeCloseTo(1, 2);
    expect(altitudeShare(2, true)).toBeCloseTo(0.916, 2);
    expect(altitudeShare(2, false)).toBeCloseTo(0.876, 2);
    expect(altitudeShare(2.5, false)).toBeCloseTo(0.837, 2);
  });

  it("costs power above where you live, nothing below it, and nothing when home isn't known", () => {
    expect(altitudeFactor(2500, 0)).toBeCloseTo(0.837, 2);
    expect(altitudeFactor(2500, 1400)).toBeGreaterThan(0.88);
    expect(altitudeFactor(2500, 1400)).toBeLessThan(0.93);
    expect(altitudeFactor(1400, 1400)).toBeCloseTo(1, 5);
    expect(altitudeFactor(500, 1400)).toBeGreaterThan(1);
    expect(altitudeFactor(3000, null)).toBe(1);
  });

  it("slows a high course for a rider from sea level, and the report says so", () => {
    const high = courseProfile(course([[30000, 0.001], [8000, 0.06], [20000, -0.01]], 2200));
    const lowlander = paceCourse(high, goal(), rider, { homeElevation: 0 });
    const local = paceCourse(high, goal(), rider, { homeElevation: 2200 });
    expect(lowlander.seconds).toBeGreaterThan(local.seconds * 1.03);
    expect(lowlander.powerFactor).toBeLessThan(0.9);
    const report = preRaceReport({ goal: goal(), profile: high, rider, forecast: null, today: "2027-05-01", homeElevation: 0 });
    expect(report.altitude).toEqual({ known: true, cost: expect.any(Number) });
    expect(preRaceReport({ goal: goal(), profile: high, rider, forecast: null, today: "2027-05-01" }).altitude).toEqual({ known: false, cost: null });
  });
});

describe("heat (Tatterson et al. 2000)", () => {
  it("costs about 6.5% at 32°C against a mild day", () => {
    expect(heatFactor(20)).toBe(1);
    expect(heatFactor(null)).toBe(1);
    expect(heatFactor(32) / heatFactor(23)).toBeCloseTo(0.935, 2);
    expect(heatFactor(50)).toBe(0.85);
  });
});

describe("fluid and sodium (Sawka et al. 2007)", () => {
  it("stays within 0.4 to 0.8 L an hour, with 460 to 690 mg of sodium a liter", () => {
    for (const t of [null, 0, 15, 22, 28, 40]) {
      const ml = fluidPerHour(t);
      expect(ml).toBeGreaterThanOrEqual(400);
      expect(ml).toBeLessThanOrEqual(800);
      const perLiter = (sodiumPerHour(t) / ml) * 1000;
      expect(perLiter).toBeGreaterThanOrEqual(460);
      expect(perLiter).toBeLessThanOrEqual(690);
    }
  });
});

describe("the range around the estimate", () => {
  it("brackets the estimate, wider for a bunch than riding alone", () => {
    const flat = courseProfile(course([[40000, 0.0005]]));
    const solo = preRaceReport({ goal: goal({ kind: "roadRace", pack: "solo" }), profile: flat, rider, forecast: null, today: "2027-05-01" });
    const bunch = preRaceReport({ goal: goal({ kind: "roadRace", pack: "bunch" }), profile: flat, rider, forecast: null, today: "2027-05-01" });
    for (const r of [solo, bunch]) {
      expect(r.range[0]).toBeLessThan(r.pacing.seconds);
      expect(r.range[1]).toBeGreaterThan(r.pacing.seconds);
    }
    const width = (r: typeof solo) => (r.range[1] - r.range[0]) / r.pacing.seconds;
    expect(width(bunch)).toBeGreaterThan(width(solo));
    // Measured drag narrows it.
    const measured = preRaceReport({ goal: goal({ kind: "roadRace", pack: "solo" }), profile: flat, rider, forecast: null, today: "2027-05-01", setup: { cda: 0.3, crr: 0.0045 } });
    expect(width(measured)).toBeLessThan(width(solo));
  });
});
