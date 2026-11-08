"use client";

import { useMemo, useState } from "react";
import { button, Panel, Pill, Segmented, Stat, StatStrip } from "@/components/ui";
import { bestPast, soloAdvice, type SoloAdvice } from "@/lib/engine/race/solo-advice";
import type { SoloReport, SoloSection } from "@/lib/engine/race/solo";
import { formatClock } from "@/lib/engine/race/results";
import { soloFormatters } from "@/lib/race-format";
import { distanceIn, distanceUnit, formatDistance, speedIn, speedUnit } from "@/lib/units";
import { useUnits } from "@/lib/use-units";
import { Debrief } from "./race-review";
import SoloChart, { SERIES } from "./solo-chart";

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

const hm = (s: number) => {
  const m = Math.round(Math.abs(s) / 60);
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}`;
};
const minutes = (s: number) => {
  const m = Math.round(Math.abs(s) / 60);
  return m >= 60 ? `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")} min` : `${m} min`;
};
const signedMin = (s: number | null) => (s === null ? "–" : Math.abs(s) < 30 ? "level" : `${s > 0 ? "+" : "−"}${minutes(s)}`);
const deltaClass = (d: number | null) => (d === null || Math.abs(d) < 30 ? "text-muted" : d > 0 ? "text-negative" : "text-positive");

/**
 * A race that isn't laps (LoToJa, a gran fondo, a long gravel race), read from your own file: the
 * course cut into climbs and the roads between, how you paced it, where you faded, power once tired,
 * stops and what you rode between them. Your past editions of the course (and other riders' timed
 * files) line up along the road when you add them.
 */
export default function SoloReview({
  activityId,
  report,
  notes,
  debrief,
  coachOn,
}: {
  activityId: string;
  report: SoloReport;
  notes: string;
  debrief: { text: string; rival: string | null; at: string } | null;
  coachOn: boolean;
}) {
  const units = useUnits();
  const fmt = soloFormatters(units);
  const advice = useMemo(() => soloAdvice(report, soloFormatters(units)), [report, units]);
  const [focus, setFocus] = useState<SoloAdvice | null>(null);
  const [hovered, setHovered] = useState<number | null>(null);
  const [allAdvice, setAllAdvice] = useState(false);
  const past = bestPast(report);
  const [compareId, setCompareId] = useState<string>(past?.id ?? report.comparisons[0]?.id ?? "");
  const c = report.comparisons.find((x) => x.id === compareId) ?? null;
  const highlight = focus ? focus.sections : hovered !== null ? [hovered] : [];
  const dist = (m: number) => distanceIn(m, units);
  const du = distanceUnit(units);
  const at = (m: number) => Math.round(dist(m));
  const name = (s: SoloSection) => (s.kind === "flat" ? `${du === "mi" ? "Miles" : "Km"} ${at(s.from)}–${at(s.to)}` : s.label);
  const climbs = report.sections.filter((s) => s.kind === "climb");
  const fresh = report.durability.fresh;

  return (
    <div className="space-y-6">
      <StatStrip cols={4} phone={2}>
        <Stat label="Your race" value={hm(report.elapsed)} sub={`${hm(report.moving)} riding · ${minutes(report.stopped)} stopped`} lead />
        <Stat label="The course" value={Math.round(dist(report.meters)).toLocaleString()} unit={du} sub={`${units === "imperial" ? `${Math.round(report.gain * 3.28084).toLocaleString()} ft` : `${report.gain.toLocaleString()} m`} up · ${climbs.length} climb${climbs.length === 1 ? "" : "s"}`} />
        <Stat
          label="Normalized power"
          value={report.np}
          unit={report.np ? "W" : undefined}
          sub={report.np ? `${report.intensity !== null ? `${Math.round(report.intensity * 100)}% of FTP · ` : ""}${report.kj?.toLocaleString()} kJ` : "No power in this file"}
        />
        {past ? (
          <Stat label={`Against ${past.name}`} value={signedMin(past.finishGap)} sub={`They: ${hm(past.elapsed as number)}, ${minutes(past.stopped ?? 0)} stopped`} />
        ) : (
          <Stat label="Power, first to last quarter" value={report.quarters[0]?.watts && report.quarters[3]?.watts ? `${Math.round((report.quarters[3].watts / report.quarters[0].watts) * 100)}%` : null} sub={report.quarters[0]?.watts ? `${report.quarters[0].watts} W → ${report.quarters[3]?.watts} W` : undefined} />
        )}
      </StatStrip>

      {!report.comparisons.length && (
        <p className="text-sm text-muted">
          No one to line up against, so this reads the race from your own file: pacing, fade, power once tired, climbs and stops. Add your ride of this course from another year below to see where you gained and lost on it.
        </p>
      )}

      <div className="grid min-w-0 gap-6 lg:grid-cols-[1.4fr_1fr]">
        <Panel
          className="min-w-0"
          title="Along the road"
          meta={
            report.comparisons.length > 1 ? (
              <span className="flex flex-wrap gap-3">
                {report.comparisons.map((x, i) => (
                  <span key={x.id} className="flex items-center gap-1.5">
                    <span className="inline-block h-0.5 w-4" style={{ background: SERIES[i % SERIES.length] }} />
                    {x.name}
                  </span>
                ))}
              </span>
            ) : (
              "Hover to read any point"
            )
          }
        >
          <SoloChart report={report} units={units} highlight={highlight} onHover={setHovered} />
        </Panel>

        <Panel className="min-w-0" title="What to work on" meta="From the numbers, biggest first">
          <ul className="space-y-2">
            {(allAdvice ? advice : advice.slice(0, 4)).map((a) => (
              <li key={a.title}>
                <button
                  type="button"
                  onClick={() => setFocus(focus?.title === a.title ? null : a)}
                  aria-pressed={focus?.title === a.title}
                  className={cx("w-full rounded-md border p-3 text-left transition-colors", focus?.title === a.title ? "border-ink bg-raised" : "border-line hover:bg-raised")}
                >
                  <div className="flex items-start justify-between gap-3">
                    <span className="font-medium">{a.title}</span>
                    {a.tone === "strength" ? <Pill tone="positive">Strength</Pill> : null}
                  </div>
                  <p className="mt-1 text-sm text-muted">{a.detail}</p>
                </button>
              </li>
            ))}
            {!advice.length && <li className="text-sm text-muted">Nothing stands out: an evenly ridden day.</li>}
          </ul>
          {advice.length > 4 && (
            <button type="button" className={`${button.ghost} mt-2`} onClick={() => setAllAdvice(!allAdvice)}>
              {allAdvice ? "Show the top 4" : `Show ${advice.length - 4} more`}
            </button>
          )}
        </Panel>
      </div>

      <Debrief activityId={activityId} compareId="" notes={notes} debrief={debrief} coachOn={coachOn} solo />

      <Panel
        title="The course, piece by piece"
        meta={
          report.comparisons.length ? (
            <Segmented label="Compare with" value={compareId} onChange={(v) => setCompareId(v)} options={report.comparisons.map((x) => ({ value: x.id, label: x.name }))} />
          ) : (
            "Climbs, and the roads between them"
          )
        }
        pad={false}
      >
        <div className="overflow-x-auto">
          <table className="num w-full text-sm">
            <thead className="border-y border-line text-left text-muted">
              <tr>
                <th className="px-4 py-2 font-normal sm:px-5">Section</th>
                <th className="px-2 py-2 font-normal">Up</th>
                <th className="px-2 py-2 font-normal">Time</th>
                <th className="px-2 py-2 font-normal">Speed</th>
                {report.hasPower && <th className="px-2 py-2 font-normal">Power</th>}
                {report.hasHr && <th className="px-2 py-2 font-normal">HR</th>}
                {report.hasPower && <th className="px-2 py-2 font-normal">Work before</th>}
                {c && <th className="px-2 py-2 font-normal">{c.name}</th>}
                {c && <th className="px-2 py-2 pr-4 font-normal sm:pr-5">Gap</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {report.sections.map((s) => {
                const o = c?.sections.find((x) => x.id === s.id) ?? null;
                return (
                  <tr key={s.id} className={cx("hover:bg-raised", highlight.includes(s.id) && "bg-raised")} onMouseEnter={() => setHovered(s.id)} onMouseLeave={() => setHovered(null)}>
                    <td className="px-4 py-1.5 sm:px-5">
                      <span className={cx("font-sans", s.kind === "climb" && "font-medium")}>{name(s)}</span>
                      <span className="ml-1.5 font-sans text-xs text-muted">
                        {s.kind === "flat" ? formatDistance(s.to - s.from, units, 0) : `${formatDistance(s.to - s.from, units, 0)} at ${Math.abs(s.grade)}%`}
                      </span>
                    </td>
                    <td className="px-2 py-1.5">{units === "imperial" ? `${Math.round(s.gain * 3.28084).toLocaleString()} ft` : `${s.gain} m`}</td>
                    <td className="px-2 py-1.5">
                      {formatClock(s.elapsed)}
                      {s.elapsed - s.moving >= 60 && <span className="ml-1 text-xs text-muted">({minutes(s.elapsed - s.moving)} stopped)</span>}
                    </td>
                    <td className="px-2 py-1.5">
                      {speedIn(s.speed, units).toFixed(1)} {speedUnit(units)}
                    </td>
                    {report.hasPower && (
                      <td className="px-2 py-1.5 whitespace-nowrap">
                        {s.watts ?? "–"} W{s.pctFtp !== null && <span className="text-muted"> · {s.pctFtp}%</span>}
                        {s.kind === "climb" && s.wkg !== null && <span className="text-muted"> · {s.wkg.toFixed(1)} W/kg</span>}
                      </td>
                    )}
                    {report.hasHr && <td className="px-2 py-1.5">{s.hr ?? "–"}</td>}
                    {report.hasPower && <td className="px-2 py-1.5 text-muted">{s.kjBefore.toLocaleString()} kJ</td>}
                    {c && (
                      <td className="px-2 py-1.5 whitespace-nowrap text-muted">
                        {o?.elapsed != null ? formatClock(o.elapsed) : "–"}
                        {o?.watts != null && ` · ${o.watts} W`}
                      </td>
                    )}
                    {c && <td className={cx("px-2 py-1.5 pr-4 whitespace-nowrap sm:pr-5", deltaClass(o?.delta ?? null))}>{signedMin(o?.delta ?? null)}</td>}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {c && c.coverage < 0.95 && (
          <p className="px-4 py-3 text-sm text-muted sm:px-5">
            {c.name} matched {Math.round(c.coverage * 100)}% of this route{c.finishGap === null ? `, up to ${fmt.at(c.lastShared)}, so there's no finish gap` : ""}: the course may have changed that year.
          </p>
        )}
      </Panel>

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title="Pacing" meta={report.decoupling !== null ? `Heart-rate drift ${report.decoupling}% (first half to second)` : "By quarter of riding time"} pad={false}>
          <div className="overflow-x-auto">
            <table className="num w-full text-sm">
              <thead className="border-y border-line text-left text-muted">
                <tr>
                  <th className="px-4 py-2 font-normal sm:px-5">Quarter</th>
                  <th className="px-2 py-2 font-normal">Where</th>
                  <th className="px-2 py-2 font-normal">Up</th>
                  {report.hasPower && <th className="px-2 py-2 font-normal">Power</th>}
                  {report.hasPower && <th className="px-2 py-2 font-normal">NP</th>}
                  {report.hasHr && <th className="px-2 py-2 pr-4 font-normal sm:pr-5">HR</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {report.quarters.map((q) => (
                  <tr key={q.n}>
                    <td className="px-4 py-1.5 sm:px-5">{q.n}</td>
                    <td className="px-2 py-1.5 text-muted">
                      {at(q.from)}–{at(q.to)} {du}
                    </td>
                    <td className="px-2 py-1.5">{units === "imperial" ? `${Math.round(q.gain * 3.28084).toLocaleString()} ft` : `${q.gain} m`}</td>
                    {report.hasPower && <td className="px-2 py-1.5">{q.watts} W</td>}
                    {report.hasPower && <td className="px-2 py-1.5">{q.np} W</td>}
                    {report.hasHr && <td className="px-2 py-1.5 pr-4 sm:pr-5">{q.hr}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>

        {report.hasPower && fresh?.best20 ? (
          <Panel title="Power once tired" meta={`Best 20 min in each 1,000 kJ, against ${fresh.best20} W ${fresh.from === "before" ? "from training" : "fresh"}`}>
            <ul className="space-y-2">
              {report.durability.bands.map((b) => (
                <li key={b.fromKj} className="grid grid-cols-[92px_1fr_86px] items-center gap-3 text-sm">
                  <span className="num text-muted">
                    {(b.fromKj / 1000).toFixed(0)}–{(b.toKj / 1000).toFixed(b.toKj % 1000 ? 1 : 0)}k kJ
                  </span>
                  <span className="h-2.5 overflow-hidden rounded-full bg-raised">
                    <span className={cx("block h-full rounded-full", (b.pct20 ?? 0) >= 90 ? "bg-positive" : (b.pct20 ?? 0) >= 80 ? "bg-warning" : "bg-negative")} style={{ width: `${Math.min(100, b.pct20 ?? 0)}%` }} />
                  </span>
                  <span className="num text-right">
                    {b.best20 ?? "–"} W <span className="text-muted">{b.pct20 !== null ? `${b.pct20}%` : ""}</span>
                  </span>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-xs text-muted">Where the climbs fell matters too: a band with no climb in it rarely holds a hard 20 minutes.</p>
          </Panel>
        ) : (
          <Panel title="Power once tired">
            <p className="text-sm text-muted">No power in this file, so durability can&apos;t be read.</p>
          </Panel>
        )}
      </div>

      <Panel title="Stops, and what you rode between them" meta={`${report.stops.length} stop${report.stops.length === 1 ? "" : "s"}, ${minutes(report.stopped)}`} pad={false}>
        <div className="overflow-x-auto">
          <table className="num w-full text-sm">
            <thead className="border-y border-line text-left text-muted">
              <tr>
                <th className="px-4 py-2 font-normal sm:px-5">Stretch</th>
                <th className="px-2 py-2 font-normal">Distance</th>
                <th className="px-2 py-2 font-normal">Riding</th>
                {report.hasPower && <th className="px-2 py-2 font-normal">Work</th>}
                {report.hasPower && <th className="px-2 py-2 font-normal">Carbs at 60–90 g/h</th>}
                <th className="px-2 py-2 pr-4 font-normal sm:pr-5">Then stopped</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {report.legs.map((l, i) => {
                const stop = report.stops.find((s) => Math.abs(s.at - l.to) < 400);
                const h = l.moving / 3600;
                return (
                  <tr key={i}>
                    <td className="px-4 py-1.5 font-sans sm:px-5">
                      {l.fromName} → {l.toName}
                    </td>
                    <td className="px-2 py-1.5">{formatDistance(l.to - l.from, units, 0)}</td>
                    <td className="px-2 py-1.5">{hm(l.moving)}</td>
                    {report.hasPower && <td className="px-2 py-1.5">{l.kj.toLocaleString()} kJ</td>}
                    {report.hasPower && (
                      <td className="px-2 py-1.5 text-muted">
                        {Math.round(h * 60)}–{Math.round(h * 90)} g
                      </td>
                    )}
                    <td className="px-2 py-1.5 pr-4 sm:pr-5">{stop ? minutes(stop.seconds) : "–"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="px-4 py-3 text-xs text-muted sm:px-5">
          Stops are where you were stopped for 45 s or more. Name them under Places on the course and they&apos;re called by name here and in the debrief.
        </p>
      </Panel>

      {report.comparisons.length > 0 && (
        <Panel title="Your editions" pad={false}>
          <div className="overflow-x-auto">
            <table className="num w-full text-sm">
              <thead className="border-y border-line text-left text-muted">
                <tr>
                  <th className="px-4 py-2 font-normal sm:px-5">Ride</th>
                  <th className="px-2 py-2 font-normal">Time</th>
                  <th className="px-2 py-2 font-normal">Stopped</th>
                  <th className="px-2 py-2 font-normal">NP</th>
                  <th className="px-2 py-2 font-normal">HR</th>
                  <th className="px-2 py-2 pr-4 font-normal sm:pr-5">You were</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                <tr>
                  <td className="px-4 py-1.5 font-sans font-medium sm:px-5">This race</td>
                  <td className="px-2 py-1.5">{hm(report.elapsed)}</td>
                  <td className="px-2 py-1.5">{minutes(report.stopped)}</td>
                  <td className="px-2 py-1.5">{report.np ?? "–"} W</td>
                  <td className="px-2 py-1.5">{report.hr ?? "–"}</td>
                  <td className="px-2 py-1.5 pr-4 sm:pr-5" />
                </tr>
                {report.comparisons.map((x, i) => (
                  <tr key={x.id}>
                    <td className="px-4 py-1.5 font-sans sm:px-5">
                      <span className="mr-1.5 inline-block h-0.5 w-3 align-middle" style={{ background: SERIES[i % SERIES.length] }} />
                      {x.name}
                      {!x.past && <span className="ml-1 text-xs text-muted">another rider</span>}
                    </td>
                    <td className="px-2 py-1.5">{x.elapsed !== null ? hm(x.elapsed) : "–"}</td>
                    <td className="px-2 py-1.5">{x.stopped !== null ? minutes(x.stopped) : "–"}</td>
                    <td className="px-2 py-1.5">{x.np ?? "–"} W</td>
                    <td className="px-2 py-1.5">{x.hr ?? "–"}</td>
                    <td className={cx("px-2 py-1.5 pr-4 sm:pr-5", deltaClass(x.finishGap ?? x.lastGap))}>
                      {x.finishGap !== null ? `${signedMin(x.finishGap)} at the finish` : x.lastGap !== null ? `${signedMin(x.lastGap)} at ${fmt.at(x.lastShared)}` : "–"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}

      <div className="flex justify-end">
        <button type="button" className={button.secondary} onClick={() => document.getElementById("race-files")?.scrollIntoView({ behavior: "smooth", block: "start" })}>
          Add another year or rider
        </button>
      </div>
    </div>
  );
}
