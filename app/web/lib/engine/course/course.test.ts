import { describe, expect, it } from "vitest";
import { buildPlan, type Goal } from "../plan";
import { STARTING_LEVELS } from "../library";
import { parseGpx, parseTcx, type Track } from "../race/track";
import { fuelPlan, kitList } from "./fuel";
import { paceCourse, speedFor, bikeSetup, climbFraction } from "./pacing";
import { courseProfile, elevationSamples, fillElevation, summarize, thinTrack } from "./profile";
import { preRaceReport } from "./prerace";
import { courseDemands, courseShape } from "./shape";
import { forecastStale, forecastUrl, parseForecast, raceWeather, samplePoints, type Forecast } from "./weather";

/** A course heading north: `segments` of [meters, grade]. */
function course(segments: [number, number][], name = "Test course"): Track {
  const points: Track["points"] = [];
  let lat = 40;
  let ele = 1000;
  points.push({ t: null, lat, lng: -111, ele, hr: null, watts: null, cadence: null });
  for (const [meters, grade] of segments) {
    for (let m = 0; m < meters; m += 20) {
      lat += 20 / 111_195;
      ele += 20 * grade;
      points.push({ t: null, lat, lng: -111, ele: Math.round(ele * 10) / 10, hr: null, watts: null, cadence: null });
    }
  }
  return { name, points };
}

const goal = (over: Partial<Goal> = {}): Goal => ({ id: "g1", name: "Big Climb Classic", date: "2026-12-12", priority: "A", kind: "roadRace", minutes: 180, intensity: "hard", ...over });

const hilly = course([
  [10000, 0],
  [8000, 0.065],
  [8000, -0.065],
  [20000, 0.002],
  [1500, 0.08],
  [10000, 0],
  [2000, 0.06],
  [500, 0],
]);

describe("course profile", () => {
  it("finds the climbs, gain and kind of course", () => {
    const p = courseProfile(hilly);
    expect(p.meters).toBeGreaterThan(59000);
    expect(p.meters).toBeLessThan(61000);
    expect(p.climbs.length).toBe(3);
    const [big, kick, finish] = p.climbs;
    expect(big.from).toBeGreaterThan(9000);
    expect(big.to).toBeLessThan(19000);
    expect(big.gain).toBeGreaterThan(480);
    expect(big.grade).toBeCloseTo(0.065, 1);
    expect(kick.gain).toBeGreaterThan(90);
    expect(finish.from).toBeGreaterThan(57000);
    expect(p.type).toBe("hilly");
    expect(p.loop).toBe(false);
  });

  it("calls a course with no heights flat", () => {
    const flat = { ...hilly, points: hilly.points.map((x) => ({ ...x, ele: null })) };
    const p = courseProfile(flat);
    expect(p.hasElevation).toBe(false);
    expect(p.climbs).toEqual([]);
  });

  it("thins a dense track and fills heights from samples", () => {
    const thin = thinTrack(hilly, 1000);
    expect(thin.points.length).toBeLessThanOrEqual(1002);
    const bare = { ...thin, points: thin.points.map((x) => ({ ...x, ele: null })) };
    const samples = elevationSamples(bare, 500).map((s) => ({ index: s.index, ele: thin.points[s.index].ele as number }));
    const filled = fillElevation(bare, samples);
    expect(courseProfile(filled).climbs.length).toBeGreaterThanOrEqual(2);
  });

  it("reads TCX courses and GPX routes", () => {
    const tcx = `<?xml version="1.0"?><TrainingCenterDatabase><Courses><Course><Name>Loop</Name><Track>
      <Trackpoint><Position><LatitudeDegrees>40.0</LatitudeDegrees><LongitudeDegrees>-111.0</LongitudeDegrees></Position><AltitudeMeters>1000</AltitudeMeters></Trackpoint>
      <Trackpoint><Position><LatitudeDegrees>40.01</LatitudeDegrees><LongitudeDegrees>-111.0</LongitudeDegrees></Position><AltitudeMeters>1010</AltitudeMeters></Trackpoint>
      </Track></Course></Courses></TrainingCenterDatabase>`;
    const t = parseTcx(tcx);
    expect(t.name).toBe("Loop");
    expect(t.points).toHaveLength(2);
    expect(t.points[1].ele).toBe(1010);
    const gpx = `<gpx><rte><name>Route</name><rtept lat="40" lon="-111"><ele>5</ele></rtept><rtept lat="40.01" lon="-111"/></rte></gpx>`;
    expect(parseGpx(gpx).points).toHaveLength(2);
  });
});

describe("pacing", () => {
  it("rides faster on the flat than up a climb, and caps descents", () => {
    const s = bikeSetup("roadRace");
    const flat = speedFor(250, 0, 83, s, 1.2);
    const up = speedFor(250, 0.07, 83, s, 1.2);
    const down = speedFor(100, -0.08, 83, s, 1.2);
    expect(flat * 3.6).toBeGreaterThan(35);
    expect(up * 3.6).toBeLessThan(15);
    expect(down * 3.6).toBeLessThanOrEqual(70.01);
    expect(speedFor(250, 0, 83, s, 1.2, 5)).toBeLessThan(flat);
  });

  it("holds more than FTP on short climbs and less on long ones, less again on long days", () => {
    expect(climbFraction(150, 1, "hard")).toBeGreaterThan(1.1);
    expect(climbFraction(40 * 60, 1, "hard")).toBeLessThan(1);
    expect(climbFraction(10 * 60, 5, "hard")).toBeLessThan(climbFraction(10 * 60, 1, "hard"));
  });

  it("times the course and each climb from FTP and weight", () => {
    const p = courseProfile(hilly);
    const pace = paceCourse(p, goal(), { ftp: 290, weightKg: 77 });
    expect(pace.assumedFtp).toBe(false);
    const hours = pace.seconds / 3600;
    expect(hours).toBeGreaterThan(1.4);
    expect(hours).toBeLessThan(2.4);
    const big = pace.climbs[0];
    expect(big.seconds / 60).toBeGreaterThan(18);
    expect(big.seconds / 60).toBeLessThan(35);
    expect(big.watts[1]).toBeGreaterThan(240);
    expect(big.watts[1]).toBeLessThan(300);
    // A weaker rider is slower.
    expect(paceCourse(p, goal(), { ftp: 200, weightKg: 77 }).seconds).toBeGreaterThan(pace.seconds);
  });

  it("guesses a typical rider without FTP or weight", () => {
    const pace = paceCourse(courseProfile(hilly), goal(), { ftp: null, weightKg: null });
    expect(pace.assumedFtp).toBe(true);
    expect(pace.assumedWeight).toBe(true);
    expect(pace.ftp).toBe(210);
  });
});

describe("course shape", () => {
  it("trains a half-hour climb with long sweet spot blocks", () => {
    const p = courseProfile(hilly);
    const d = courseDemands(summarize(p), "roadRace", goal(), { ftp: 290, weightKg: 77 });
    expect(d.longestClimb).toBeGreaterThan(25);
    const shape = courseShape({ ...goal(), course: d });
    expect(shape?.zones[0]).toBe("sweetSpot");
    expect(shape?.focus).toContain("sustained");
    expect(shape?.climb).toEqual({ zone: "sweetSpot", seconds: d.longestClimb * 60 });
  });

  it("trains a 15 to 25 minute climb with threshold blocks", () => {
    const p = courseProfile(course([[5000, 0], [5000, 0.06], [5000, -0.06], [5000, 0]]));
    const d = courseDemands(summarize(p), "roadRace", goal(), { ftp: 290, weightKg: 77 });
    expect(d.longestClimb).toBeGreaterThanOrEqual(15);
    expect(d.longestClimb).toBeLessThanOrEqual(25);
    const shape = courseShape({ ...goal(), course: d });
    expect(shape?.zones[0]).toBe("threshold");
    expect(shape?.climb?.zone).toBe("threshold");
  });

  it("trains short kicks with VO2 max repeats", () => {
    const punchy = course(Array.from({ length: 6 }, () => [[4000, 0], [600, 0.08], [600, -0.08]] as [number, number][]).flat());
    const d = courseDemands(summarize(courseProfile(punchy)), "roadRace", goal({ minutes: 120 }), { ftp: 290, weightKg: 77 });
    expect(d.kicks).toBeGreaterThanOrEqual(3);
    const shape = courseShape({ ...goal(), course: d });
    expect(shape?.zones).toEqual(["vo2max", "anaerobic"]);
  });

  it("leaves a flat course to the event's kind", () => {
    const flat = course([[40000, 0]]);
    const d = courseDemands(summarize(courseProfile(flat)), "roadRace", goal(), { ftp: 290, weightKg: 77 });
    expect(courseShape({ ...goal(), course: d })).toBeNull();
  });

  it("puts climb-length intervals in the plan's build and specialty weeks", () => {
    const d = courseDemands(summarize(courseProfile(hilly)), "roadRace", goal(), { ftp: 290, weightKg: 77 });
    const input = {
      today: "2026-11-10",
      availability: [0, 90, 75, 90, 0, 180, 120] as [number, number, number, number, number, number, number],
      fitness: 50,
      fatigue: 50,
      levels: { ...STARTING_LEVELS, threshold: 5, sweetSpot: 5 },
    };
    const shaped = buildPlan({ ...input, goals: [{ ...goal(), course: d }] });
    const plain = buildPlan({ ...input, goals: [goal()] });
    const shapedDays = shaped.weeks.flatMap((w) => w.days).filter((day) => day.course);
    expect(shapedDays.length).toBeGreaterThan(0);
    for (const day of shapedDays) {
      expect(day.role).toBe("key");
      expect(["threshold", "sweetSpot"]).toContain(day.session?.zone);
    }
    expect(plain.weeks.flatMap((w) => w.days).some((day) => day.course)).toBe(false);
  });
});

function forecastFor(date: string, windFrom: number, windKmh: number, feels = 20): Forecast {
  const hours = Array.from({ length: 48 }, (_, h) => {
    const day = h < 24 ? date : "2026-12-13";
    return { time: `${day}T${String(h % 24).padStart(2, "0")}:00`, temp: feels, feels, rainChance: 10, rainMm: 0, windKmh, windFrom, gustKmh: windKmh * 1.5, code: 1 };
  });
  return { fetchedAt: "2026-12-01T00:00:00Z", date, points: [{ km: 0, lat: 40, lng: -111, hours }], sunrise: null, sunset: null };
}

describe("weather", () => {
  it("asks for the start and points along the way", () => {
    const p = courseProfile(hilly);
    const points = samplePoints(p);
    expect(points.length).toBe(3);
    expect(points[0].km).toBe(0);
    const url = forecastUrl(points, "2026-12-12");
    expect(url).toContain("api.open-meteo.com");
    expect(url).toContain("start_date=2026-12-12");
  });

  it("reads Open-Meteo's answer for one or several points", () => {
    const one = { hourly: { time: ["2026-12-12T09:00"], temperature_2m: [12], apparent_temperature: [10], precipitation_probability: [40], precipitation: [0.2], wind_speed_10m: [15], wind_direction_10m: [180], wind_gusts_10m: [30], weather_code: [61] }, daily: { time: ["2026-12-12"], sunrise: ["2026-12-12T07:30"], sunset: ["2026-12-12T17:00"] } };
    const f = parseForecast(one, [{ km: 0, lat: 40, lng: -111 }], "2026-12-12", "2026-12-01T00:00:00Z");
    expect(f.points[0].hours[0]).toMatchObject({ temp: 12, feels: 10, windFrom: 180, code: 61 });
    expect(f.sunrise).toBe("2026-12-12T07:30");
    expect(() => parseForecast({ error: true, reason: "out of range" }, [{ km: 0, lat: 40, lng: -111 }], "2026-12-12", "x")).toThrow(/out of range/);
  });

  it("finds a headwind on a course heading into the wind", () => {
    const p = courseProfile(hilly);
    const pace = paceCourse(p, goal(), { ftp: 290, weightKg: 77 });
    const into = raceWeather(p, pace, forecastFor("2026-12-12", 0, 30), "09:00")!;
    expect(into.head).toBeGreaterThan(0.9);
    expect(into.worst?.kmh).toBeGreaterThan(15);
    const behind = raceWeather(p, pace, forecastFor("2026-12-12", 180, 30), "09:00")!;
    expect(behind.tail).toBeGreaterThan(0.9);
    expect(behind.worst).toBeNull();
  });

  it("fetches only inside the forecast window, and again as it ages", () => {
    const now = new Date("2026-12-05T12:00:00Z");
    expect(forecastStale(null, "2026-12-30", "2026-12-05", now)).toBe(false);
    expect(forecastStale(null, "2026-12-12", "2026-12-05", now)).toBe(true);
    const fresh = { ...forecastFor("2026-12-12", 0, 10), fetchedAt: "2026-12-05T10:00:00Z" };
    expect(forecastStale(fresh, "2026-12-12", "2026-12-05", now)).toBe(false);
    expect(forecastStale({ ...fresh, fetchedAt: "2026-12-05T01:00:00Z" }, "2026-12-12", "2026-12-05", now)).toBe(true);
  });
});

describe("fuel and the report", () => {
  it("fuels a long race, moving feeds off the climbs, and drinks more in heat", () => {
    const p = courseProfile(hilly);
    const pace = paceCourse(p, goal(), { ftp: 290, weightKg: 77 });
    const mild = fuelPlan(goal(), p, pace, null, 77);
    expect(mild.carbsPerHour).toBe(60);
    expect(mild.feeds.length).toBeGreaterThan(2);
    for (const f of mild.feeds) {
      const inside = pace.climbs.find((c) => c.seconds >= 240 && f.seconds > c.startsAt + 30 && f.seconds < c.startsAt + c.seconds - 30);
      expect(inside).toBeUndefined();
    }
    const hot = fuelPlan(goal(), p, pace, raceWeather(p, pace, forecastFor("2026-12-12", 90, 10, 32), "09:00"), 77);
    expect(hot.fluidPerHour).toBeGreaterThan(mild.fluidPerHour);
    expect(hot.carbLoad?.meal).toBe(150);
  });

  it("dresses for the cold and the rain", () => {
    const p = courseProfile(hilly);
    const pace = paceCourse(p, goal(), { ftp: 290, weightKg: 77 });
    const cold = raceWeather(p, pace, { ...forecastFor("2026-12-12", 0, 10, 4) }, "09:00")!;
    expect(kitList(cold, p, goal())[0]).toMatch(/Winter kit/);
  });

  it("puts it all together, with the forecast only inside its window", () => {
    const p = courseProfile(hilly);
    const early = preRaceReport({ goal: goal(), profile: p, rider: { ftp: 290, weightKg: 77 }, forecast: null, today: "2026-11-10" });
    expect(early.forecastState).toBe("early");
    expect(early.forecastOpens).toBe("2026-11-27");
    expect(early.weather).toBeNull();
    expect(early.tips.some((t) => t.startsWith("Climb 1"))).toBe(true);
    expect(early.shape?.climb).not.toBeNull();
    const ready = preRaceReport({ goal: goal({ startTime: "08:00" }), profile: p, rider: { ftp: 290, weightKg: 77 }, forecast: forecastFor("2026-12-12", 0, 30), today: "2026-12-10" });
    expect(ready.forecastState).toBe("ready");
    expect(ready.weather?.assumedStart).toBe(false);
    // Into a headwind the race takes longer.
    expect(ready.pacing.seconds).toBeGreaterThan(early.pacing.seconds);
    expect(ready.tips.some((t) => t.includes("headwind"))).toBe(true);
  });
});
