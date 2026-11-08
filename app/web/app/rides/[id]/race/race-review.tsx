"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AutoTextarea } from "@/components/auto-textarea";
import { button, input, Panel, Pill, Result, Segmented, Stat, StatStrip } from "@/components/ui";
import { Prose } from "@/app/coach/prose";
import { ordinal, raceAdvice, stretches, type Advice } from "@/lib/engine/race/advice";
import type { RaceReport } from "@/lib/engine/race/report";
import { formatClock } from "@/lib/engine/race/results";
import { KIND_LABEL, type Section } from "@/lib/engine/race/sections";
import { raceFormatters, signedSeconds } from "@/lib/race-format";
import { useUnits } from "@/lib/use-units";
import CourseMap from "./course-map";
import GapChart from "./gap-chart";
import { saveRaceNotes, writeRaceDebrief } from "./actions";

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

function deltaClass(d: number | null) {
  if (d === null) return "text-faint";
  if (d >= 0.3) return "text-negative";
  if (d <= -0.3) return "text-positive";
  return "text-muted";
}

function describe(s: Section) {
  if (s.kind === "corner") return `${s.hairpin ? "Hairpin" : "Corner"}, ${Math.abs(s.turn)}° ${s.turn > 0 ? "left" : "right"}`;
  if (s.kind === "climb") return `Climb, ${s.rise} m up`;
  if (s.kind === "descent") return `Descent, ${Math.abs(s.rise)} m down`;
  if (s.kind === "slow") return "Slow spot: barriers, sand, a run-up or off-camber";
  return "Straight";
}

export default function RaceReview({
  activityId,
  report,
  notes,
  debrief,
  coachOn,
}: {
  activityId: string;
  report: RaceReport;
  notes: string;
  debrief: { text: string; rival: string | null; at: string } | null;
  coachOn: boolean;
}) {
  const units = useUnits();
  const fmt = raceFormatters(units);
  const firstRival = report.comparisons.find((c) => c.id !== "best-lap") ?? report.comparisons[0];
  const [compareId, setCompareId] = useState(firstRival.id);
  const c = report.comparisons.find((x) => x.id === compareId) ?? firstRival;
  const advice = useMemo(() => raceAdvice(report, c, raceFormatters(units)), [report, c, units]);
  const where = useMemo(() => stretches(c, report.sections), [c, report.sections]);
  const [focus, setFocus] = useState<Advice | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [hovered, setHovered] = useState<number | null>(null);
  const [showAll, setShowAll] = useState(false);
  const vsSelf = c.id === "best-lap";
  const who = vsSelf ? "your best lap" : c.name.split(" ")[0];
  const highlight = focus ? focus.sections : hovered !== null ? [hovered] : [];
  // Section times against a file without its own times are estimates: say so on every figure.
  const approx = !vsSelf && c.confidence.level !== "high" ? "≈" : "";

  const ownLaps = report.own.laps.filter((l) => l.seconds !== null);
  const bestOwn = ownLaps.reduce((a, l) => ((l.seconds as number) < (a?.seconds ?? Infinity) ? l : a), ownLaps[0]);
  const field = report.field;
  const firstLap = c.laps[0];

  const rows = [...c.sections].sort((a, b) => b.totalAll - a.totalAll);
  const shown = showAll ? rows : rows.slice(0, 10);
  const sel = selected !== null ? report.sections[selected] : null;
  const selRow = sel ? c.sections.find((r) => r.id === sel.id) : null;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Segmented
          label="Compare with"
          value={compareId}
          onChange={(v) => {
            setCompareId(v);
            setFocus(null);
            setSelected(null);
          }}
          options={report.comparisons.map((x) => ({ value: x.id, label: x.place ? `${x.name} (${ordinal(x.place)})` : x.name }))}
        />
      </div>
      {!vsSelf && c.confidence.level !== "high" && <TimingNote who={who} level={c.confidence.level} notes={c.confidence.notes} />}

      <StatStrip cols={4} phone={2}>
        <Stat label="Your race" value={report.own.total !== null ? formatClock(report.own.total) : null} sub={report.own.place ? `${ordinal(report.own.place)} of ${field?.riders ?? "?"}` : `${report.lapCount} laps`} lead />
        <Stat
          label={vsSelf ? "Over your best lap, every lap" : `Gap to ${who}`}
          value={c.finishGap === null ? null : `${c.finishGap > 0 ? "+" : c.finishGap < 0 ? "−" : ""}${Math.abs(Math.round(c.finishGap))}`}
          unit="s"
          sub={firstLap?.delta != null && !vsSelf ? `Lap 1: ${signedSeconds(firstLap.delta)}` : vsSelf ? "Time left on the course" : undefined}
        />
        <Stat label="Lost the most" value={where[0] ? `${Math.round(where[0].seconds)} s` : null} sub={where[0] ? `Around ${report.sections[[...where[0].sections].sort((a, b) => (c.sections[b]?.total ?? 0) - (c.sections[a]?.total ?? 0))[0]].label}, ${Math.round(where[0].perLap)} s a lap` : undefined} />
        <Stat
          label="Your fastest lap"
          value={bestOwn?.seconds != null ? formatClock(bestOwn.seconds) : null}
          sub={bestOwn ? `Lap ${bestOwn.lap}${field && field.laps[bestOwn.lap - 1]?.rank === 1 ? ", fastest in the field" : ""}` : undefined}
        />
      </StatStrip>

      <div className="grid gap-6 lg:grid-cols-[1.15fr_1fr]">
        <Panel title="The lap" meta={`${report.lapMeters.toLocaleString()} m · ${report.sections.length} sections`}>
          <CourseMap line={report.line} sections={report.sections} comparison={c} gate={report.gate} highlight={highlight} selected={selected} onSelect={setSelected} />
          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
            <span className="flex items-center gap-1.5"><span className="inline-block h-1.5 w-4 rounded bg-negative" />Lost time to {who}</span>
            <span className="flex items-center gap-1.5"><span className="inline-block h-1.5 w-4 rounded bg-positive" />Gained</span>
            <span className="flex items-center gap-1.5"><span className="inline-block size-3 rounded-sm bg-ink" />Start and finish</span>
            <span>Numbers are corners. Click a section for its laps.</span>
          </div>
          {sel && selRow && (
            <div className="mt-4 space-y-3 rounded-md border border-line p-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <div>
                  <div className="font-medium">{sel.label}</div>
                  <div className="text-sm text-muted">
                    {describe(sel)} · {sel.to - sel.from} m, {sel.from}–{sel.to} m into the lap
                  </div>
                </div>
                <div className={cx("num text-lg font-medium", deltaClass(selRow.totalAll))}>{approx}{signedSeconds(selRow.totalAll)}</div>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {selRow.perLap.map((d, k) => (
                  <span key={k} className="num rounded bg-raised px-2 py-1 text-xs">
                    <span className="text-muted">Lap {k + 1} </span>
                    <span className={deltaClass(d)}>{d === null ? "–" : `${approx}${signedSeconds(d)}`}</span>
                  </span>
                ))}
              </div>
              {selRow.own && selRow.rival && (
                <table className="num w-full text-sm">
                  <thead className="text-left text-muted">
                    <tr>
                      <th className="font-normal" />
                      <th className="font-normal">In</th>
                      <th className="font-normal">Slowest</th>
                      <th className="font-normal">Out</th>
                      <th className="font-normal">Average</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(
                      [
                        ["You", selRow.own],
                        [vsSelf ? "Best lap" : who, selRow.rival],
                      ] as const
                    ).map(([name, s]) => (
                      <tr key={name}>
                        <td className="py-0.5 text-muted">{name}</td>
                        <td>{fmt.speed(s.entry)}</td>
                        <td>{fmt.speed(s.min)}</td>
                        <td>{fmt.speed(s.exit)}</td>
                        <td>{fmt.speed(s.avg)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}
        </Panel>

        <Panel title="What to work on" meta="From the numbers, biggest first">
          <ul className="space-y-2">
            {advice.map((a) => (
              <li key={a.title}>
                <button
                  type="button"
                  onClick={() => setFocus(focus?.title === a.title ? null : a)}
                  aria-pressed={focus?.title === a.title}
                  className={cx(
                    "w-full rounded-md border p-3 text-left transition-colors",
                    focus?.title === a.title ? "border-ink bg-raised" : "border-line hover:bg-raised",
                  )}
                >
                  <div className="flex items-start justify-between gap-3">
                    <span className="font-medium">{a.title}</span>
                    {a.tone === "work" && a.seconds > 0 ? <Pill tone="negative">{Math.round(a.seconds)} s</Pill> : a.tone === "strength" ? <Pill tone="positive">Strength</Pill> : null}
                  </div>
                  <p className="mt-1 text-sm text-muted">{a.detail}</p>
                </button>
              </li>
            ))}
            {!advice.length && <li className="text-sm text-muted">Nothing stands out against {who}: an even race.</li>}
          </ul>
        </Panel>
      </div>

      <Panel title="The gap, all race" meta={`Hover to see where. Up is behind ${who}.`}>
        <GapChart comparison={c} sections={report.sections} lapMeters={report.lapMeters} lapCount={report.lapCount} onHover={setHovered} />
      </Panel>

      <Debrief activityId={activityId} compareId={c.id} notes={notes} debrief={debrief} coachOn={coachOn} />

      <div className="grid gap-6 lg:grid-cols-[1fr_1.4fr]">
        <Panel title="Laps" pad={false}>
          <div className="overflow-x-auto">
            <table className="num w-full text-sm">
              <thead className="border-y border-line text-left text-muted">
                <tr>
                  <th className="px-4 py-2 font-normal sm:px-5">Lap</th>
                  <th className="px-2 py-2 font-normal">You</th>
                  <th className="px-2 py-2 font-normal">{vsSelf ? "Best" : who}</th>
                  <th className="px-2 py-2 font-normal">Gap</th>
                  {report.own.hasHr && <th className="px-2 py-2 font-normal">HR</th>}
                  {report.own.hasPower && <th className="px-2 py-2 font-normal">Power</th>}
                  {field && <th className="px-2 py-2 pr-4 font-normal sm:pr-5">Field</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {c.laps.map((l, k) => {
                  const own = report.own.laps[k];
                  const f = field?.laps[k];
                  return (
                    <tr key={l.lap}>
                      <td className="px-4 py-2 sm:px-5">{l.lap}</td>
                      <td className="px-2 py-2">{l.own === null ? "–" : formatClock(l.own)}</td>
                      <td className="px-2 py-2">{l.rival === null ? "–" : formatClock(l.rival)}</td>
                      <td className={cx("px-2 py-2", deltaClass(l.delta))}>{signedSeconds(l.delta)}</td>
                      {report.own.hasHr && <td className="px-2 py-2">{own?.avgHr ?? "–"}</td>}
                      {report.own.hasPower && <td className="px-2 py-2">{own?.avgWatts ? `${own.avgWatts} W` : "–"}</td>}
                      {field && <td className="px-2 py-2 pr-4 sm:pr-5">{f ? `${ordinal(f.rank)} of ${f.of}` : "–"}</td>}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {!report.own.hasPower && <p className="px-4 py-3 text-sm text-muted sm:px-5">No power in your file for this race, so the report compares time and speed.</p>}
        </Panel>

        <Panel title="Sections" meta={approx ? `Estimated time lost to ${who}, all laps` : `Time lost to ${who}, all laps`} pad={false}>
          <div className="overflow-x-auto">
            <table className="num w-full text-sm">
              <thead className="border-y border-line text-left text-muted">
                <tr>
                  <th className="px-4 py-2 font-normal sm:px-5">Section</th>
                  {Array.from({ length: report.lapCount }, (_, k) => (
                    <th key={k} className="px-1.5 py-2 text-right font-normal">
                      L{k + 1}
                    </th>
                  ))}
                  <th className="px-2 py-2 pr-4 text-right font-normal sm:pr-5">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {shown.map((r) => {
                  const s = report.sections[r.id];
                  return (
                    <tr
                      key={r.id}
                      className={cx("cursor-pointer hover:bg-raised", selected === r.id && "bg-raised")}
                      onClick={() => setSelected(selected === r.id ? null : r.id)}
                      onMouseEnter={() => setHovered(r.id)}
                      onMouseLeave={() => setHovered(null)}
                    >
                      <td className="px-4 py-1.5 sm:px-5">
                        <span className="font-sans">{s.label}</span>
                        <span className="ml-1.5 font-sans text-xs text-muted">{s.kind === "corner" && s.hairpin ? "hairpin" : `${s.to - s.from} m`}</span>
                      </td>
                      {r.perLap.map((d, k) => (
                        <td key={k} className={cx("px-1.5 py-1.5 text-right", deltaClass(d))}>
                          {d === null ? "–" : d.toFixed(1)}
                        </td>
                      ))}
                      <td className={cx("px-2 py-1.5 pr-4 text-right font-medium whitespace-nowrap sm:pr-5", deltaClass(r.totalAll))}>{approx}{signedSeconds(r.totalAll)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {rows.length > 10 && (
            <div className="px-4 py-3 sm:px-5">
              <button type="button" className={button.ghost} onClick={() => setShowAll(!showAll)}>
                {showAll ? "Show the top 10" : `Show all ${rows.length}`}
              </button>
            </div>
          )}
        </Panel>
      </div>

      <Panel title="By kind of section" meta={`Over the race, against ${who}`}>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          {c.kinds.map((k) => {
            const own = report.own.byKind.find((b) => b.kind === k.kind);
            return (
              <div key={k.kind} className="space-y-0.5">
                <div className="text-sm text-muted">{KIND_LABEL[k.kind]}s</div>
                <div className={cx("num text-xl font-medium", deltaClass(k.seconds))}>{approx}{signedSeconds(k.seconds)}</div>
                <div className="text-xs text-muted">
                  {Math.round(k.meters)} m a lap{own ? ` · you ${fmt.speed(own.speed)}` : ""}
                  {own?.watts ? ` · ${own.watts} W` : ""}
                </div>
              </div>
            );
          })}
        </div>
      </Panel>
    </div>
  );
}

const LEVEL = { high: "Exact", medium: "Good estimate", low: "Rough estimate" } as const;

/** How far to trust section times against this rider, and how to make them exact. */
function TimingNote({ who, level, notes }: { who: string; level: "high" | "medium" | "low"; notes: string[] }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={cx("rounded-md px-3 py-2.5 text-sm", level === "low" ? "bg-pill-warning" : "bg-raised")}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <Pill tone={level === "low" ? "warning" : "neutral"}>Section times: {LEVEL[level].toLowerCase()}</Pill>
        <span className={level === "low" ? "text-warning" : "text-muted"}>
          Lap times and the gap at the line are exact. Inside each lap, {who}&apos;s time is spread over their GPS points
          {level === "medium" ? ", which fit evenly: good to a second or two a section." : ", which don't fit evenly: treat sections as rough."}
        </span>
        <button type="button" className={button.ghost} onClick={() => setOpen(!open)} aria-expanded={open}>
          {open ? "Less" : "Why, and how to make it exact"}
        </button>
      </div>
      {open && (
        <div className="mt-2 space-y-1.5 text-muted">
          {notes.map((n) => (
            <p key={n}>{n}</p>
          ))}
          <p className="text-ink">
            For exact section times, ask {who} for their original ride file: from Garmin Connect (⚙ → Export Original), Wahoo, Hammerhead or intervals.icu (Actions → Download original).
            Strava strips the times from other people&apos;s rides, but the original keeps them. Add it under Riders to compare with, in place of this one.
          </p>
        </div>
      )}
    </div>
  );
}

function Debrief({
  activityId,
  compareId,
  notes,
  debrief,
  coachOn,
}: {
  activityId: string;
  compareId: string;
  notes: string;
  debrief: { text: string; rival: string | null; at: string } | null;
  coachOn: boolean;
}) {
  const router = useRouter();
  const [text, setText] = useState(notes);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const write = () =>
    start(async () => {
      setError(null);
      if (text !== notes) await saveRaceNotes(activityId, text);
      const r = await writeRaceDebrief(activityId, compareId);
      if (!r.ok) setError(r.message);
      else router.refresh();
    });
  return (
    <Panel
      title="Coach's debrief"
      meta={debrief ? `Against ${debrief.rival ?? "the field"} · ${new Date(debrief.at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}` : "Written from the numbers above and your notes"}
    >
      <div className="grid gap-5 lg:grid-cols-[1.5fr_1fr]">
        <div>
          {pending ? (
            <p className="text-sm text-muted">Reading the race…</p>
          ) : debrief ? (
            <Prose text={debrief.text} />
          ) : (
            <p className="text-sm text-muted">
              {coachOn ? "The coach reads this report and your notes, then writes what happened, where the time went and three things to work on for next race." : "Set up the built-in coach in Settings → Coach to get a written debrief. Everything else on this page works without it."}
            </p>
          )}
          {error && <Result ok={false}>{error}</Result>}
        </div>
        <div className="space-y-2">
          <label className="block space-y-2">
            <span className="block text-sm font-medium">Your notes on the race</span>
            <AutoTextarea
              className={`${input} w-full py-2`}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onBlur={() => text !== notes && void saveRaceNotes(activityId, text)}
              placeholder="The start, crashes, bad lines, what hurt, what felt good…"
            />
          </label>
          {coachOn && (
            <button type="button" className={debrief ? button.secondary : button.primary} disabled={pending} onClick={write}>
              {debrief ? "Write it again" : "Write my debrief"}
            </button>
          )}
        </div>
      </div>
    </Panel>
  );
}
