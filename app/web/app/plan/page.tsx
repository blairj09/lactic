import Link from "next/link";
import Nav from "@/components/nav";
import { Notice, Page, PageHeader, Panel, Pill, Stat, StatStrip } from "@/components/ui";
import FitnessChart from "@/components/fitness-chart";
import WorkoutProfile from "@/components/workout-profile";
import { localDate } from "@/lib/engine/activity";
import { ZONE_LABELS } from "@/lib/engine/library";
import { addDays } from "@/lib/engine/pmc";
import { signed } from "@/lib/format";
import { BREAK_KIND_LABELS, BREAK_RIDING_LABELS, PHASE_LABELS, PLAN_GOAL_LABELS, weekStart, type Break, type PlanDay, type PlanWeek } from "@/lib/engine/plan";
import { authEnabled } from "@/lib/supabase/config";
import { createClient } from "@/lib/supabase/server";
import { complianceDays, loadTrainingState, plannedOn, ridesFor, type TrainingState } from "@/lib/training";
import { DAY_MARK_LABELS, markDays, weekProgress, type DayMark, type DayResult } from "@/lib/engine/compliance";
import { templateById } from "@/lib/engine/templates";
import type { OutdoorRide } from "@/lib/engine/outdoor";
import { WORKOUT_DAYS } from "@/lib/intervals/calendar";
import OutdoorToggle from "@/components/outdoor-toggle";
import { AvailabilityForm, BreakForm, DeleteBreakButton, EndPlanButton, GoalForm, GoalList, PickWorkoutsButton, PlanForm } from "./forms";
import PhaseStrip from "./phase-strip";
import EditableDay from "./day-editor";
import EditableEvent from "./event-editor";
import { CHANGE_WINDOW_DAYS } from "@/lib/coach/changes";

export const metadata = { title: "Plan · My Coach" };
export const dynamic = "force-dynamic";
// Re-picking workouts runs the coach, which can take a minute or two.
export const maxDuration = 300;

const DETAIL_WEEKS = 4;
const HISTORY_DAYS = 42;

const TABS = [
  { id: "calendar", label: "Calendar" },
  { id: "setup", label: "Setup" },
] as const;

export default async function PlanPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const tab = (await searchParams).tab === "setup" ? "setup" : "calendar";
  if (!authEnabled) {
    return (
      <>
        <Nav current="/plan" />
        <Page>
          <PageHeader title="Plan" line="Plans need Supabase." />
        </Page>
      </>
    );
  }
  const state = await loadTrainingState(await createClient());
  const { plan, today, goals, athlete, activePlan } = state;
  const coach = Boolean(process.env.OPENROUTER_API_KEY);
  const weekHours = athlete.availability.reduce((a, b) => a + b, 0) / 60;
  const current = plan.weeks[0];
  const weeksToGo = plan.target ? plan.weeks.length - 1 : null;

  const history = state.series.filter((d) => d.date >= addDays(today, -HISTORY_DAYS) && d.date < today);
  const chartDays = [...history, ...plan.forecast].map(({ date, fitness, fatigue, form }) => ({ date, fitness, fatigue, form }));
  // Load weeks well short of their target mean the hours, not the plan, are the limit.
  const loadWeeks = plan.weeks.filter((w) => !w.recoveryWeek && (w.phase === "base" || w.phase === "build"));
  const average = (values: number[]) => values.reduce((a, b) => a + b, 0) / Math.max(values.length, 1);
  const shortfall = { planned: average(loadWeeks.map((w) => w.stress)), target: average(loadWeeks.map((w) => w.target)) };
  const timeLimited = loadWeeks.length && shortfall.planned < 0.85 * shortfall.target ? shortfall : null;
  const raceDay = plan.target ? plan.forecast.find((d) => d.date === plan.target!.date) : null;
  const planEnd = activePlan && !plan.target ? plan.forecast.find((d) => d.date === activePlan.end) : null;
  const planWeeks = activePlan ? Math.floor(daysBetween(weekStart(activePlan.start), weekStart(plan.target?.date ?? activePlan.end)) / 7) + 1 : 0;
  const planWeek = activePlan && today >= activePlan.start ? Math.floor(daysBetween(weekStart(activePlan.start), today) / 7) + 1 : null;
  const nextMonday = addDays(weekStart(today), 7);
  const otherPlans = state.plans.filter((p) => p.id !== activePlan?.id && p.end >= today);
  const breaks = state.breaks.filter((b) => b.end >= today);
  const moveTargets = editableDays(state);

  return (
    <>
      <Nav current="/plan" />
      <Page>
      <PageHeader
        title={activePlan ? activePlan.name : plan.target ? `Building to ${plan.target.name}` : "Base training"}
        line={
          activePlan
            ? `${PLAN_GOAL_LABELS[activePlan.goal]} · ${formatDate(activePlan.start)} to ${formatDate(plan.target?.date ?? activePlan.end)} · ${
                planWeek ? `week ${planWeek} of ${planWeeks}` : `starts in ${daysBetween(today, activePlan.start)} days`
              }.${current && planWeek ? ` ${PHASE_LABELS[current.phase]} phase now.` : ""}`
            : plan.target
              ? `${formatDate(plan.target.date)}, ${weeksToGo} week${weeksToGo === 1 ? "" : "s"} away.${current ? ` ${PHASE_LABELS[current.phase]} phase now.` : ""} Set dates and a goal in Setup.`
              : "Build a plan in Setup, or add an A event there to build toward it."
        }
        actions={
          <span className="flex flex-wrap items-center gap-2">
            {coach && <PickWorkoutsButton />}
            {activePlan && <EndPlanButton id={activePlan.id} started={activePlan.start <= today} />}
          </span>
        }
      />

      <nav aria-label="Plan sections" className="-mt-2 flex gap-1">
        {TABS.map((t) => (
          <Link
            key={t.id}
            href={t.id === "calendar" ? "/plan" : `/plan?tab=${t.id}`}
            aria-current={tab === t.id ? "page" : undefined}
            className="rounded-md px-3 py-1.5 text-sm text-muted transition-colors hover:text-ink aria-[current=page]:bg-active aria-[current=page]:text-ink"
          >
            {t.label}
          </Link>
        ))}
      </nav>

      {tab === "calendar" ? (
      <>
      <StatStrip cols={4} phone={2}>
        <Stat label="Fitness now" value={Math.round(state.fitness)} />
        {raceDay ? (
          <Stat label="Fitness on the day" value={Math.round(raceDay.fitness)} sub={`Form ${signed(raceDay.form)} on the day`} />
        ) : planEnd ? (
          <Stat
            label="Fitness at the end"
            value={Math.round(planEnd.fitness)}
            sub={activePlan?.goal === "fitness" && activePlan.target ? `Target ${activePlan.target}` : activePlan?.goal === "ftp" && activePlan.target ? `FTP target ${activePlan.target} W` : "If you ride every session"}
          />
        ) : (
          <Stat label="Fitness in 4 weeks" value={plan.forecast.length ? Math.round(plan.forecast[Math.min(27, plan.forecast.length - 1)].fitness) : null} sub="If you ride every session" />
        )}
        <Stat label="This week" value={current ? (weekSeconds(current) / 3600).toFixed(1) : null} unit="h" sub={current ? `${current.stress} TSS · ${phaseName(current)}` : undefined} />
        <Stat label="Time available" value={weekHours.toFixed(1)} unit="h a week" sub={<Link href="/plan?tab=setup#time" className="hover:text-ink">Change</Link>} />
      </StatStrip>

      {timeLimited && (
        <Notice>
          Your time caps the load: load weeks reach about {Math.round(timeLimited.planned)} of the {Math.round(timeLimited.target)} TSS your ramp
          rate needs. More time or a gentler rate closes the gap.
        </Notice>
      )}

      {activePlan && planEnd && activePlan.goal === "fitness" && activePlan.target && planEnd.fitness < activePlan.target - 2 && (
        <Notice>
          Fitness reaches {Math.round(planEnd.fitness)} by {formatDate(activePlan.end)}, short of {activePlan.target}. More time, a faster ramp rate or a
          later end closes the gap.
        </Notice>
      )}

      {plan.weeks.length > 1 && (
        <Panel title="Phases" meta={`${plan.weeks.length} weeks from this one`}>
          <PhaseStrip weeks={plan.weeks.filter((w) => !w.beforePlan)} today={today} />
        </Panel>
      )}

      <Panel title="Fitness forecast" meta="Six weeks back, plan dashed">
        <FitnessChart
          days={chartDays}
          label="for the last six weeks and the plan ahead"
          forecastFrom={today}
          markers={[
            ...goals.filter((g) => g.date >= today && g.priority !== "C").map((g) => ({ date: g.date, label: `${g.name} (${g.priority})` })),
            ...breaks.filter((b) => b.riding === "off").map((b) => ({ date: b.start, label: `${BREAK_KIND_LABELS[b.kind]} break` })),
          ]}
        />
      </Panel>

      <section className="space-y-4">
        {plan.weeks.slice(0, DETAIL_WEEKS).map((week) => (
          <WeekView key={week.start} week={week} state={state} moveTargets={moveTargets} />
        ))}
        {plan.weeks.length > DETAIL_WEEKS && (
          <details className="rounded-lg border border-line bg-surface">
            <summary className="cursor-pointer px-5 py-4 text-sm font-medium">All {plan.weeks.length} weeks</summary>
            <div className="overflow-x-auto px-5 pb-4">
            <table className="num w-full text-sm">
              <thead className="text-left text-muted">
                <tr>
                  <th className="py-1 pr-3 font-normal">Week of</th>
                  <th className="py-1 pr-3 font-normal">Phase</th>
                  <th className="py-1 pr-3 text-right font-normal">Hours</th>
                  <th className="py-1 pr-3 text-right font-normal">TSS</th>
                  <th className="py-1 font-normal">Key sessions</th>
                </tr>
              </thead>
              <tbody>
                {plan.weeks.map((w) => (
                  <tr key={w.start} className="border-t border-rule">
                    <td className="py-1.5 pr-3 whitespace-nowrap">{formatDate(w.start)}</td>
                    <td className="py-1.5 pr-3 whitespace-nowrap">{phaseName(w)}</td>
                    <td className="py-1.5 pr-3 text-right">{(weekSeconds(w) / 3600).toFixed(1)}</td>
                    <td className="py-1.5 pr-3 text-right">{w.stress}</td>
                    <td className="py-1.5 text-muted">
                      {w.days
                        .filter((d) => d.role === "key" || d.role === "event")
                        .map((d) => (d.goal ? d.goal.name : d.session!.workout.name))
                        .join(", ")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          </details>
        )}
      </section>

      </>
      ) : (
      <div className="grid grid-cols-1 items-start gap-4 md:grid-cols-2">
        <Panel title={activePlan ? "Change this plan" : "Build a plan"}>
          <div className="space-y-4">
            {otherPlans.length > 0 && (
              <ul className="text-sm">
                {otherPlans.map((p) => (
                  <li key={p.id} className="flex items-center justify-between gap-3 border-b border-rule py-2.5">
                    <span>
                      {p.name}
                      <span className="text-muted">
                        {" "}
                        · {PLAN_GOAL_LABELS[p.goal]} · {formatDate(p.start)} to {formatDate(p.end)}
                      </span>
                    </span>
                    <EndPlanButton id={p.id} started={p.start <= today} />
                  </li>
                ))}
              </ul>
            )}
            <PlanForm key={activePlan?.id ?? "new"} today={today} nextMonday={nextMonday} events={goals} plan={activePlan ?? undefined} />
            {activePlan && (
              <details className="text-sm">
                <summary className="cursor-pointer text-muted hover:text-ink">Plan the next block</summary>
                <div className="pt-3">
                  <PlanForm today={today} nextMonday={addDays(activePlan.end, 1)} events={goals} />
                </div>
              </details>
            )}
          </div>
        </Panel>
        <Panel title="Breaks" meta="Travel, holidays, time off the bike">
          <div className="space-y-4">
            {breaks.length === 0 ? (
              <p className="text-sm text-muted">None planned.</p>
            ) : (
              <ul className="text-sm">
                {breaks.map((b) => (
                  <li key={b.id} className="flex items-center justify-between gap-3 border-b border-rule py-2.5">
                    <span>
                      {BREAK_KIND_LABELS[b.kind]}
                      <span className="text-muted">
                        {" "}
                        · {formatDate(b.start)}
                        {b.end !== b.start && ` to ${formatDate(b.end)}`} · {ridingLabel(b)}
                        {b.note && ` · ${b.note}`}
                      </span>
                    </span>
                    <DeleteBreakButton id={b.id} />
                  </li>
                ))}
              </ul>
            )}
            <p className="text-sm text-muted">
              Four days off makes it a recovery week; after a week off, the first week back is gentler.
            </p>
            <BreakForm today={today} />
          </div>
        </Panel>
        <Panel title="Events">
          <div className="space-y-4">
          <GoalList goals={goals.filter((g) => g.date >= today)} today={today} />
          <p className="text-sm text-muted">
            A: the plan peaks for it. B: a short taper. C: ridden as training.
          </p>
          <GoalForm today={today} />
          </div>
        </Panel>
        <div id="time" className="scroll-mt-16">
          <Panel title="Time to train">
            <AvailabilityForm availability={athlete.availability} rampRate={athlete.rampRate} />
          </Panel>
        </div>
      </div>
      )}
      </Page>
    </>
  );
}

/** Days you can edit or move a session to on the Plan page: today (until it's ridden) through the change window, not events. */
function editableDays(state: TrainingState) {
  const last = addDays(state.today, CHANGE_WINDOW_DAYS);
  const riddenToday = state.rides.some((r) => localDate(r.startedAt, state.athlete.timezone) === state.today);
  return state.plan.weeks
    .flatMap((w) => w.days)
    .filter((d) => d.date >= state.today && d.date <= last && d.role !== "event" && !(riddenToday && d.date === state.today))
    .map((d) => ({ date: d.date, label: formatDate(d.date, true) }));
}

function WeekView({ week, state, moveTargets }: { week: PlanWeek; state: TrainingState; moveTargets: { date: string; label: string }[] }) {
  const tz = state.athlete.timezone;
  const started = week.start <= state.today;
  // A day either side, so a session moved across the week's edge still matches.
  const around = started ? complianceDays(state, addDays(week.start, -1), addDays(week.start, 7)) : [];
  const marks = markDays(around, state.today);
  const progress = started ? weekProgress(around.slice(1, 8), state.today) : null;
  return (
    <Panel
      title={`Week of ${formatDate(week.start)}`}
      meta={
        <span className="num">
          {phaseName(week)}
          {week.breakNote === "reentry" && " · first week back"} · {(weekSeconds(week) / 3600).toFixed(1)} h · {week.stress} TSS
        </span>
      }
    >
      {progress && progress.planned > 0 && <WeekBar progress={progress} />}
      <div className="grid grid-cols-1 gap-px overflow-hidden rounded-md bg-line sm:grid-cols-7">
        {week.days.map((day) => {
          const rides = day.date <= state.today ? ridesFor(state, day.date) : [];
          const past = day.date < state.today;
          const cell = (
            <DayCell
              key={day.date}
              day={day}
              past={past}
              today={day.date === state.today}
              changed={state.changedDays.includes(day.date)}
              rides={rides}
              timeZone={tz}
              mark={marks.get(day.date) ?? null}
              plannedThen={past ? (plannedOn(state, day.date)?.session ?? null) : null}
              outdoor={day.date <= addDays(state.today, WORKOUT_DAYS - 1) ? { ride: state.outdoor.find((o) => o.date === day.date) ?? null } : null}
            />
          );
          if (day.role === "event" && day.goal && !past) {
            return (
              <EditableEvent key={day.date} goal={day.goal} label={formatDate(day.date, true)} today={state.today} className="group bg-surface">
                {cell}
              </EditableEvent>
            );
          }
          if (!moveTargets.some((t) => t.date === day.date)) return <div key={day.date} className="bg-surface">{cell}</div>;
          return (
            <EditableDay
              key={day.date}
              day={{ date: day.date, label: formatDate(day.date, true), workout: day.session?.workout ?? null, changed: state.changedDays.includes(day.date), why: day.why ?? null }}
              ftp={state.athlete.ftp ?? 0}
              moveTargets={moveTargets}
              className="group bg-surface"
            >
              {cell}
            </EditableDay>
          );
        })}
      </div>
    </Panel>
  );
}

/** Stress ridden this week against the plan: the bar is the whole week, the tick where the plan is up to today. */
function WeekBar({ progress }: { progress: { planned: number; plannedToDate: number; done: number } }) {
  const scale = Math.max(progress.planned, progress.done, 1);
  return (
    <div className="mb-4 space-y-1.5">
      <div className="num flex flex-wrap justify-between gap-x-4 text-sm">
        <span>
          Done <span className="font-medium">{progress.done}</span> of {progress.planned} TSS
        </span>
        <span className="text-muted">{progress.plannedToDate} planned through yesterday</span>
      </div>
      <div className="relative h-2 rounded-full bg-raised" role="img" aria-label={`${progress.done} of ${progress.planned} TSS done, ${progress.plannedToDate} planned through yesterday`}>
        <span className="absolute inset-y-0 left-0 rounded-full bg-accent" style={{ width: `${(Math.min(progress.done, scale) / scale) * 100}%` }} />
        {progress.plannedToDate > 0 && <span className="absolute -inset-y-1 w-0.5 bg-ink" style={{ left: `${(progress.plannedToDate / scale) * 100}%` }} />}
      </div>
    </div>
  );
}

const MARK_TONE: Record<DayMark, "positive" | "warning" | "negative" | "neutral"> = {
  done: "positive",
  partial: "warning",
  moved: "neutral",
  missed: "negative",
  unplanned: "neutral",
};

function MarkPill({ mark }: { mark: DayResult }) {
  const label =
    mark.mark === "moved" && mark.movedTo
      ? `Moved to ${formatDate(mark.movedTo, true).split(",")[0]}`
      : mark.mark === "moved" && mark.movedFrom
        ? `From ${formatDate(mark.movedFrom, true).split(",")[0]}`
        : mark.mark === "partial" && mark.share !== null
          ? `${Math.round(mark.share * 100)}% done`
          : DAY_MARK_LABELS[mark.mark];
  return <Pill tone={MARK_TONE[mark.mark]}>{label}</Pill>;
}

function DayCell({
  day,
  past,
  today,
  changed,
  rides,
  timeZone,
  mark,
  plannedThen,
  outdoor,
}: {
  day: PlanDay;
  past: boolean;
  today: boolean;
  changed: boolean;
  /** The rides that count for the day, linked ones from other days too. */
  rides: TrainingState["rides"];
  timeZone: string;
  /** Planned against done, once the day is past or ridden. */
  mark: DayResult | null;
  /** For a past day: the session that was in force then. */
  plannedThen: PlanDay["session"];
  /** Whether the day is ridden outside; null when it's too far ahead to send to the Karoo. */
  outdoor: { ride: OutdoorRide | null } | null;
}) {
  const outside = outdoor?.ride ?? null;
  const template = day.role === "key" ? templateById(day.session?.template) : null;
  const structure = template && !template.id.endsWith("-intervals") ? template.name : null;
  return (
    // On a phone each day is a row (the date beside it); from sm up, a column of the week.
    <div
      className={`relative grid h-full grid-cols-[5.5rem_minmax(0,1fr)] gap-x-3 bg-surface p-3 text-sm transition-colors group-hover:bg-raised/50 sm:block sm:min-h-28 sm:space-y-1 ${past ? "bg-raised/60" : ""}`}
    >
      {today && <span aria-hidden className="absolute inset-y-0 left-0 w-0.5 bg-accent sm:inset-x-0 sm:inset-y-auto sm:top-0 sm:h-0.5 sm:w-auto" />}
      <div className={today ? "font-medium" : "text-muted"}>
        {formatDate(day.date, true)}
        {today && <span className="sm:hidden"><br />Today</span>}
        {today && <span className="hidden sm:inline"> · Today</span>}
        {changed && <span title={day.session?.edited ? "You edited this workout" : "Changed by you or the coach"}> · {day.session?.edited ? "edited" : "changed"}</span>}
      </div>
      <div className="min-w-0 space-y-1">
      {day.break && <div className="text-xs text-muted">{BREAK_KIND_LABELS[day.break.kind]} · {ridingLabel(day.break)}</div>}
      {past ? (
        <>
          {mark && <MarkPill mark={mark} />}
          {plannedThen && (
            <div className="num text-xs text-muted" title={plannedThen.workout.name}>
              Planned {ZONE_LABELS[plannedThen.zone].toLowerCase()}, {Math.round(plannedThen.duration / 60)} min · {Math.round(plannedThen.stress)} TSS
            </div>
          )}
          {rides.length ? <DayRides rides={rides} day={day.date} timeZone={timeZone} /> : !mark && <div className="text-muted">Rest</div>}
        </>
      ) : day.role === "event" && day.goal ? (
        <div className="font-medium">
          {day.goal.name} <span className="text-muted">({day.goal.priority})</span>
        </div>
      ) : outside?.workout ? (
        <>
          <div className="font-medium">{outside.workout.name}</div>
          <div className="text-xs text-muted">Outside, on the Karoo, in place of {day.session ? ZONE_LABELS[day.session.zone].toLowerCase() : "rest"}</div>
          <div className="pt-1">
            <WorkoutProfile workout={outside.workout} height={28} />
          </div>
          <OutdoorToggle day={day.date} outside compact />
        </>
      ) : day.session ? (
        <>
          <div className="font-medium" title={day.session.workout.name}>
            {day.role === "openers" ? "Openers" : day.role === "test" ? "FTP test" : ZONE_LABELS[day.session.zone]}
            {day.role === "long" && " (long)"}
          </div>
          {structure && <div className="text-xs">{structure}</div>}
          <div className="num text-xs text-muted">
            {Math.round(day.session.duration / 60)} min · {Math.round(day.session.stress)} TSS
            {day.role === "key" && ` · L${day.session.level}`}
          </div>
          {day.why && (
            <div className="text-xs text-muted">
              {day.why}
            </div>
          )}
          <div className="pt-1">
            <WorkoutProfile workout={day.session.workout} height={28} />
          </div>
          {outside && <div className="text-xs font-medium">Outside, on the Karoo</div>}
          {outdoor && <OutdoorToggle day={day.date} outside={Boolean(outside)} compact />}
        </>
      ) : (
        <div className="text-muted">Rest</div>
      )}
      {today && rides.length > 0 && (
        <div className="space-y-1 border-t border-rule pt-2">
          {mark && <MarkPill mark={mark} />}
          <DayRides rides={rides} day={day.date} timeZone={timeZone} />
        </div>
      )}
      </div>
    </div>
  );
}

function DayRides({ rides, day, timeZone }: { rides: TrainingState["rides"]; day: string; timeZone: string }) {
  return rides.map((r) => {
    const ridden = localDate(r.startedAt, timeZone);
    return (
    <Link key={r.id} href={`/rides/${r.id}`} className="block hover:underline hover:decoration-rule hover:underline-offset-2">
      <div className="truncate">{r.name ?? "Ride"}</div>
      <div className="num text-xs text-muted">
        {Math.round(r.durationSeconds / 60)} min{r.trainingStress !== null && ` · ${Math.round(r.trainingStress)} TSS`}
        {ridden !== day && ` · ridden ${formatDate(ridden, true)}`}
      </div>
    </Link>
    );
  });
}

const phaseName = (w: PlanWeek) => w.beforePlan ? "Before the plan" : `${PHASE_LABELS[w.phase]}${w.breakNote === "break" ? " (break)" : w.recoveryWeek ? " (recovery)" : ""}`;
const ridingLabel = (b: Break) => (b.riding === "limited" ? `up to ${b.minutes} min a day` : BREAK_RIDING_LABELS[b.riding].toLowerCase());
const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
const weekSeconds = (w: PlanWeek) => w.days.reduce((t, d) => t + (d.session?.duration ?? 0), 0);
const formatDate = (iso: string, weekday = false) =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { ...(weekday ? { weekday: "short" } : {}), month: "short", day: "numeric", timeZone: "UTC" });
