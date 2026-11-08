import { describe, expect, it } from "vitest";
import { isPointToPoint, parsePlaces, rises, soloReport } from "./solo";
import { soloAdvice } from "./solo-advice";
import { soloForCoach } from "./solo-brief";
import type { Track, TrackPoint } from "./track";

const fmt = { at: (m: number) => `km ${Math.round(m / 1000)}`, distance: (m: number) => `${Math.round(m / 1000)} km` };

/**
 * A synthetic point-to-point race heading north: 120 km, a 600 m climb from km 30 to 45 and a
 * 300 m one from km 80 to 90, a 5-minute stop at km 60, and power that fades through the day.
 */
function race({ fade = 0.6, speedUp = 1, stopAt = 60_000, stopSeconds = 300, start = 1_725_000_000 } = {}): Track {
  const points: TrackPoint[] = [];
  const lat0 = 41.7;
  const M_PER_DEG = 111_195;
  let m = 0;
  let t = start;
  let stopped = false;
  const ele = (x: number) => {
    if (x < 30_000) return 1400;
    if (x < 45_000) return 1400 + ((x - 30_000) / 15_000) * 600;
    if (x < 60_000) return 2000 - ((x - 45_000) / 15_000) * 600;
    if (x < 80_000) return 1400;
    if (x < 90_000) return 1400 + ((x - 80_000) / 10_000) * 300;
    if (x < 100_000) return 1700 - ((x - 90_000) / 10_000) * 300;
    return 1400;
  };
  while (m < 120_000) {
    const grade = (ele(m + 50) - ele(m - 50)) / 100;
    const progress = m / 120_000;
    const watts = Math.round((grade > 0.01 ? 250 : grade < -0.01 ? 80 : 190) * (1 - (1 - fade) * progress));
    const v = (grade > 0.01 ? 5.5 : grade < -0.01 ? 14 : 9.5) * speedUp * (1 - 0.3 * (1 - fade) * progress);
    points.push({ t, lat: lat0 + m / M_PER_DEG, lng: -111.8, ele: ele(m), hr: Math.round(150 - 15 * progress + grade * 300), watts, cadence: 85 });
    if (!stopped && m >= stopAt) {
      stopped = true;
      for (let k = 0; k < stopSeconds; k++) {
        t += 1;
        points.push({ t, lat: lat0 + m / M_PER_DEG, lng: -111.8, ele: ele(m), hr: 110, watts: 0, cadence: 0 });
      }
    }
    m += v;
    t += 1;
  }
  return { name: "Synthetic point-to-point", points };
}

describe("solo race report", () => {
  const own = race();
  const r = soloReport({ own, ftp: 290, weightKg: 78, places: parsePlaces("Big Summit 45\nFeed 60\n90 km Little Summit") });

  it("knows a point-to-point race from a lapped one", () => {
    expect(isPointToPoint(own)).toBe(true);
    const loop = { name: null, points: [...own.points.slice(0, 10), { ...own.points[0], t: (own.points[9].t as number) + 1 }] };
    expect(isPointToPoint(loop)).toBe(false);
  });

  it("reads named places either way round", () => {
    expect(parsePlaces("Montpelier 122\n136.5 Geneva Summit\nnonsense")).toEqual([
      { name: "Montpelier", km: 122 },
      { name: "Geneva Summit", km: 136.5 },
    ]);
  });

  it("finds the climbs and names them from the places", () => {
    const climbs = r.sections.filter((s) => s.kind === "climb");
    expect(climbs.map((c) => c.label)).toEqual(["Big Summit", "Little Summit"]);
    expect(climbs[0].from).toBeGreaterThan(28_000);
    expect(climbs[0].to).toBeLessThan(47_000);
    expect(climbs[0].gain).toBeGreaterThan(550);
    expect(climbs[1].gain).toBeGreaterThan(250);
    expect(climbs[0].vam).toBeGreaterThan(0);
    // Sections cover the course end to end.
    expect(r.sections[0].from).toBe(0);
    for (let i = 1; i < r.sections.length; i++) expect(r.sections[i].from).toBe(r.sections[i - 1].to);
  });

  it("finds the stop and splits the ride into legs around it", () => {
    expect(r.stops).toHaveLength(1);
    expect(r.stops[0].at).toBeGreaterThan(59_000);
    expect(r.stops[0].at).toBeLessThan(61_000);
    expect(r.stops[0].seconds).toBeGreaterThanOrEqual(290);
    expect(r.stops[0].place).toBe("Feed");
    expect(r.legs.map((l) => [l.fromName, l.toName])).toEqual([
      ["Start", "Feed"],
      ["Feed", "Finish"],
    ]);
    expect(r.elapsed - r.moving).toBeGreaterThanOrEqual(290);
  });

  it("reads the fade, durability and the climbs in order", () => {
    expect(r.quarters).toHaveLength(4);
    expect(r.quarters[3].watts as number).toBeLessThan((r.quarters[0].watts as number) * 0.85);
    expect(r.durability.bands.length).toBeGreaterThanOrEqual(2);
    const advice = soloAdvice(r, fmt);
    const areas = advice.map((a) => a.area);
    expect(areas).toContain("fade");
    expect(areas).toContain("climbs");
    const climbs = advice.find((a) => a.area === "climbs")!;
    expect(climbs.title).toBe("Little Summit cost you most");
  });

  it("uses training's best when it's higher than the race's", () => {
    const withBest = soloReport({ own, ftp: 290, weightKg: 78, bestCurve: { 300: 400, 1200: 330 } });
    expect(withBest.durability.fresh).toEqual({ best5: 400, best20: 330, from: "before" });
    expect(withBest.durability.bands[0].pct20).toBeLessThan(100);
  });

  it("lines up a past edition along the road", () => {
    const before = race({ fade: 0.95, speedUp: 1.05, stopSeconds: 120, start: 1_690_000_000 });
    const withPast = soloReport({ own, ftp: 290, weightKg: 78, others: [{ id: "p", name: "2023", track: before, past: true }] });
    const c = withPast.comparisons[0];
    expect(c.coverage).toBeGreaterThan(0.95);
    expect(c.date).toBe("2023-07-22");
    expect(c.finishGap as number).toBeGreaterThan(0);
    // The gap grows through the race as this year fades.
    expect(c.gap[c.gap.length - 1].gap).toBeGreaterThan(c.gap[Math.floor(c.gap.length / 4)].gap);
    expect(c.sections.every((s) => s.delta !== null)).toBe(true);
    const advice = soloAdvice(withPast, fmt);
    expect(advice.find((a) => a.area === "past")?.title).toMatch(/slower than 2023/);
    const brief = soloForCoach(withPast, advice);
    expect(brief.comparedWith[0].who).toMatch(/earlier edition/);
    expect(brief.sections.length).toBe(withPast.sections.length);
  });

  it("finds rises with false flats and small dips in them", () => {
    const E = new Float64Array(400);
    for (let g = 0; g < 400; g++) E[g] = g < 100 ? 1000 : g < 250 ? 1000 + (g - 100) * 3 + (g === 180 ? -10 : 0) : 1450 - (g - 250) * 2;
    const found = rises(E);
    expect(found).toHaveLength(1);
    expect(found[0][0]).toBeGreaterThanOrEqual(90);
    expect(found[0][0]).toBeLessThanOrEqual(100);
    expect(found[0][1]).toBe(250);
  });
});
