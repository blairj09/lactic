import { describe, expect, it } from "vitest";
import { raceAdvice, stretches } from "./advice";
import { raceForCoach } from "./brief";
import { fitCourse } from "./course";
import { BEST_LAP_ID, raceReport } from "./report";
import { findRow, formatClock, parseClock, parseResults } from "./results";
import { isTimed, packTrack, parseGpx, unpackTrack, type Track, type TrackPoint } from "./track";

// A made-up lap: a long start/finish straight, a hairpin, a short climb, and back. Meters east/north.
const LAP: [number, number][] = [
  [0, 0], [200, 0], [215, 8], [215, 22], [200, 30], [120, 30], [100, 50], [100, 80], [-40, 80], [-60, 60], [-60, 20], [-40, 0], [0, 0],
];
const LAT0 = 40.58;
const LNG0 = -112.37;
const kx = 6_371_000 * (Math.PI / 180) * Math.cos((LAT0 * Math.PI) / 180);
const ky = 6_371_000 * (Math.PI / 180);

function lapPoint(d: number): [number, number] {
  let left = d;
  for (let i = 0; i < LAP.length - 1; i++) {
    const [x0, y0] = LAP[i];
    const [x1, y1] = LAP[i + 1];
    const len = Math.hypot(x1 - x0, y1 - y0);
    if (left <= len) return [x0 + ((x1 - x0) * left) / len, y0 + ((y1 - y0) * left) / len];
    left -= len;
  }
  return LAP[LAP.length - 1];
}
const LAP_LENGTH = LAP.slice(1).reduce((a, p, i) => a + Math.hypot(p[0] - LAP[i][0], p[1] - LAP[i][1]), 0);
// The climb runs north from (100, 30) to (100, 80): 6 m up.
const eleAt = (x: number, y: number) => (x >= 95 && x <= 105 && y >= 30 ? 1340 + ((Math.min(y, 80) - 30) / 50) * 6 : x > 105 && y >= 29 ? 1340 : y > 80 - 1 ? 1346 - Math.max(0, (100 - x) / 160) * 6 : 1340);

/** A rider doing `laps` laps from 10 m behind the line, at `speed(d)` m/s (d = meters into the lap), one point a second. */
function ride(laps: number, speed: (d: number, lap: number) => number, start = 1_794_067_000, timed = true, hr = true): Track {
  const points: TrackPoint[] = [];
  let d = -10;
  let lap = 0;
  let t = start;
  // Standing on the grid for a few seconds first.
  for (let i = 0; i < 5; i++) points.push(pt(-10, t++, timed, hr));
  while (lap < laps) {
    const m = ((d % LAP_LENGTH) + LAP_LENGTH) % LAP_LENGTH;
    d += speed(m, lap);
    if (d >= (lap + 1) * LAP_LENGTH) lap++;
    points.push(pt(d, t++, timed, hr));
  }
  // Rolling on past the line.
  for (let i = 0; i < 5; i++) points.push(pt((d += 3), t++, timed, hr));
  return { name: "Test race", points };
}
function pt(d: number, t: number, timed: boolean, hr: boolean): TrackPoint {
  const m = ((d % LAP_LENGTH) + LAP_LENGTH) % LAP_LENGTH;
  const [x, y] = lapPoint(m);
  return { t: timed ? t : null, lat: LAT0 + y / ky, lng: LNG0 + x / kx, ele: eleAt(x, y), hr: hr ? 165 : null, watts: null, cadence: null };
}

// The hairpin is about 200-235 m into the lap.
const inHairpin = (d: number) => d > 195 && d < 240;
const onClimb = (d: number) => d > 330 && d < 380;
const steady = () => 6;
const slowHairpin = (d: number) => (inHairpin(d) ? 3 : 6);

const toGpx = (track: Track) =>
  `<?xml version="1.0"?><gpx version="1.1" creator="test"><trk><name>${track.name}</name><trkseg>${track.points
    .map(
      (p) =>
        `<trkpt lat="${p.lat}" lon="${p.lng}"><ele>${p.ele}</ele>${p.t !== null ? `<time>${new Date(p.t * 1000).toISOString()}</time>` : ""}${p.hr !== null ? `<extensions><gpxtpx:TrackPointExtension><gpxtpx:hr>${p.hr}</gpxtpx:hr></gpxtpx:TrackPointExtension></extensions>` : ""}</trkpt>`,
    )
    .join("")}</trkseg></trk></gpx>`;

describe("GPX", () => {
  it("reads positions, times, elevation and heart rate", () => {
    const track = parseGpx(toGpx(ride(1, steady)));
    expect(track.name).toBe("Test race");
    expect(isTimed(track)).toBe(true);
    expect(track.points[0].hr).toBe(165);
    expect(track.points[0].ele).toBeCloseTo(1340);
  });

  it("reads a file without times (Strava's export of someone else's ride)", () => {
    const track = parseGpx(toGpx(ride(1, steady, 0, false, false)));
    expect(isTimed(track)).toBe(false);
    expect(track.points.every((p) => p.hr === null)).toBe(true);
  });

  it("packs and unpacks", () => {
    const track = ride(1, steady);
    const back = unpackTrack(JSON.parse(JSON.stringify(packTrack(track))));
    expect(back.points.length).toBe(track.points.length);
    expect(back.points[10].lat).toBeCloseTo(track.points[10].lat, 6);
    expect(back.points[10].t).toBe(track.points[10].t);
  });
});

describe("results", () => {
  const text = `Pos Bib Name Team Time Gap Lap 1 Lap 2 Lap 3
1 101 RIDER, Alpha Team A 4:30 1:32 1:29 1:29
2 102 RIDER, Bravo 4:41 0'11" 1:35 1:33 1:33
3 103 CHARLIE, Delta Some Team 3:10 -1 lap 1:35 1:35`;

  it("reads place, name, total and laps from pasted text", () => {
    const rows = parseResults(text);
    expect(rows.map((r) => r.place)).toEqual([1, 2, 3]);
    expect(rows[0]).toMatchObject({ name: "Alpha Rider", total: 270, laps: [92, 89, 89], lapsDown: 0 });
    expect(rows[1].laps).toEqual([95, 93, 93]);
    expect(rows[2].lapsDown).toBe(1);
  });

  it("finds a rider by name in any order", () => {
    expect(findRow(parseResults(text), "bravo rider")?.place).toBe(2);
  });

  it("reads and writes clock times", () => {
    expect(parseClock("8:12")).toBe(492);
    expect(parseClock("1:02:03")).toBe(3723);
    expect(formatClock(492)).toBe("8:12");
  });
});

describe("course", () => {
  it("finds the laps from your own ride", () => {
    const fit = fitCourse(ride(3, steady));
    expect(fit.lapEnds.length).toBe(3);
    expect(fit.course.length).toBeGreaterThan(LAP_LENGTH - 20);
    expect(fit.course.length).toBeLessThan(LAP_LENGTH + 20);
  });
});

describe("race report", () => {
  it("finds the hairpin where the slower rider lost time", () => {
    const own = ride(3, slowHairpin);
    const rival = ride(3, steady);
    const report = raceReport({ own, rivals: [{ id: "r", name: "Fast Rider", track: rival }] });
    expect(report.lapCount).toBe(3);
    // The hairpin's two bends, 14 m apart, are found as corners.
    expect(report.sections.filter((s) => s.kind === "corner" && s.from < 240 && s.to > 195).length).toBeGreaterThan(0);
    const c = report.comparisons.find((x) => x.id === "r")!;
    expect(c.timing).toBe("recorded");
    expect(c.confidence.level).toBe("high");
    // 45 m at 3 m/s instead of 6: about 7.5 s a lap.
    const around = c.sections.filter((r) => report.sections[r.id].from < 240 && report.sections[r.id].to > 195);
    expect(around.reduce((a, r) => a + r.total, 0)).toBeGreaterThan(15);
    const row = [...around].sort((a, b) => b.total - a.total)[0];
    expect(c.finishGap).toBeGreaterThan(18);
    expect(c.finishGap).toBeLessThan(26);
    // The gap only grows, a little every lap.
    expect(c.gap[c.gap.length - 1].gap).toBeGreaterThan(c.gap[Math.floor(c.gap.length / 3)].gap);
    const advice = raceAdvice(report, c, { speed: (v) => `${v}`, speedDiff: (v) => `${v}` });
    expect(advice.some((a) => a.sections.includes(row.id))).toBe(true);
    expect(stretches(c, report.sections)[0].seconds).toBeGreaterThan(15);
  });

  it("finds the climb, and a one-off loss on one lap", () => {
    const own = ride(4, (d, lap) => (onClimb(d) ? 4 : lap === 1 && inHairpin(d) ? 1.5 : 6));
    const rival = ride(4, steady);
    const report = raceReport({ own, rivals: [{ id: "r", name: "Fast Rider", track: rival }] });
    const c = report.comparisons.find((x) => x.id === "r")!;
    expect(report.sections.some((s) => s.kind === "climb")).toBe(true);
    expect(c.kinds.find((k) => k.kind === "climb")!.seconds).toBeGreaterThan(5);
    expect(c.incidents[0]?.lap).toBe(2);
    const areas = raceAdvice(report, c, { speed: String, speedDiff: String }).map((a) => a.area);
    expect(areas).toContain("climbs");
    expect(areas).toContain("incident");
  });

  it("gives a file without times a clock from the official lap times", () => {
    const own = ride(3, slowHairpin);
    // The winner's file has no times and starts late, partway into lap 1, as Strava exports often do.
    const winner = ride(3, steady, 0, false, false);
    winner.points = winner.points.slice(25);
    const lap = (track: Track, k: number) => Math.round(LAP_LENGTH / 6) + (track === own ? 8 : 0) + (k === 0 ? 2 : 0);
    const results = parseResults(
      [`1 1 WINNER, Wendy ${formatClock(3 * lap(winner, 1) + 2)} ${[0, 1, 2].map((k) => formatClock(lap(winner, k))).join(" ")}`, `2 2 SELF, Sam ${formatClock(3 * lap(own, 1) + 2)} ${[0, 1, 2].map((k) => formatClock(lap(own, k))).join(" ")}`].join("\n"),
    );
    const report = raceReport({ own, ownName: "Sam Self", rivals: [{ id: "w", name: "Wendy Winner", track: winner }], results });
    const c = report.comparisons.find((x) => x.id === "w")!;
    expect(c.timing).toBe("results");
    // Evenly spaced points that fit the laps: a good estimate, with the late start noted.
    expect(c.confidence.level).toBe("medium");
    expect(c.confidence.notes.join(" ")).toMatch(/starts after the gun/);
    expect(c.place).toBe(1);
    expect(c.finishGap).toBeCloseTo(24, 0);
    expect(c.laps.map((l) => l.delta)).toEqual([8, 8, 8]);
    // Lap 2's hairpin still stands out with only the lap times to go on.
    const worst = [...c.sections].sort((a, b) => b.total - a.total)[0];
    expect(report.sections[worst.id].kind).toBe("corner");
    expect(report.field?.laps[0]).toMatchObject({ rank: 2, of: 2 });
  });

  it("calls section times rough when a file without times skips ahead", () => {
    const own = ride(3, slowHairpin);
    const winner = ride(3, steady, 0, false, false);
    // Dropped points: every tenth point missing on lap 2.
    winner.points = winner.points.filter((_, i) => !(i > 120 && i < 200 && i % 3 === 0));
    const lap = Math.round(LAP_LENGTH / 6);
    const results = parseResults(`1 1 WINNER, Wendy ${formatClock(3 * lap)} ${formatClock(lap)} ${formatClock(lap)} ${formatClock(lap)}\n2 2 SELF, Sam ${formatClock(3 * lap + 24)} ${formatClock(lap + 8)} ${formatClock(lap + 8)} ${formatClock(lap + 8)}`);
    const report = raceReport({ own, ownName: "Sam Self", rivals: [{ id: "w", name: "Wendy Winner", track: winner }], results });
    const c = report.comparisons.find((x) => x.id === "w")!;
    expect(c.confidence.level).toBe("low");
  });

  it("calls a file without times or results a rough estimate", () => {
    const report = raceReport({ own: ride(3, slowHairpin), rivals: [{ id: "w", name: "Wendy", track: ride(3, steady, 0, false, false) }] });
    expect(report.comparisons[0].confidence.level).toBe("low");
  });

  it("compares you with your own best lap", () => {
    const report = raceReport({ own: ride(3, (d, lap) => (lap === 0 && inHairpin(d) ? 2 : 6)), rivals: [] });
    const ghost = report.comparisons.find((x) => x.id === BEST_LAP_ID)!;
    expect(ghost.laps[0].delta).toBeGreaterThan(8);
    expect(Math.abs(ghost.laps[2].delta ?? 99)).toBeLessThan(1.5);
  });

  it("gives the coach a labelled summary", () => {
    const report = raceReport({ own: ride(3, slowHairpin), rivals: [{ id: "r", name: "Fast Rider", track: ride(3, steady) }] });
    const c = report.comparisons[0];
    const brief = raceForCoach(report, c, raceAdvice(report, c, { speed: String, speedDiff: String }));
    expect(brief.comparedWith.name).toBe("Fast Rider");
    expect(brief.you.lapPower).toBe("no power recorded in this race");
    expect(brief.comparedWith.worstSections[0].secondsLost).toBeGreaterThan(15);
  });
});
