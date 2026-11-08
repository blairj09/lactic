// Which race report a race gets: laps (riders lined up lap by lap) or solo (a race that isn't laps,
// read from the rider's own file and any past editions). The numbers all come from the engine.

import { ftpOn, localDate } from "./engine/activity";
import type { PowerCurve } from "./engine/power";
import { raceReport, type RaceReport } from "./engine/race/report";
import { isPointToPoint, soloReport, type SoloReport } from "./engine/race/solo";
import type { Athlete } from "./activities";
import type { RaceData } from "./race";

export type BuiltRace = { kind: "laps"; report: RaceReport } | { kind: "solo"; report: SoloReport };

export function buildRace(data: RaceData & { ownTrack: NonNullable<RaceData["ownTrack"]> }, athlete: Athlete, startedAt: Date, bestCurve: PowerCurve | null): BuiltRace {
  const solo = (): BuiltRace => ({
    kind: "solo",
    report: soloReport({
      own: data.ownTrack,
      ftp: ftpOn(localDate(startedAt, athlete.timezone), athlete.ftpHistory, athlete.ftp),
      weightKg: athlete.weightKg,
      // Other riders' files without times can't be placed on a race without laps to pin them to.
      others: data.rivals.filter((r) => r.track.points.every((p) => p.t !== null)).map((r) => ({ id: r.id, name: r.name, track: r.track, past: r.past })),
      places: data.places,
      bestCurve,
    }),
  });
  if (isPointToPoint(data.ownTrack)) return solo();
  try {
    const report = raceReport({ own: data.ownTrack, ownName: data.ownName, rivals: data.rivals.filter((r) => !r.past), results: data.results });
    return report.lapCount >= 2 ? { kind: "laps", report } : solo();
  } catch {
    // It never comes back past the start: one big loop, not laps.
    return solo();
  }
}
