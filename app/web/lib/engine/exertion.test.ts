import { describe, expect, it } from "vitest";
import { columnDaySamples, healthDays, MINUTES_PER_DAY } from "./health-import";
import { dayExertion, exertionBaselineDays, exertionFromTrimp, exertionNormal, exertionTarget, minuteTrimp, streamMinutes, trimpForExertion, type DayExertion } from "./exertion";
import { averageVo2max, fitnessAge, vo2maxFromPower, vo2maxRating } from "./fitness-age";
import { bedtimeSpreadMinutes, sleepDebt, sleepNeedTonight, sleepScore, type SleepNight } from "./sleep-score";
import { recoveryScore } from "./recovery";
import { checkin } from "./checkin";

const heart = { restingHr: 50, maxHr: 185, male: true };
const blank = () => new Array<number | null>(MINUTES_PER_DAY).fill(null);

describe("daytime samples", () => {
  it("puts heart rate on a local minute grid, held up to 10 minutes", () => {
    const [day] = healthDays({
      heartRate: ["2026-11-02T08:00:00-08:00|70", "2026-11-02T08:04:00-08:00|90", "2026-11-02T08:30:00-08:00|60"],
    });
    expect(day.day).toBe("2026-11-02");
    const m = day.hrMinutes;
    expect(m[8 * 60]).toBe(70);
    expect(m[8 * 60 + 3]).toBe(70);
    expect(m[8 * 60 + 4]).toBe(90);
    expect(m[8 * 60 + 13]).toBe(90);
    expect(m[8 * 60 + 14]).toBeNull();
    expect(m[8 * 60 + 30]).toBe(60);
  });

  it("splits heart rate across local midnight", () => {
    const days = healthDays({ heartRate: ["2026-11-01T23:58:00-08:00|55", "2026-11-02T00:20:00-08:00|52"] });
    expect(days.map((d) => d.day)).toEqual(["2026-11-01", "2026-11-02"]);
    expect(days[0].hrMinutes[1439]).toBe(55);
    expect(days[1].hrMinutes[0]).toBe(55);
    expect(days[1].hrMinutes[7]).toBe(55);
    expect(days[1].hrMinutes[8]).toBeNull();
  });

  it("sums energy and steps per day, raw or grouped", () => {
    const days = healthDays({
      activeEnergy: ["2026-11-02T08:00:00-08:00|2026-11-02T08:01:00-08:00|1.5", "2026-11-02T09:00:00-08:00|2026-11-02T09:01:00-08:00|2"],
      steps: ["2026-11-01T00:00:00-08:00|2026-11-02T00:00:00-08:00|8123"],
      vo2max: ["2026-11-02T10:00:00-08:00|51.24"],
    });
    expect(days.find((d) => d.day === "2026-11-01")?.steps).toBe(8123);
    const nov2 = days.find((d) => d.day === "2026-11-02")!;
    expect(nov2.activeKcal).toBe(4);
    expect(nov2.vo2max).toBe(51.2);
  });

  it("pairs the shortcut's lists", () => {
    expect(columnDaySamples({ sleepStart: "x" })).toBeNull();
    const c = columnDaySamples({ heartRateDate: "a\nb", heartRateValue: "60\n61" })!;
    expect(c.heartRate).toEqual(["a|60", "b|61"]);
    expect(() => columnDaySamples({ heartRateDate: "a\nb", heartRateValue: "60" })).toThrow();
  });
});

describe("exertion", () => {
  it("ignores easy heart rate and weights hard minutes more", () => {
    expect(minuteTrimp(70, heart)).toBe(0);
    expect(minuteTrimp(170, heart)).toBeGreaterThan(minuteTrimp(140, heart) * 1.5);
  });

  it("maps TRIMP to a 0-10 scale", () => {
    expect(exertionFromTrimp(0)).toBe(0);
    const hour = exertionFromTrimp(90);
    expect(hour).toBeGreaterThan(4.5);
    expect(hour).toBeLessThan(5.5);
    expect(exertionFromTrimp(5000)).toBe(10);
    expect(exertionFromTrimp(trimpForExertion(6))).toBeCloseTo(6, 1);
  });

  it("lets the ride's strap win inside the ride, and splits on and off the bike", () => {
    const watch = blank();
    for (let m = 0; m < MINUTES_PER_DAY; m++) watch[m] = 65;
    for (let m = 600; m < 660; m++) watch[m] = 120; // a brisk hour off the bike
    for (let m = 900; m < 960; m++) watch[m] = 100; // the watch reads low during the ride
    const ride = { startMinute: 900, bpm: new Array(60).fill(150) };
    const d = dayExertion("2026-11-02", watch, [ride], heart);
    expect(d.coveredMinutes).toBe(MINUTES_PER_DAY);
    expect(d.rideTrimp).toBeGreaterThan(d.offBikeTrimp);
    expect(d.offBikeTrimp).toBeGreaterThan(20);
    expect(d.bandMinutes[2]).toBe(60);
    const without = dayExertion("2026-11-02", watch, [], heart);
    expect(d.exertion).toBeGreaterThan(without.exertion);
  });

  it("averages a 5-second stream per minute", () => {
    expect(streamMinutes([100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 0, 0, 140], 5)).toEqual([100, 140]);
  });

  it("builds a normal from covered days and a target from recovery", () => {
    const days: DayExertion[] = Array.from({ length: 10 }, (_, i) => ({
      day: `2026-10-${String(20 + i).padStart(2, "0")}`,
      exertion: i % 2 ? 6 : 4,
      trimp: 0,
      rideTrimp: 0,
      offBikeTrimp: 0,
      bandMinutes: [0, 0, 0, 0],
      coveredMinutes: 1000,
    }));
    const normal = exertionNormal(days, "2026-10-30")!;
    expect(normal.mean).toBe(5);
    expect(normal.days).toBe(10);
    expect(exertionBaselineDays(days, "2026-10-30")).toBe(10);
    expect(exertionNormal(days.slice(0, 3), "2026-10-30")).toBeNull();
    expect(exertionTarget(50, normal)).toEqual({ low: 4.5, high: 5.5 });
    expect(exertionTarget(80, normal)!.low).toBeGreaterThan(5);
    expect(exertionTarget(null, normal)).toBeNull();
  });
});

describe("fitness age", () => {
  it("estimates VO2 max from 5-minute power", () => {
    expect(vo2maxFromPower(350, 75)).toBe(57.4);
    expect(vo2maxFromPower(0, 75)).toBeNull();
  });

  it("finds the age whose average matches", () => {
    expect(averageVo2max(45, "male")).toBeCloseTo(47.7);
    expect(averageVo2max(40, "male")).toBeCloseTo(48.35);
    expect(fitnessAge(47.7, "male")).toBe(45);
    expect(fitnessAge(70, "male")).toBe(20);
    expect(fitnessAge(15, "male")).toBe(90);
    expect(vo2maxRating(57, 40, "male")).toBe("Above average for your age");
  });
});

describe("sleep score", () => {
  const night = (day: string, asleep: number, bed: number, extra: Partial<SleepNight> = {}): SleepNight => ({
    day,
    asleepHours: asleep,
    awakeHours: 0.3,
    deepHours: asleep * 0.15,
    remHours: asleep * 0.25,
    start: null,
    end: null,
    bedMinute: bed,
    ...extra,
  });

  it("scores a full regular night near the top", () => {
    const previous = Array.from({ length: 10 }, (_, i) => night(`2026-10-${20 + i}`, 8, 22 * 60 + 30));
    const s = sleepScore(night("2026-10-31", 8, 22 * 60 + 40), previous, 8)!;
    expect(s.score).toBeGreaterThan(90);
    const short = sleepScore(night("2026-10-31", 5, 22 * 60 + 40), previous, 8)!;
    expect(short.score).toBeLessThan(s.score - 15);
  });

  it("reports plain measures beside the clamped parts", () => {
    // James's 2026-11-04 night: 5h30 asleep, 2h38 awake, 39m deep, 1h02 REM, need 8h.
    const s = sleepScore({ ...night("2026-11-04", 5.5, 23 * 60), awakeHours: 2 + 38 / 60, deepHours: 0.65, remHours: 31 / 30 }, [], 8)!;
    expect(s.parts.efficiency).toBe(0);
    expect(s.measures).toEqual({ ofNeed: 69, asleep: 68, deepRem: 31 });
  });

  it("keeps sleep debt and pays it back at half rate", () => {
    const nights = [night("a", 6, 0), night("b", 6, 0), night("c", 10, 0)];
    expect(sleepDebt(nights, 8)).toBe(3);
    expect(sleepNeedTonight(8, 3, 8)).toBe(9.25);
  });

  it("counts sleep debt over the last 7 dates, not the last 7 nights on record", () => {
    // A week away from the watch: nights 9 and 10 days back mustn't count this week.
    const nights = [night("2026-11-01", 4, 0), night("2026-11-02", 4, 0), night("2026-11-10", 7, 0), night("2026-11-11", 7, 0)];
    expect(sleepDebt(nights, 8, 7, "2026-11-11")).toBe(2);
    expect(sleepDebt(nights, 8)).toBe(10);
  });

  it("measures bedtime spread across midnight", () => {
    const nights = [23 * 60, 23 * 60 + 30, 30, 23 * 60 + 15, 23 * 60 + 45].map((b, i) => night(String(i), 8, b));
    expect(bedtimeSpreadMinutes(nights)).toBe(24);
    expect(bedtimeSpreadMinutes(nights.slice(0, 3))).toBeNull();
  });
});

describe("yesterday's exertion in recovery and today's options", () => {
  const baseline = Array.from({ length: 20 }, (_, i) => ({ hrv: 50 + (i % 5), restingHeartRate: 50 + (i % 3) }));
  const today = { hrv: 52, restingHeartRate: 51, sleepHours: 8 };

  it("a big day costs recovery points and says so", () => {
    const plain = recoveryScore(today, baseline, 8)!;
    const big = recoveryScore(today, baseline, 8, { exertion: 8.5, normal: { mean: 5, sd: 1, days: 20 } })!;
    const easy = recoveryScore(today, baseline, 8, { exertion: 2, normal: { mean: 5, sd: 1, days: 20 } })!;
    expect(big.score).toBeLessThan(plain.score);
    expect(easy.score).toBeGreaterThan(plain.score);
    expect(big.reasons.some((r) => r.startsWith("A big day yesterday"))).toBe(true);
  });

  it("a big day off the bike nudges today's pick", () => {
    const base = { planned: null, recovery: 50, form: 0, fitness: 50, feel: 3 as const };
    expect(checkin(base).strain).toBe(0);
    const tired = checkin({ ...base, offBikeTrimp: 120 });
    expect(tired.strain).toBe(1);
    expect(tired.reasons).toContain("A big day off the bike yesterday");
  });
});
