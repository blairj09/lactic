// The race report as the coach reads it: labelled, rounded, and only what a debrief needs.

import { stretches, type Advice } from "./advice";
import type { Comparison, RaceReport } from "./report";
import { formatClock } from "./results";

export function raceForCoach(report: RaceReport, c: Comparison, advice: Advice[]) {
  const label = (id: number) => report.sections[id].label;
  const vsSelf = c.id === "best-lap";
  return {
    course: { lapMeters: report.lapMeters, laps: report.lapCount, sections: report.sections.length },
    you: {
      place: report.own.place,
      time: report.own.total === null ? null : formatClock(report.own.total),
      lapTimes: report.own.laps.map((l) => (l.seconds === null ? null : formatClock(l.seconds))),
      lapHeartRate: report.own.hasHr ? report.own.laps.map((l) => l.avgHr) : "no heart rate recorded",
      lapPower: report.own.hasPower ? report.own.laps.map((l) => l.avgWatts) : "no power recorded in this race",
      bySectionKind: report.own.byKind.map((k) => ({ kind: k.kind, avgWatts: k.watts, avgHr: k.hr, avgKmh: Math.round(k.speed * 36) / 10 })),
    },
    comparedWith: {
      name: c.name,
      place: c.place,
      time: c.total === null ? null : formatClock(c.total),
      timesFrom: vsSelf
        ? "your own fastest lap, ridden every lap"
        : c.timing === "results"
          ? "their file's track, pinned to their official lap times (their file has no reliable times of its own), so section speeds are approximate"
          : c.timing === "recorded"
            ? "their file's own times"
            : "their file, assuming one point a second (no times and no results)",
      finishGapSeconds: c.finishGap,
      laps: c.laps.map((l) => ({ lap: l.lap, you: l.own === null ? null : formatClock(l.own), them: l.rival === null ? null : formatClock(l.rival), secondsLost: l.delta })),
      secondsLostByKind: Object.fromEntries(c.kinds.map((k) => [k.kind, k.seconds])),
      whereTimeWent: stretches(c, report.sections).slice(0, 4).map((s) => ({ meters: `${s.from}-${s.to} m of the lap`, sections: s.sections.map(label).join(", "), secondsLost: s.seconds, perLap: s.perLap })),
      oneOffLosses: c.incidents.map((i) => ({ lap: i.lap, section: label(i.section), seconds: i.seconds, usualThere: i.usual })),
      worstSections: [...c.sections].sort((a, b) => b.total - a.total).slice(0, 6).map((r) => ({ section: label(r.id), secondsLost: r.total, perLap: r.perLap })),
      bestSections: [...c.sections].sort((a, b) => a.total - b.total).slice(0, 4).filter((r) => r.total < 0).map((r) => ({ section: label(r.id), secondsGained: -r.total })),
    },
    field: report.field?.laps.map((l) => ({ lap: l.lap, yourRank: `${l.rank} of ${l.of}`, fastest: `${formatClock(l.fastest)} (${l.fastestName})` })) ?? null,
    engineAdvice: advice.map((a) => ({ tone: a.tone, title: a.title, detail: a.detail })),
  };
}
