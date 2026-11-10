import Link from "next/link";
import { notFound } from "next/navigation";
import Nav from "@/components/nav";
import { ExperimentalTag } from "@/components/experimental-tag";
import { Notice, Page, PageHeader, Panel, Stat, StatStrip } from "@/components/ui";
import { loadCourse, loadHomeElevation, refreshForecast } from "@/lib/course";
import { courseProfile, COURSE_TYPE_LABELS } from "@/lib/engine/course/profile";
import { preRaceReport, type PreRaceReport } from "@/lib/engine/course/prerace";
import { compass, weatherLabel } from "@/lib/engine/course/weather";
import { GOAL_KIND_LABELS, type Goal } from "@/lib/engine/plan";
import { clockAt } from "@/lib/engine/raceday";
import { experiments } from "@/lib/experiments";
import { courseFormatters } from "@/lib/race-format";
import { createClient } from "@/lib/supabase/server";
import { loadTrainingState, type TrainingState } from "@/lib/training";
import { distanceIn, distanceUnit, elevationIn, elevationUnit, readUnits, type UnitSystem } from "@/lib/units";
import CourseField from "../../course-field";
import CourseView from "./course-view";
import { HomeElevationForm, MeasureDrag, RaceTargetForm, RefreshForecast, ScienceLink, UseCourseDuration } from "./prep-actions";
import { loadRiderDrag } from "@/lib/calibration";
import { defaultPack, PACK_LABELS, ROAD_KINDS } from "@/lib/engine/course/pacing";
import { clock } from "@/lib/engine/course/target";

export const metadata = { title: "Pre-race report · Lactic" };
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f-]{36}$/i;

const hm = (seconds: number) => {
  const m = Math.round(seconds / 60);
  return m >= 60 ? `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")}` : `${m} min`;
};
const fmtHeight = (meters: number, units: UnitSystem) => `${Math.round(elevationIn(meters, units)).toLocaleString()} ${elevationUnit(units)}`;
const longDate = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" });
const why = (note: string) => {
  const t = note.replace("Shaped for the course: ", "");
  return t[0].toUpperCase() + t.slice(1);
};
const shortDate = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });

/**
 * An event's pre-race report, from the course file attached to it: the profile and its climbs, how
 * hard to ride each part, fuel, the forecast once race day is about two weeks out, and how the plan
 * is training for it. Every number comes from the engine (engine/course).
 */
export default async function PreRacePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  if (!experiments().course_prep) {
    return (
      <>
        <Nav current="/plan" />
        <Page>
          <PageHeader title="Pre-race report" />
          <Notice>
            Race courses are an experimental feature. Turn them on in{" "}
            <Link href="/settings" className="underline">
              Settings → Experimental features
            </Link>
            .
          </Notice>
        </Page>
      </>
    );
  }
  const supabase = await createClient();
  const [state, stored] = await Promise.all([loadTrainingState(supabase), loadCourse(supabase, id)]);
  const goal = state.goals.find((g) => g.id === id);
  if (!goal) notFound();
  const units = readUnits();
  const days = Math.round((Date.parse(`${goal.date}T00:00:00Z`) - Date.parse(`${state.today}T00:00:00Z`)) / 86_400_000);
  const when = days > 1 ? `in ${days} days` : days === 1 ? "tomorrow" : days === 0 ? "today" : "done";

  const header = (
    <PageHeader
      title={goal.name}
      line={
        <>
          <ExperimentalTag className="mr-2 align-[2px]" />
          Pre-race report · {GOAL_KIND_LABELS[goal.kind]}, {goal.priority} event · {longDate(goal.date)}
          {goal.startTime ? ` at ${goal.startTime}` : ""} · {when}
        </>
      }
      actions={
        <Link href="/plan" className="text-sm text-muted hover:text-ink">
          Back to the plan
        </Link>
      }
    />
  );

  if (!stored) {
    return (
      <>
        <Nav current="/plan" />
        <Page width="medium">
          {header}
          <Panel title="Add the course">
            <CourseField goal={goal} titled={false} />
          </Panel>
        </Page>
      </>
    );
  }

  const [{ forecast, error: forecastError }, homeElevation, drag] = await Promise.all([refreshForecast(supabase, stored, goal.date, state.today), loadHomeElevation(), loadRiderDrag()]);
  const ownDrag = drag && ROAD_KINDS.includes(goal.kind) ? drag : null;
  const profile = courseProfile(stored.track);
  const report = preRaceReport({
    goal: { ...goal, pack: stored.pack },
    profile,
    rider: { ftp: state.athlete.ftp, weightKg: state.athlete.weightKg },
    forecast,
    today: state.today,
    fmt: courseFormatters(units),
    targetSeconds: stored.targetSeconds,
    homeElevation,
    setup: ownDrag ? { cda: ownDrag.cda, crr: ownDrag.crr } : null,
  });
  const { pacing, fuel } = report;
  const biggest = [...pacing.climbs].sort((a, b) => b.seconds - a.seconds)[0];

  return (
    <>
      <Nav current="/plan" />
      <Page>
        {header}

        <StatStrip cols={5} phone={2}>
          <Stat label="Distance" value={distanceIn(profile.meters, units).toFixed(1)} unit={distanceUnit(units)} sub={profile.loop ? "Starts and ends in the same place" : "Point to point"} />
          <Stat
            label="Climbing"
            value={Math.round(elevationIn(profile.gain, units)).toLocaleString()}
            unit={elevationUnit(units)}
            sub={stored.elevationSource === "terrain" ? "Heights from the terrain map" : !profile.hasElevation ? "No heights in the file" : `${COURSE_TYPE_LABELS[profile.type]} course`}
          />
          <Stat
            label="Your time, about"
            value={hm(pacing.seconds)}
            sub={`Likely ${hm(report.range[0])} to ${hm(report.range[1])} · ${PACK_LABELS[report.pack].toLowerCase()}${report.weather ? ", forecast wind" : ""}`}
          />
          <Stat label="Climbs" value={pacing.climbs.length} sub={biggest ? `Longest about ${hm(biggest.seconds)}` : "None to speak of"} />
          <Stat label="Race power" value={`${pacing.flatWatts[0]}-${pacing.flatWatts[1]}`} unit="W" sub={`On the flat · ${Math.round(pacing.factor * 100)}% intensity`} />
        </StatStrip>

        {(pacing.assumedFtp || pacing.assumedWeight) && (
          <Notice>
            Times and watts assume {pacing.assumedFtp ? `an FTP of ${pacing.ftp} W` : ""}
            {pacing.assumedFtp && pacing.assumedWeight ? " and " : ""}
            {pacing.assumedWeight ? `${pacing.weightKg} kg` : ""}. Set yours in{" "}
            <Link href="/settings" className="underline">
              Settings
            </Link>{" "}
            for your own.
          </Notice>
        )}
        {ROAD_KINDS.includes(goal.kind) && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line bg-surface px-4 py-3 text-sm">
            <span>
              {ownDrag ? (
                <>
                  Times use your own drag, measured from {ownDrag.rides} outdoor rides ({ownDrag.cda.toFixed(2)} m²).
                  {ownDrag.error !== null && ` Timed from their own power, the model was within ${Math.max(1, Math.round(ownDrag.error * 100))}% on a typical ride.`}
                </>
              ) : (
                "Times use a typical rider's drag. Measure yours from your recent outdoor rides with power (from intervals.icu) for a closer estimate and a narrower range."
              )}
            </span>
            <MeasureDrag again={Boolean(ownDrag)} />
          </div>
        )}
        {report.altitude && !report.altitude.known && (
          <div className="space-y-3 rounded-lg border border-line bg-surface px-4 py-3 text-sm">
            <p>
              This course reaches {fmtHeight(Math.max(...profile.ele), units)}. Power drops at altitude for riders who don&apos;t live that high: about 12% at 2,000 m and 16% at 2,500 m for someone from near sea level. Tell Lactic where you live and train and the
              times and watts allow for it.
            </p>
            <HomeElevationForm imperial={units === "imperial"} current={homeElevation} />
          </div>
        )}
        {report.durationGap && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line bg-surface px-4 py-3 text-sm">
            <span>
              The event is set to {hm(report.durationGap.event * 60)}, but this course looks more like {hm(report.durationGap.estimate * 60)} for you. The plan sizes long rides and the event&apos;s load from it.
            </span>
            <UseCourseDuration goalId={goal.id} minutes={report.durationGap.estimate} label={hm(report.durationGap.estimate * 60)} />
          </div>
        )}

        <TargetPanel report={report} state={state} goal={goal} units={units} target={stored.targetSeconds} pack={stored.pack} />

        <Panel title="The course" meta={stored.fileName ?? undefined}>
          <CourseView profile={profile} pacing={pacing} start={goal.startTime ?? null} />
        </Panel>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <Panel title="How to ride it">
            <ul className="list-disc space-y-2 pl-5 text-sm">
              <li>
                Flat and rolling: {pacing.flatWatts[0]}-{pacing.flatWatts[1]} W. Descents: soft-pedal around {pacing.descentWatts} W and recover.
              </li>
              {report.altitude?.known && report.altitude.cost >= 2 && (
                <li>
                  At this altitude you&apos;ll hold about {report.altitude.cost}% less than at home ({`${(Math.round(elevationIn(homeElevation ?? 0, units) / 10) * 10).toLocaleString()} ${elevationUnit(units)}`}); the watts here already allow for it.
                </li>
              )}
              {report.tips.map((t) => (
                <li key={t}>{t}</li>
              ))}
            </ul>
          </Panel>
          <WeatherPanel report={report} goal={goal} units={units} error={forecastError} fetchedAt={forecast?.fetchedAt ?? null} sunrise={forecast?.sunrise ?? null} sunset={forecast?.sunset ?? null} />
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <FuelPanel report={report} start={goal.startTime ?? null} units={units} />
          <TrainingPanel report={report} state={state} goal={goal} />
        </div>

        {report.kit.length > 0 && (
          <Panel title="What to wear and bring">
            <ul className="list-disc space-y-1.5 pl-5 text-sm">
              {report.kit.map((k) => (
                <li key={k}>{k}</li>
              ))}
            </ul>
          </Panel>
        )}

        <Panel title="Course file">
          <CourseField goal={goal} titled={false} />
        </Panel>
        <div className="text-right">
          <ScienceLink />
        </div>
      </Page>
    </>
  );
}

function WeatherPanel({
  report,
  goal,
  units,
  error,
  fetchedAt,
  sunrise,
  sunset,
}: {
  report: PreRaceReport;
  goal: Goal;
  units: UnitSystem;
  error: string | null;
  fetchedAt: string | null;
  sunrise: string | null;
  sunset: string | null;
}) {
  const w = report.weather;
  const fmt = courseFormatters(units);
  if (report.forecastState === "early") {
    return (
      <Panel title="Weather">
        <p className="text-sm text-muted">The forecast starts {shortDate(report.forecastOpens)}, about two weeks out. From then this updates itself every few hours, with the wind on each part of the course.</p>
      </Panel>
    );
  }
  if (report.forecastState === "past") {
    return (
      <Panel title="Weather">
        <p className="text-sm text-muted">This event has been and gone.</p>
      </Panel>
    );
  }
  if (!w) {
    return (
      <Panel title="Weather" meta={<RefreshForecast goalId={goal.id} />}>
        <p className="text-sm text-muted">{error ? `Couldn't get the forecast: ${error}.` : "No forecast yet."}</p>
      </Panel>
    );
  }
  const updated = fetchedAt ? new Date(fetchedAt).toLocaleString("en-US", { weekday: "short", hour: "numeric", minute: "2-digit" }) : null;
  return (
    <Panel
      title="Weather"
      meta={
        <span className="inline-flex flex-wrap items-center gap-2">
          {updated && <span>Updated {updated}</span>}
          <RefreshForecast goalId={goal.id} />
        </span>
      }
    >
      <div className="space-y-4 text-sm">
        <p>
          <span className="font-medium">{w.condition}</span>, {fmt.temp(w.temp[0])} to {fmt.temp(w.temp[1])} (feels {fmt.temp(w.feels[0])} to {fmt.temp(w.feels[1])}). Rain {w.rainChance}%
          {w.rainMm > 0 ? `, ${w.rainMm} mm` : ""}. Wind {fmt.wind(w.windKmh)} from the {compass(w.windFrom)}, gusts to {fmt.wind(w.gustKmh)}.
          {w.assumedStart && <span className="text-muted"> Assumes a {w.start} start; add the start time to the event for your own.</span>}
        </p>
        <p className="text-muted">
          On the course: {Math.round(w.head * 100)}% into the wind, {Math.round(w.tail * 100)}% with it behind you, {Math.round(w.cross * 100)}% crosswind.
          {sunrise && sunset ? ` Sunrise ${sunrise.slice(11, 16)}, sunset ${sunset.slice(11, 16)}.` : ""}
        </p>
        <div className="overflow-x-auto">
          <table className="num w-full min-w-[420px] text-sm">
            <thead>
              <tr className="border-b border-rule text-left text-xs text-muted">
                <th className="py-1.5 pr-3 font-normal">Time</th>
                <th className="py-1.5 pr-3 font-normal">Where</th>
                <th className="py-1.5 pr-3 font-normal">Sky</th>
                <th className="py-1.5 pr-3 font-normal">Temp</th>
                <th className="py-1.5 pr-3 font-normal">Rain</th>
                <th className="py-1.5 font-normal">Wind</th>
              </tr>
            </thead>
            <tbody>
              {w.hours.map((h) => (
                <tr key={h.time} className="border-b border-rule">
                  <td className="py-1.5 pr-3">{h.time.slice(11, 16)}</td>
                  <td className="py-1.5 pr-3">{fmt.at(h.km * 1000)}</td>
                  <td className="py-1.5 pr-3">{weatherLabel(h.code)}</td>
                  <td className="py-1.5 pr-3">{fmt.temp(h.temp)}</td>
                  <td className="py-1.5 pr-3">{h.rainChance}%</td>
                  <td className="py-1.5">
                    {fmt.wind(h.windKmh)} {compass(h.windFrom)}
                    <span className="text-muted"> ({fmt.wind(h.gustKmh)})</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-muted">
          Forecast from{" "}
          <a href="https://open-meteo.com/" className="underline" target="_blank" rel="noreferrer">
            Open-Meteo
          </a>
          , at points along the course.
        </p>
      </div>
    </Panel>
  );
}

function FuelPanel({ report, start, units }: { report: PreRaceReport; start: string | null; units: UnitSystem }) {
  const f = report.fuel;
  const fmt = courseFormatters(units);
  const liters = (ml: number) => (units === "imperial" ? `${Math.round(ml / 29.57)} oz` : `${ml} ml`);
  return (
    <Panel title="Fuel">
      <div className="space-y-4 text-sm">
        <StatStrip cols={3} phone={3}>
          <Stat label="Carbs" value={f.carbsPerHour ?? 0} unit="g/h" sub={f.carbsPerHour ? `${f.carbsTotal} g in all` : "A gel before the start"} />
          <Stat label="Fluid" value={liters(f.fluidPerHour)} unit="/h" sub={`${f.bottles} bottle${f.bottles === 1 ? "" : "s"}`} />
          <Stat label="Sodium" value={f.sodiumPerHour} unit="mg/h" sub={f.fromForecast ? "For the forecast" : "Mild day assumed"} />
        </StatStrip>
        {f.carbLoad && (
          <p>
            {f.carbLoad.days === 2 ? "Each of the two days before" : "The day before"}, about {f.carbLoad.perDay} g of carbohydrate across your meals; about {f.carbLoad.meal} g in the meal three hours before the start.
          </p>
        )}
        {f.feeds.length > 0 && (
          <div>
            <p className="mb-1.5 font-medium">When to eat ({Math.round(f.feeds[0].grams)} g each)</p>
            <ul className="num grid grid-cols-2 gap-x-6 gap-y-1 sm:grid-cols-3">
              {f.feeds.map((x) => (
                <li key={x.seconds}>
                  {start ? clockAt(start, Math.round(x.seconds / 60)) : hm(x.seconds)} · {fmt.at(x.km * 1000)}
                  {x.note && <span className="block text-xs text-muted">{x.note}</span>}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </Panel>
  );
}

function TrainingPanel({ report, state, goal }: { report: PreRaceReport; state: TrainingState; goal: Goal }) {
  const target = state.plan.target?.id === goal.id;
  const shaped = state.plan.weeks.flatMap((w) => w.days).filter((d) => d.course && d.date >= state.today && d.session);
  return (
    <Panel title="Training for it">
      <div className="space-y-3 text-sm">
        {!report.shape ? (
          <p className="text-muted">No climbs long or steep enough to train for on their own, so the plan trains for a {GOAL_KIND_LABELS[goal.kind].toLowerCase()}.</p>
        ) : !target ? (
          <p className="text-muted">
            {why(report.shape.note)} The plan shapes key days for the course once it builds to this event: {goal.priority === "A" ? "build a plan to it on the Plan page" : "make it an A event and build a plan to it"}.
          </p>
        ) : (
          <>
            <p>{why(report.shape.note)}</p>
            {shaped.length > 0 ? (
              <ul className="space-y-1">
                {shaped.slice(0, 4).map((d) => (
                  <li key={d.date} className="flex justify-between gap-3">
                    <span>{shortDate(d.date)}</span>
                    <span className="text-muted">{d.session!.workout.name}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-muted">The climb-length sessions run in the build and specialty weeks; this close to the event the plan is tapering.</p>
            )}
          </>
        )}
        <p className="text-xs text-muted">The coach sees the course too, so you can ask it about pacing or the climbs.</p>
      </div>
    </Panel>
  );
}

function TargetPanel({ report, state, goal, units, target, pack }: { report: PreRaceReport; state: TrainingState; goal: Goal; units: UnitSystem; target: number | null; pack: string | null }) {
  const t = report.target;
  const fmt = courseFormatters(units);
  const soloOnly = goal.kind === "timeTrial" || goal.kind === "hillClimb";
  const planned = state.plan.target?.id === goal.id;
  const climbs = t ? t.pacing.climbs.filter((c) => c.seconds >= 120).slice(0, 8) : [];
  const gain = t ? t.neededFtp - t.ftp : 0;
  return (
    <Panel title="Your target" meta={report.pacing.assumedFtp ? "Assumes a typical FTP" : undefined}>
      <div className="space-y-4 text-sm">
        <RaceTargetForm goalId={goal.id} target={target ? clock(target) : ""} pack={pack ?? ""} usualPack={defaultPack(goal.kind)} soloOnly={soloOnly} />
        {!t ? (
          <p className="text-muted">Set a finish time to see the FTP it takes, whether it&apos;s in reach by race day, and the pacing that gets you there. The plan builds toward it when it&apos;s your A event.</p>
        ) : (
          <>
            <p>
              {t.status === "onTrack" ? (
                <>
                  <span className="font-medium">On track.</span> {clock(t.seconds)} takes an FTP of about {t.neededFtp} W and yours is {t.ftp} W, so ride the pacing below and you&apos;ll have a little in hand.
                </>
              ) : t.status === "stretch" ? (
                <>
                  <span className="font-medium">In reach.</span> {clock(t.seconds)} takes an FTP of about {t.neededFtp} W ({t.neededWkg} W/kg), {gain} W more than now. With {t.weeks} weeks of training a realistic race-day FTP is about {t.raceDayFtp} W, so it&apos;s there if training goes well.
                  {planned ? " The plan builds toward it: key days that raise FTP say so." : goal.priority === "A" ? " Build a plan to this event and it trains toward it." : " Make it your A event and the plan trains toward it."}
                </>
              ) : (
                <>
                  <span className="font-medium">A big ask.</span> {clock(t.seconds)} takes an FTP of about {t.neededFtp} W ({t.neededWkg} W/kg), {gain} W more than now. A realistic race-day FTP in {t.weeks} weeks is about {t.raceDayFtp} W, which rides it in about {clock(t.raceDaySeconds)}. Keep {clock(t.seconds)} as a stretch, or aim for {clock(t.raceDaySeconds)}.
                  {planned ? " The plan still builds toward it." : ""}
                </>
              )}
            </p>
            <div>
              <p className="mb-1.5 font-medium">Pacing for {clock(t.seconds)}</p>
              <p className="mb-2 text-muted">
                Flat and rolling {t.pacing.flatWatts[0]}-{t.pacing.flatWatts[1]} W
                {report.pack !== "solo" ? ` (sitting in, the ${report.pack === "bunch" ? "bunch" : "group"} carries you for less)` : ""}, descents about {t.pacing.descentWatts} W.
              </p>
              {climbs.length > 0 && (
                <div className="overflow-x-auto">
                  <table className="num w-full min-w-[360px] text-sm">
                    <thead>
                      <tr className="border-b border-rule text-left text-xs text-muted">
                        <th className="py-1.5 pr-3 font-normal">Climb</th>
                        <th className="py-1.5 pr-3 font-normal">Where</th>
                        <th className="py-1.5 pr-3 font-normal">Hold</th>
                        <th className="py-1.5 pr-3 font-normal">Time</th>
                        <th className="py-1.5 font-normal">At the top by</th>
                      </tr>
                    </thead>
                    <tbody>
                      {climbs.map((c) => (
                        <tr key={c.n} className="border-b border-rule">
                          <td className="py-1.5 pr-3">{c.n}</td>
                          <td className="py-1.5 pr-3">{fmt.at(c.from)}</td>
                          <td className="py-1.5 pr-3">
                            {c.watts[0]}-{c.watts[1]} W
                          </td>
                          <td className="py-1.5 pr-3">{hm(c.seconds)}</td>
                          <td className="py-1.5">{goal.startTime ? clockAt(goal.startTime, Math.round((c.startsAt + c.seconds) / 60)) : clock(c.startsAt + c.seconds)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </>
        )}
        {report.dropped && (
          <p className="text-muted">
            Riding {report.pack === "bunch" ? "in the bunch" : "in a group"}, you&apos;d finish in about {hm(report.pacing.seconds)}. Dropped on climb {report.dropped.climb} and riding the rest alone, about {hm(report.dropped.seconds)}: staying with them is worth {hm(report.dropped.cost)}.
          </p>
        )}
      </div>
    </Panel>
  );
}
