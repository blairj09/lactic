import Link from "next/link";
import type { CalendarRide } from "@/lib/engine/ride-calendar";
import { ZONE_LABELS } from "@/lib/engine/library";
import { Dash } from "@/components/ui";
import { formatDay, formatDuration, intervalsUrl, SOURCE_LABEL } from "@/lib/format";

/** Rides as rows. `intervalsId` already points a counted ride at its intervals.icu copy. */
export default function RideTable({ rides, timeZone }: { rides: CalendarRide[]; timeZone: string }) {
  return (
    <div className="overflow-x-auto">
      <table className="num w-full text-sm">
        <thead className="text-left whitespace-nowrap text-muted">
          <tr>
            <th className="pb-2 pr-3 font-normal">Ride</th>
            <th className="pb-2 pr-3 text-right font-normal">Time</th>
            <th className="pb-2 pr-3 text-right font-normal">NP (W)</th>
            <th className="pb-2 text-right font-normal">TSS</th>
          </tr>
        </thead>
        <tbody>
          {rides.map((r) => {
            const intervalsId = r.intervalsId;
            return (
            <tr key={r.id} className={`border-t border-rule ${r.duplicateOf ? "text-faint" : ""}`}>
              <td className="py-2.5 pr-3">
                <Link href={`/rides/${r.id}`} className="block max-w-72 truncate hover:underline hover:decoration-rule hover:underline-offset-2">
                  {r.name ?? "Ride"}
                </Link>
                <div className="text-xs text-muted">
                  {formatDay(new Date(r.startedAt), timeZone)} · {SOURCE_LABEL[r.source] ?? r.source}
                  {r.zone ? ` · ${ZONE_LABELS[r.zone]}${r.zoneEstimated ? " (est.)" : ""}` : ""}
                  {r.duplicateOf ? " · copy, not counted" : ""}
                  {intervalsId && (
                    <>
                      {" · "}
                      <a href={intervalsUrl(intervalsId)} target="_blank" rel="noreferrer" className="underline decoration-rule underline-offset-2 hover:text-ink">
                        intervals.icu
                      </a>
                    </>
                  )}
                </div>
              </td>
              <td className="py-2.5 pr-3 text-right whitespace-nowrap">{formatDuration(r.durationSeconds)}</td>
              <td className="py-2.5 pr-3 text-right whitespace-nowrap">{r.normalizedPower ? Math.round(r.normalizedPower) : <Dash />}</td>
              <td className="py-2.5 text-right whitespace-nowrap">
                {r.trainingStress !== null ? Math.round(r.trainingStress) : <Dash />}
                {r.stressMethod === "heartRate" && <span className="ml-1 text-xs text-muted" title="From heart rate">HR</span>}
              </td>
            </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
