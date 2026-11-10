"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { button, Result } from "@/components/ui";
import type { Glance } from "@/lib/engine/race/glance";
import { formatClock } from "@/lib/engine/race/results";
import { elevationIn, elevationUnit } from "@/lib/units";
import { useUnits } from "@/lib/use-units";
import { addPastRide } from "./actions";

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");
const time = (s: number) => formatClock(s);
const signed = (s: number) => (Math.abs(s) < 1 ? "level" : `${s > 0 ? "+" : "−"}${formatClock(Math.abs(s))}`);
const day = (ms: number) => new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
const ordinal = (n: number) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? "th" : (["th", "st", "nd", "rd"][n % 10] ?? "th")}`;

/**
 * The comparisons every race report makes on its own, before any files: peak powers against your
 * 90-day bests, where you placed once the results are in, and your earlier rides of the course.
 * The numbers all come from the engine (engine/race/glance).
 */
export default function RaceGlance({
  activityId,
  glance,
  event,
  solo,
  pastNames,
  preRaceHref = null,
}: {
  activityId: string;
  glance: Glance;
  /** The event this race was, as "Name · A race". */
  event: string | null;
  /** A race that isn't laps, where your earlier rides can line up as past editions. */
  solo: boolean;
  /** Past editions already in the report, by name. */
  pastNames: string[];
  /** The event's pre-race report, when it has a course and race courses are on. */
  preRaceHref?: string | null;
}) {
  const router = useRouter();
  const units = useUnits();
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const { peaks, placing, past, plan } = glance;
  const hasPower = peaks.length > 0;
  const nothing = !hasPower && !placing && !past.length && !plan;

  return (
    <section aria-label="At a glance" className="space-y-5 rounded-lg border border-line bg-surface p-4 sm:p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 className="text-base font-medium">At a glance</h2>
        <p className="text-sm text-muted">{event ? `${event} · ` : ""}compared automatically, from your rides</p>
      </div>

      {glance.headlines.length > 0 && (
        <ul className="space-y-1.5">
          {glance.headlines.map((h) => (
            <li key={h} className="flex gap-2.5 text-[15px]">
              <span className="mt-2 size-1.5 flex-none rounded-full bg-accent" aria-hidden />
              <span>{h}</span>
            </li>
          ))}
        </ul>
      )}
      {nothing && <p className="text-sm text-muted">This ride has no power, and there are no results or earlier rides of the course yet. Paste the results below to see where you placed.</p>}

      <div className="grid grid-cols-1 gap-x-8 gap-y-6 lg:grid-cols-2">
        {hasPower && (
          <div className="space-y-2">
            <h3 className="text-sm font-medium">
              Peak power <span className="font-normal text-muted">· against your best of the 90 days before{glance.npWkg ? ` · NP ${glance.npWkg.toFixed(2)} W/kg` : ""}</span>
            </h3>
            <table className="num w-full text-sm">
              <thead className="text-left text-xs text-muted">
                <tr className="border-b border-line">
                  <th className="py-1.5 font-normal">Over</th>
                  <th className="py-1.5 text-right font-normal">Race</th>
                  <th className="py-1.5 text-right font-normal">W/kg</th>
                  <th className="py-1.5 text-right font-normal">90-day best</th>
                  <th className="py-1.5 text-right font-normal">Of best</th>
                </tr>
              </thead>
              <tbody>
                {peaks.map((p) => (
                  <tr key={p.seconds} className="border-b border-rule last:border-0">
                    <td className="py-1.5">{p.label}</td>
                    <td className="py-1.5 text-right font-medium">{p.watts} W</td>
                    <td className="py-1.5 text-right">{p.wkg?.toFixed(2) ?? "–"}</td>
                    <td className="py-1.5 text-right text-muted">{p.best ? `${p.best} W` : "–"}</td>
                    <td className={cx("py-1.5 text-right", p.newBest ? "font-medium text-positive" : "text-muted")}>
                      {p.ofBest === null ? "–" : p.newBest ? "New best" : `${Math.round(p.ofBest * 100)}%`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="space-y-2">
          <h3 className="text-sm font-medium">Where you placed</h3>
          {placing ? (
            <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-md border border-line bg-line text-sm">
              <Fig label="Place" value={`${ordinal(placing.place)} of ${placing.of}`} sub={placing.of >= 5 ? `Top ${Math.max(1, Math.round(placing.share * 100))}%` : undefined} />
              <Fig label="Your time" value={placing.total !== null ? time(placing.total) : "–"} sub={placing.ofWinnerSpeed && placing.place > 1 ? `${(placing.ofWinnerSpeed * 100).toFixed(1)}% of the winner's speed` : undefined} />
              <Fig
                label={placing.place === 1 ? "Winning margin" : `To ${placing.winner.name}`}
                value={placing.place === 1 ? (placing.behind ? time(placing.behind.gap) : "–") : placing.toWinner !== null ? signed(placing.toWinner) : "Laps down"}
                sub={placing.toPodium !== null ? `${signed(placing.toPodium)} to the podium` : placing.place === 1 ? "You won" : undefined}
              />
              <Fig
                label="Either side"
                value={placing.ahead ? signed(placing.ahead.gap) : "–"}
                sub={[placing.ahead && `to ${placing.ahead.name}`, placing.behind && `${time(placing.behind.gap)} on ${placing.behind.name}`].filter(Boolean).join(" · ") || undefined}
              />
            </dl>
          ) : (
            <p className="text-sm text-muted">
              Paste the results in{" "}
              <a href="#race-files" className="text-ink underline underline-offset-4">
                Files and results
              </a>{" "}
              and pick your row to see your place, the gap to the winner and the riders either side.
            </p>
          )}
        </div>
      </div>

      {plan && (
        <div className="space-y-2">
          <h3 className="text-sm font-medium">
            Against your pre-race plan{" "}
            <span className="font-normal text-muted">
              · estimated {time(plan.plannedSeconds)}, you were {Math.abs(plan.delta) < 60 ? "right on it" : `${time(Math.abs(plan.delta))} ${plan.delta < 0 ? "faster" : "slower"}`}
              {preRaceHref && (
                <>
                  {" · "}
                  <Link href={preRaceHref} className="text-ink underline underline-offset-4">
                    Pre-race report
                  </Link>
                </>
              )}
            </span>
          </h3>
          {plan.climbs.length > 0 && (
            <div className="overflow-x-auto">
              <table className="num w-full min-w-[560px] text-sm">
                <thead className="text-left text-xs text-muted">
                  <tr className="border-b border-line">
                    <th className="py-1.5 font-normal">Climb</th>
                    <th className="py-1.5 text-right font-normal">Planned</th>
                    <th className="py-1.5 text-right font-normal">Ridden</th>
                    <th className="py-1.5 text-right font-normal">Planned power</th>
                    <th className="py-1.5 text-right font-normal">Your power</th>
                  </tr>
                </thead>
                <tbody>
                  {plan.climbs.map((c) => {
                    const over = c.watts !== null && c.watts > c.plannedWatts[1] * 1.05;
                    const under = c.watts !== null && c.watts < c.plannedWatts[0] * 0.95;
                    return (
                      <tr key={c.n} className="border-b border-rule last:border-0">
                        <td className="py-1.5">
                          Climb {c.n} <span className="text-muted">· {Math.round(elevationIn(c.gain, units))} {elevationUnit(units)} at {(c.grade * 100).toFixed(1)}%</span>
                        </td>
                        <td className="py-1.5 text-right text-muted">{time(c.plannedSeconds)}</td>
                        <td className="py-1.5 text-right">{c.seconds !== null ? time(c.seconds) : "–"}</td>
                        <td className="py-1.5 text-right text-muted">
                          {c.plannedWatts[0]}–{c.plannedWatts[1]} W
                        </td>
                        <td className={cx("py-1.5 text-right font-medium", over && "text-warning", under && "text-muted")}>
                          {c.watts !== null ? `${c.watts} W${over ? ", over" : under ? ", under" : ""}` : "–"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      <div className="space-y-2">
        <h3 className="text-sm font-medium">
          Your earlier rides of this course <span className="font-normal text-muted">· found by their GPS tracks</span>
        </h3>
        {past.length ? (
          <div className="overflow-x-auto">
            <table className="num w-full min-w-[560px] text-sm">
              <thead className="text-left text-xs text-muted">
                <tr className="border-b border-line">
                  <th className="py-1.5 font-normal">Ride</th>
                  <th className="py-1.5 text-right font-normal">Time</th>
                  <th className="py-1.5 text-right font-normal">This race</th>
                  <th className="py-1.5 text-right font-normal">NP</th>
                  <th className="py-1.5 text-right font-normal">Avg HR</th>
                  {solo && <th className="py-1.5" />}
                </tr>
              </thead>
              <tbody>
                {past.map((p) => {
                  const name = `${p.event ?? "You"}, ${new Date(p.startedAt).getFullYear()}`;
                  const added = pastNames.includes(name);
                  return (
                    <tr key={p.id} className="border-b border-rule last:border-0">
                      <td className="py-1.5">
                        <Link href={`/rides/${p.id}`} className="hover:underline">
                          {p.event ?? p.name ?? "Ride"}
                        </Link>
                        <span className="ml-2 text-muted">{day(p.startedAt)}</span>
                      </td>
                      <td className="py-1.5 text-right">{time(p.seconds)}</td>
                      <td className={cx("py-1.5 text-right font-medium", p.delta < -30 ? "text-positive" : p.delta > 30 ? "text-negative" : "text-muted")}>{signed(p.delta)}</td>
                      <td className="py-1.5 text-right">{p.normalizedPower ? `${Math.round(p.normalizedPower)} W` : "–"}</td>
                      <td className="py-1.5 text-right">{p.averageHr ? Math.round(p.averageHr) : "–"}</td>
                      {solo && (
                        <td className="py-1.5 pl-3 text-right">
                          {added ? (
                            <span className="text-muted">In the report</span>
                          ) : (
                            <button
                              type="button"
                              className={button.small}
                              disabled={pending}
                              onClick={() =>
                                start(async () => {
                                  const r = await addPastRide(activityId, p.id, name);
                                  setMessage({ ok: r.ok, text: r.message });
                                  if (r.ok) router.refresh();
                                })
                              }
                            >
                              Line it up
                            </button>
                          )}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-muted">None in your history yet. Next time you race this course, this year&apos;s ride shows up here on its own.</p>
        )}
        {message && <Result ok={message.ok}>{message.text}</Result>}
      </div>
    </section>
  );
}

function Fig({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="min-w-0 space-y-0.5 bg-surface p-3">
      <dt className="truncate text-xs text-muted">{label}</dt>
      <dd className="text-lg font-medium tracking-tight">{value}</dd>
      {sub && <dd className="text-xs text-muted">{sub}</dd>}
    </div>
  );
}
