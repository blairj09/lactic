// The solo race report as the coach reads it: labelled, rounded, and only what a debrief needs.

import { formatClock } from "./results";
import type { SoloAdvice } from "./solo-advice";
import type { SoloReport } from "./solo";

const km = (m: number) => Math.round(m / 100) / 10;
const name = (r: SoloReport, id: number) => {
  const s = r.sections[id];
  return s.kind === "flat" ? `the roads from km ${Math.round(s.from / 1000)} to ${Math.round(s.to / 1000)}` : s.label;
};

export function soloForCoach(r: SoloReport, advice: SoloAdvice[]) {
  return {
    race: {
      kind: "a single long race that isn't laps (point to point), read from the rider's own file",
      distanceKm: km(r.meters),
      climbedMeters: r.gain,
      elapsed: formatClock(r.elapsed),
      moving: formatClock(r.moving),
      stopped: formatClock(r.stopped),
      namedPlaces: r.places,
    },
    you: {
      ftp: r.ftp,
      weightKg: r.weightKg,
      avgWatts: r.watts,
      normalizedWatts: r.np,
      intensityFactor: r.intensity,
      trainingStress: r.stress,
      avgHr: r.hr,
      kj: r.kj,
      power: r.hasPower ? "recorded" : "no power in this file",
      heartRate: r.hasHr ? "recorded" : "no heart rate in this file",
      firstHour: r.firstHour,
    },
    sections: r.sections.map((s) => ({
      name: name(r, s.id),
      kind: s.kind,
      km: `${km(s.from)}–${km(s.to)}`,
      gainM: s.gain,
      gradePct: s.grade,
      elapsed: formatClock(s.elapsed),
      moving: formatClock(s.moving),
      kmh: Math.round(s.speed * 36) / 10,
      avgWatts: s.watts,
      pctFtp: s.pctFtp,
      wkg: s.wkg,
      avgHr: s.hr,
      vam: s.vam,
      kjAlreadyDone: s.kjBefore,
    })),
    quartersOfRidingTime: r.quarters.map((q) => ({ quarter: q.n, km: `${km(q.from)}–${km(q.to)}`, avgWatts: q.watts, normalizedWatts: q.np, avgHr: q.hr, kmh: Math.round(q.speed * 36) / 10, climbedM: q.gain, powerPerHeartbeat: q.ef })),
    heartRateDriftPct: r.decoupling,
    durability: {
      freshBest: r.durability.fresh ? { ...r.durability.fresh, from: r.durability.fresh.from === "before" ? "training before the race" : "the race's own fresh part" } : null,
      byWorkDone: r.durability.bands.map((b) => ({ kj: `${b.fromKj}–${b.toKj}`, km: `${km(b.from)}–${km(b.to)}`, best5minW: b.best5, best20minW: b.best20, pctOfFresh20: b.pct20 })),
      note: "Best efforts in each band also depend on where the climbs fell; read them with the sections.",
    },
    stops: r.stops.map((s) => ({ km: km(s.at), place: s.place, minutes: Math.round(s.seconds / 6) / 10 })),
    betweenStops: r.legs.map((l) => ({ from: l.fromName, to: l.toName, km: km(l.to - l.from), moving: formatClock(l.moving), kj: l.kj, avgWatts: l.watts })),
    comparedWith: r.comparisons.map((c) => ({
      name: c.name,
      who: c.past ? "the rider themselves, an earlier edition" : "another rider",
      date: c.date,
      routeMatched: `${Math.round(c.coverage * 100)}% of this route`,
      elapsed: c.elapsed === null ? null : formatClock(c.elapsed),
      stopped: c.stopped === null ? null : formatClock(c.stopped),
      normalizedWatts: c.np,
      avgHr: c.hr,
      finishGapSeconds: c.finishGap,
      lastSharedKm: km(c.lastShared),
      gapThereSeconds: c.lastGap,
      bySection: c.sections.map((x) => ({ name: name(r, x.id), secondsLost: x.delta === null ? null : Math.round(x.delta), theirWatts: x.watts })),
    })),
    engineAdvice: advice.map((a) => ({ tone: a.tone, title: a.title, detail: a.detail })),
  };
}
