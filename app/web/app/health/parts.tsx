// Pieces the Health page and its detail views share.

import Link from "next/link";
import { Chevron, Dash, Panel } from "@/components/ui";
import type { BodyMeasurement } from "@/lib/body-data";
import { formatDay } from "@/lib/format";
import type { HealthSummary } from "@/lib/health-summary";

/** A panel that opens a closer look: the whole surface is the link, with an arrow by the title. */
export function LinkPanel({ href, title, note, children }: { href: string; title: React.ReactNode; note?: React.ReactNode; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      scroll={false}
      className="group block min-w-0 rounded-lg border border-line bg-surface p-4 transition-colors hover:border-control focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink sm:p-5"
    >
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h3 className="flex items-center gap-1 text-sm font-medium">
          {title}
          <Chevron />
        </h3>
        {note && <span className="text-xs text-muted">{note}</span>}
      </div>
      {children}
    </Link>
  );
}

export const hoursMinutes = (hours: number) => {
  const total = Math.round(hours * 60);
  return `${Math.floor(total / 60)}h ${String(total % 60).padStart(2, "0")}m`;
};

const BAND_LABELS = ["Light", "Moderate", "Hard", "Very hard"];

/** Yesterday's exertion split on and off the bike, and minutes by heart rate band. With `href` it opens the exertion view. */
export function ExertionPanel({ exertion, activity, href }: { exertion: HealthSummary["exertion"]; activity: HealthSummary["activity"]; href?: string }) {
  const y = exertion.yesterday;
  const total = y ? y.bandMinutes.reduce((a, b) => a + b, 0) : 0;
  const most = y ? Math.max(...y.bandMinutes, 1) : 1;
  const note = y ? `${y.exertion.toFixed(1)} / 10` : "No heart rate";
  const body = y ? (
        <div className="grid gap-6 text-sm sm:grid-cols-2">
          <dl className="num grid grid-cols-2 gap-x-4 gap-y-1 self-start">
            <dt className="text-muted">On the bike</dt>
            <dd className="text-right">{y.rideTrimp} TRIMP</dd>
            <dt className="text-muted">Off the bike</dt>
            <dd className="text-right">{y.offBikeTrimp} TRIMP</dd>
            {activity?.activeKcal != null && (
              <>
                <dt className="text-muted">Active energy</dt>
                <dd className="text-right">{activity.activeKcal.toLocaleString("en-US")} kcal</dd>
              </>
            )}
            {activity?.steps != null && (
              <>
                <dt className="text-muted">Steps</dt>
                <dd className="text-right">{activity.steps.toLocaleString("en-US")}</dd>
              </>
            )}
          </dl>
          <div className="space-y-1.5">
            <div className="text-xs text-muted">Minutes by heart rate reserve{total ? "" : ": none above light"}</div>
            {y.bandMinutes.map((m, i) => (
              <div key={i} className="grid grid-cols-[5.5rem_1fr_2.5rem] items-center gap-2 text-xs">
                <span className="text-muted">{BAND_LABELS[i]}</span>
                <span className="h-2 rounded-sm bg-rule">
                  <span className="block h-2 rounded-sm" style={{ width: `${(m / most) * 100}%`, background: "var(--accent)", opacity: 0.4 + i * 0.2 }} />
                </span>
                <span className="num text-right">{m}</span>
              </div>
            ))}
          </div>
          {exertion.target && (
            <p className="text-muted sm:col-span-2">
              Today&apos;s target is {exertion.target.low.toFixed(1)} to {exertion.target.high.toFixed(1)}, from your recovery and normal day.
            </p>
          )}
        </div>
      ) : (
        <p className="text-sm text-muted">No heart rate or rides yesterday.</p>
      );
  if (href)
    return (
      <LinkPanel href={href} title="Exertion" note={note}>
        {body}
      </LinkPanel>
    );
  return (
    <Panel className="min-w-0">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h3 className="text-sm font-medium">Yesterday</h3>
        <span className="text-xs text-muted">{note}</span>
      </div>
      {body}
    </Panel>
  );
}

/** Weigh-ins, newest first. */
export function WeighInTable({ measurements, timeZone }: { measurements: BodyMeasurement[]; timeZone: string }) {
  return (
    <>
    {measurements.length === 0 ? (
      <p className="text-sm text-muted">No weigh-ins yet.</p>
    ) : (
      <div className="max-h-80 overflow-auto sm:max-h-[28rem]">
        <table className="num w-full text-sm">
          <thead className="sticky top-0 bg-surface text-left text-muted">
            <tr>
              <th className="pb-2 font-normal">Day</th>
              <th className="pb-2 text-right font-normal">Weight</th>
              <th className="pb-2 text-right font-normal">Body fat</th>
              <th className="hidden pb-2 text-right font-normal sm:table-cell">Lean mass</th>
              <th className="hidden pb-2 text-right font-normal sm:table-cell">BMI</th>
            </tr>
          </thead>
          <tbody>
            {measurements.map((m) => (
              <tr key={m.id} className="border-t border-rule">
                <td className="py-2.5">
                  {formatDay(m.measuredAt, timeZone)}{" "}
                  <span className="text-muted">
                    {new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", minute: "2-digit" }).format(m.measuredAt)}
                  </span>
                </td>
                <td className="py-2.5 text-right">
                  {m.weightKg.toFixed(1)}
                  <span className="ml-1 text-muted">kg</span>
                </td>
                <td className="py-2.5 text-right">{m.bodyFatPercent === null ? <Dash /> : `${m.bodyFatPercent.toFixed(1)}%`}</td>
                <td className="hidden py-2.5 text-right sm:table-cell">
                  {m.fatFreeMassKg === null ? <Dash /> : <>{m.fatFreeMassKg.toFixed(1)}<span className="ml-1 text-muted">kg</span></>}
                </td>
                <td className="hidden py-2.5 text-right sm:table-cell">{m.bmi === null ? <Dash /> : m.bmi.toFixed(1)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )}
    </>
  );
}
