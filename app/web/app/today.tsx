import { formatDistance, formatElevation, readUnits } from "@/lib/units";
import Link from "next/link";
import WorkoutProfile from "@/components/workout-profile";
import { Dash, Panel, PageHeader, Stat, button } from "@/components/ui";
import type { StoredRide, StoredStream } from "@/lib/activities";
import { weighInOn, type BodyMeasurement } from "@/lib/body-data";
import { weighInDue } from "@/lib/engine/weigh-in-due";
import { localDate } from "@/lib/engine/activity";
import { ageOn } from "@/lib/engine/body";
import type { FtpEstimate } from "@/lib/engine/ftp";
import { addDays, formBand } from "@/lib/engine/pmc";
import { MINIMUM_BASELINE_DAYS, recoveryWord } from "@/lib/engine/recovery";
import { formatDay, formatDuration, signed } from "@/lib/format";
import type { RecoveryToday } from "@/lib/recovery-data";
import { complianceDays, plannedOn, ridesFor, type TrainingState } from "@/lib/training";
import { markDays } from "@/lib/engine/compliance";
import { dayRides } from "@/lib/engine/ride-detail";
import CompletedRide from "./completed-ride";
import { exertionTodayFor, todayOptions } from "@/lib/today-options";
import FtpBanner from "./ftp-banner";
import { checkFtp } from "@/lib/engine/ftp-check";
import { ChosenSession, FeelStep, SessionLine } from "./checkin";
import RideSurvey from "./ride-survey";
import Morning, { type MorningProps } from "./morning";
import WeeklyWeighIn from "./weekly-weigh-in";
import RaceDayPlan from "./race-day";
import { GOAL_KIND_LABELS, goalMinutes, PHASE_LABELS, SAFETY_RULE_LABELS, weekStart } from "@/lib/engine/plan";
import type { StoredMessage } from "@/lib/coach/store";
import RideChoice from "@/components/ride-choice";
import RaceReportPrompt from "./race-report-prompt";
import RestDay from "./rest-day";
import ThisWeek from "./this-week";
import type { RaceFollowUp } from "@/lib/engine/race/followup";
import type { RecoverySourceInfo } from "@/lib/recovery-source";
import { ExertionBar, RecoverySummary } from "./last-night";
import TodayPick from "./today-pick";
import type { OptionId } from "@/lib/engine/checkin";
import type { ExertionToday } from "@/lib/engine/recovery-glance";
import { formatHours } from "@/lib/engine/hours";
import type { SafetyRule } from "@/lib/engine/plan";

/**
 * Today answers "what do I ride, and am I up for it?": Morning (recovery, how you feel, the brief), a weekly weigh-in when one is due, then the session, with
 * form, any FTP nudge and the last ride beside it. The longer view lives on Progress. Every value comes from the engine via `state`.
 */
export default function TodayView({
  state,
  body,
  estimate,
  ftpWindowDays,
  coachEnabled,
  brief,
  review = false,
  rideShapes = {},
  healthLinked = false,
  recoverySource = null,
  todayStream = null,
  intervalsConnected = false,
  raceFollowUp = null,
}: {
  state: TrainingState;
  /** Null when weigh-ins failed to load. */
  body: BodyMeasurement[] | null;
  estimate: FtpEstimate | null;
  ftpWindowDays: number;
  coachEnabled: boolean;
  /** Today's morning brief, and whether it needs writing (again). Null when the coach is off. */
  brief: { message: StoredMessage | null; stale: boolean } | null;
  /** The coach has written last week's review (on Progress), in the first days of a week. */
  review?: boolean;
  /** This week's ridden days: each main ride's power, in even slices (rideShape). */
  rideShapes?: Record<string, number[]>;
  /** The Apple Health shortcut has sent data before, so recovery is expected from it. */
  healthLinked?: boolean;
  /** Where the rider's sleep and recovery come from, once known, and whether it's set up to send nights. */
  recoverySource?: RecoverySourceInfo | null;
  /** The stored stream of today's ride, once there is one. */
  todayStream?: StoredStream | null;
  /** intervals.icu is connected, so a workout can go to the bike computer. */
  intervalsConnected?: boolean;
  /** A recent event's race, for a race report (race reports on). */
  raceFollowUp?: (RaceFollowUp & { rideName: string | null }) | null;
}) {
  const { athlete, rides, recovery, today, series } = state;
  const now = series[series.length - 1];
  const todaysWeighIn = body ? weighInOn(body, today, athlete.timezone) : undefined;
  const ridden = ridesOn(state, today);
  const survey = ridden ? null : unansweredRide(state);
  const choice = todayChoice(state, coachEnabled);
  const weekAgo = series.length > 7 ? series[series.length - 8] : undefined;
  const outside = state.outdoor.some((o) => o.date === today);
  // The brief's pick wins (it explains it); else the engine's. The plan's Start ride steps back when they differ.
  const briefPick = (brief?.message?.meta.today as OptionId | undefined) ?? null;
  const pickDiffers =
    !("settled" in choice) && (briefPick && choice.options.options.some((o) => o.id === briefPick) ? briefPick : choice.options.recommended) !== choice.plain;
  const morning: MorningProps = {
    title: "",
    askFeel: false,
    lastNight: recovery?.today ? <RecoverySummary recovery={recovery} variant="tiles" /> : undefined,
    day: today,
    recovery: { in: Boolean(recovery?.today), line: recoveryLine(recovery), healthLinked, source: recoverySource },
    weighedToday: Boolean(todaysWeighIn),
    brief,
    today: choice,
  };

  return (
    <>
      <PageHeader title="Today" line={dayLine(state)} />

      {raceFollowUp && <RaceReportPrompt followUp={raceFollowUp} />}

      {athlete.ftp && <FtpBanner ftp={athlete.ftp} check={checkFtp({ today, ftp: athlete.ftp, history: athlete.ftpHistory, estimate, plan: state.plan })} windowDays={ftpWindowDays} />}

      <RaceSoon state={state} />

      {/* Top to bottom: recovery, "Ready to train?", today's plan beside the suggested option (stacked on a phone),
          the coach's brief, how the week and the plan are tracking, then form and the last ride side by side on a computer. */}
      <div className="space-y-4">
        <Morning {...morning} part="recovery" />

        {/* Weight isn't part of recovery: a slim card asks once a week, before the week's first ride, when there's no recent weigh-in. */}
        {body && (
          <WeeklyWeighIn
            day={today}
            due={weighInDue({ today, timeZone: athlete.timezone, weighIns: body.map((m) => m.measuredAt), rides: rides.map((r) => r.startedAt) })}
            profile={
              athlete.heightCm !== null && athlete.sex !== null && athlete.birthDate !== null
                ? { male: athlete.sex === "male", heightCm: athlete.heightCm, age: ageOn(athlete.birthDate, today) }
                : null
            }
          />
        )}

        {"settled" in choice ? (
          <TodayWorkout state={state} ridden={ridden} stream={todayStream} intervalsConnected={intervalsConnected} exertion={exertionTodayFor(state)} className="" />
        ) : (
          <>
            <ReadyCheck today={choice} day={today} outside={outside} intervalsConnected={intervalsConnected} />
            <div className="grid grid-cols-1 items-stretch gap-4 lg:grid-cols-2">
              <TodayWorkout
                state={state}
                ridden={ridden}
                stream={todayStream}
                intervalsConnected={intervalsConnected}
                exertion={exertionTodayFor(state)}
                className="flex flex-col"
                start={
                  outside ? null : (
                    <Link href={`/ride?day=${today}`} className={pickDiffers ? button.secondary : button.primary}>
                      Start ride
                    </Link>
                  )
                }
              />
              <TodayPick
                today={choice}
                pick={briefPick}
                day={today}
                outside={outside}
                ftp={athlete.ftp}
                exertion={Object.fromEntries(choice.options.options.map((o) => [o.id, exertionTodayFor(state, { session: o.session })]))}
                eased={Boolean(state.todayPlan?.rule && EASED.has(state.todayPlan.rule))}
              />
            </div>
          </>
        )}

        <Morning {...morning} part="brief" />

        <ThisWeek state={state} rideShapes={rideShapes} />

        <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
          {/* Today's form, with the fitness and fatigue it comes from. On a phone, form takes the top row. */}
          <section aria-label="Form" className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-line bg-line sm:grid-cols-3">
            <Stat className="col-span-2 sm:col-span-1" label="Form" value={signed(Math.round(now.form))} sub={formBand(now.form).meaning} />
            <Stat
              label="Fitness"
              value={Math.round(now.fitness)}
              sub={
                <>
                  {weekAgo ? fitnessChange(Math.round(now.fitness - weekAgo.fitness)) : ""}
                  <Link href="/progress" className="text-ink underline underline-offset-4">
                    {review ? "Last week's review" : "Fitness trend"}
                  </Link>
                </>
              }
            />
            <Stat label="Fatigue" value={Math.round(now.fatigue)} sub="Your last week or so of riding" />
          </section>

          {(!ridden || !athlete.ftp) && (
            <section aria-label="Training" className="grid grid-cols-1 gap-px overflow-hidden rounded-lg border border-line bg-line">
              {!ridden && <LastRide ride={rides[0]} timeZone={athlete.timezone} survey={survey} />}
              <FtpNudge ftp={athlete.ftp} hasPowerRides={rides.some((r) => r.normalizedPower !== null)} />
            </section>
          )}
        </div>
      </div>
    </>
  );
}

/** In the two weeks before an event with a course file: a way into its pre-race report, forecast included. */
function RaceSoon({ state }: { state: TrainingState }) {
  const { today } = state;
  const next = state.goals.find((g) => g.course && g.date > today && g.priority !== "C" && Date.parse(`${g.date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`) <= 14 * 86_400_000);
  if (!next) return null;
  const days = Math.round((Date.parse(`${next.date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
  return (
    <Link
      href={`/plan/events/${next.id}`}
      className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 rounded-lg border border-line bg-surface px-4 py-3 text-sm hover:border-ink/30"
    >
      <span>
        <span className="font-medium">{next.name}</span> {days === 1 ? "is tomorrow" : `in ${days} days`}
        <span className="text-muted"> · {formatDistance(next.course!.km * 1000, readUnits())}, {formatElevation(next.course!.gain, readUnits())} up</span>
      </span>
      <span className="text-accent">Pre-race report: course, pacing, fuel{days <= 15 ? " and the forecast" : ""}</span>
    </Link>
  );
}

/**
 * The line under the title: the day and where it sits in the plan. Recovery and form each have their
 * own place on the page, so the line doesn't repeat them.
 */
export function dayLine(state: TrainingState) {
  const { today } = state;
  const day = new Date(`${today}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" });
  const week = state.plan.weeks.find((w) => w.start === weekStart(today));
  const phase = week ? (week.recoveryWeek ? "Recovery week" : `${PHASE_LABELS[week.phase]} week`) : null;
  return `${day}${phase ? `. ${phase}` : ""}.`;
}

/** How you feel and today's options, for the morning routine; or why there's nothing to choose. */
function todayChoice(state: TrainingState, coachEnabled: boolean): MorningProps["today"] {
  const options = todayOptions(state);
  if (!options) {
    const { todayStored, todayPlan, athlete } = state;
    const settled = todayStored?.chosen
      ? "Today's session is locked in."
      : todayPlan?.role === "event"
        ? "Race day. The brief is your race plan."
        : !athlete.ftp
          ? "Set your FTP to get today's options."
          : state.outdoor.some((o) => o.date === state.today && o.workout)
            ? "Riding outside today."
            : "You've ridden today.";
    return { settled };
  }
  const c = state.todayStored?.checkin;
  const planned = state.todayPlan?.session ?? null;
  return {
    options,
    answers: c ? { feel: c.feel, sick: c.sick, minutes: c.minutes, notes: c.notes, at: c.at } : null,
    plain: planned ? "asPlanned" : "rest",
    plannedMinutes: planned ? Math.round(planned.duration / 60) : null,
    coachEnabled,
  };
}

/** The rides that count for a day (copies left out), with the one to show first; null until a real ride is in. */
export function ridesOn(state: TrainingState, day: string) {
  return dayRides(ridesFor(state, day), state.storedDays.find((d) => d.day === day)?.activityId);
}

/** Today's session: the plan's or the one you chose, and how the last ride felt; once ridden, the ride. */
export function TodayWorkout({
  state,
  ridden,
  stream,
  intervalsConnected,
  exertion,
  top,
  ready = null,
  start,
  className = "self-start lg:col-span-2",
}: {
  state: TrainingState;
  ridden: ReturnType<typeof ridesOn>;
  stream: StoredStream | null;
  intervalsConnected: boolean;
  /** Today's exertion and where the ride lands it: one line above Start ride. */
  exertion: ExertionToday | null;
  /** A line at the top of the card (option B's "Ready to ride?"). */
  top?: React.ReactNode;
  /** Asked right above Start ride (Today now asks "Ready to train?" above the workout cards instead). */
  ready?: React.ReactNode;
  /** In place of the Indoors/Outside switch and Start ride, when Today shows the switch above both workout cards. */
  start?: React.ReactNode;
  className?: string;
}) {
  const { todayPlan, todayStored, today, rides, athlete } = state;
  const chosen = todayStored?.chosen ?? null;
  const planned = todayPlan?.session ?? null;
  const outside = state.outdoor.find((o) => o.date === today) ?? null;
  const rodeToday = rides.some((r) => localDate(r.startedAt, athlete.timezone) === today);
  const eased = Boolean(todayPlan?.rule && EASED.has(todayPlan.rule));
  const exertionBar = exertion && (exertion.soFar !== null || exertion.target) ? <ExertionBar exertion={exertion} eased={eased} compact /> : null;

  const title = outside?.workout
    ? outside.workout.name
    : chosen
    ? chosen.session
      ? chosen.session.workout.name
      : "Rest day"
    : todayPlan?.role === "event" && todayPlan.goal
      ? todayPlan.goal.name
      : planned
        ? planned.workout.name
        : "Rest day";

  let body: React.ReactNode;
  let heading: React.ReactNode = title;
  if (ridden) {
    const ride = ridden.main;
    const mark = markDays(complianceDays(state, addDays(today, -1), today), today).get(today) ?? null;
    heading = ride.name ?? "Today's ride";
    body = (
      <CompletedRide
        ride={ride}
        others={ridden.others}
        stream={stream?.activityId === ride.id ? stream : null}
        planned={plannedOn(state, mark?.movedFrom ?? today)}
        mark={mark?.mark ?? null}
        answer={state.feedback.find((f) => f.rideId === ride.id) ?? null}
        ftp={athlete.ftp}
        timeZone={athlete.timezone}
      />
    );
  } else if (rodeToday && !chosen) {
    body = <p className="text-[15px] text-muted">You&apos;ve ridden today.</p>;
  } else if (todayPlan?.role === "event" && todayPlan.goal) {
    const goal = todayPlan.goal;
    const form = state.series[state.series.length - 1].form;
    const score = state.recovery?.score?.score;
    const summary = [
      `${GOAL_KIND_LABELS[goal.kind]}, ${goal.priority} race, about ${formatDuration(goalMinutes(goal) * 60)}.`,
      score !== undefined ? `Recovery ${score}, ${recoveryWord(score)}.` : null,
      `Form ${signed(form)}, ${formBand(form).word}.`,
    ]
      .filter(Boolean)
      .join(" ");
    body = <RaceDayPlan goal={goal} ftp={athlete.ftp} weightKg={athlete.weightKg} summary={summary} />;
  } else if (outside?.workout) {
    body = (
      <div className="space-y-4">
        <WorkoutProfile workout={outside.workout} height={88} details ftp={athlete.ftp} />
        <RideChoice day={today} outside connected={intervalsConnected} outsideNote="in place of the plan's workout" />
      </div>
    );
  } else if (chosen && !chosen.session) {
    body = <RestDay state={state} />;
  } else if (chosen) {
    body = (
      <div className="space-y-4">
        <ChosenSession session={chosen.session} day={today} ftp={athlete.ftp} named={false} extra={<>{exertionBar}{ready}</>} action={<RideChoice day={today} outside={Boolean(outside)} connected={intervalsConnected} href={`/ride?day=${today}`} />} />
      </div>
    );
  } else if (!athlete.ftp) {
    body = (
      <p className="text-[15px] text-muted">
        <Link href="/settings" className="text-ink underline underline-offset-4">
          Set your FTP
        </Link>{" "}
        to get a plan.
      </p>
    );
  } else {
    body = planned ? (
      <div className="space-y-3">
        <SessionLine session={planned} named={false} note={todayPlan?.rule && todayPlan.rule !== "recoveryWeek" ? `Eased: ${SAFETY_RULE_LABELS[todayPlan.rule].toLowerCase()}` : undefined} />
        {todayPlan?.movedFrom && (
          <p className="text-sm text-muted">
            Moved from {weekdayName(todayPlan.movedFrom.date)}, which you missed{todayPlan.movedFrom.shortened ? ", and shortened to fit today" : ""}.
          </p>
        )}
        {todayPlan?.why && <p className="text-sm text-muted">Coach: {todayPlan.why}</p>}
        {todayPlan?.course && !todayPlan.why && <p className="text-sm text-muted">{todayPlan.course}</p>}
        <WorkoutProfile workout={planned.workout} height={88} details ftp={athlete.ftp} fit />
        {exertionBar}
        {ready}
        {start !== undefined ? <div className="mt-auto pt-1">{start}</div> : <RideChoice day={today} outside={Boolean(outside)} connected={intervalsConnected} />}
      </div>
    ) : (
      <RestDay state={state} />
    );
  }

  return (
    <Panel
      title={<span className="text-xl font-semibold tracking-tight">{heading}</span>}
      meta={
        <Link href="/plan" className="hover:text-ink">
          This week&apos;s plan
        </Link>
      }
      className={className}
    >
      {top}
      {body}
    </Panel>
  );
}

/** Plan rules that make today easy on purpose: the exertion line defers to them rather than saying "under target". */
const EASED = new Set<SafetyRule>(["recoveryWeek", "breakWeek", "reentryWeek", "eventTaper", "beforeEvent", "afterEvent"]);

/** The latest ride in the last three days with no post-ride answer yet (rides are newest first). */
export function unansweredRide(state: TrainingState) {
  const { rides, athlete, today } = state;
  const answered = new Set(state.feedback.map((f) => f.rideId));
  const feltDays = new Set(state.recentDays.filter((d) => d.feelAfter !== null).map((d) => d.day));
  return (
    rides.find((r) => {
      const day = localDate(r.startedAt, athlete.timezone);
      return day >= addDays(today, -3) && r.durationSeconds >= 600 && !answered.has(r.id) && !feltDays.has(day);
    }) ?? null
  );
}

/** One line for the morning routine: the score if there is one, otherwise last night's numbers. */
function recoveryLine(recovery: RecoveryToday | null): string | null {
  if (!recovery?.today) return null;
  if (recovery.score) return `${recovery.score.score}, ${recoveryWord(recovery.score.score)}. ${recovery.score.reasons[0] ?? ""}`.trim();
  return [nightValues(recovery.today).join(" · "), `Building your baseline: ${recovery.baselineDays} of ${MINIMUM_BASELINE_DAYS} days.`].filter(Boolean).join(". ");
}

function nightValues(today: NonNullable<RecoveryToday["today"]>) {
  return [
    today.hrv !== undefined && `HRV ${Math.round(today.hrv)} ms`,
    today.restingHeartRate !== undefined && `RHR ${Math.round(today.restingHeartRate)}`,
    today.sleepHours !== undefined && `slept ${Math.floor(today.sleepHours)}h${String(Math.round((today.sleepHours % 1) * 60)).padStart(2, "0")}`,
  ].filter(Boolean);
}

/**
 * "Ready to train?" above both workout cards: how you feel reshapes today's options, and Indoors or
 * Outside goes for whichever you ride.
 */
function ReadyCheck({ today, day, outside, intervalsConnected }: { today: Exclude<MorningProps["today"], { settled: string }>; day: string; outside: boolean; intervalsConnected: boolean }) {
  return (
    <div className="grid gap-x-5 gap-y-3 rounded-lg border border-line bg-surface p-4 text-sm text-muted sm:p-5 lg:grid-cols-[auto_minmax(0,1fr)_auto] lg:items-center">
      <p className="font-medium text-ink">Ready to train?</p>
      <FeelStep key={today.answers?.at ?? "new"} answers={today.answers} plannedMinutes={today.plannedMinutes} coachEnabled={today.coachEnabled} />
      <RideChoice day={day} outside={outside} connected={intervalsConnected} toggleOnly />
    </div>
  );
}

const fitnessChange = (change: number) => (change === 0 ? "Steady this week. " : `${signed(change)} this week. `);

/**
 * FTP lives in Settings; this tile only speaks up when there's none. A higher estimate is the banner above
 * (ftp-banner.tsx). A lower one isn't offered: everyday rides rarely hold a full 20-minute effort, so a
 * lower estimate usually means no hard effort lately, not lost fitness. The overdue-test banner covers that.
 */
function FtpNudge({ ftp, hasPowerRides }: { ftp: number | null; hasPowerRides: boolean }) {
  if (ftp) return null;
  return (
    <Stat
      className="col-span-2 lg:col-span-1"
      label="FTP"
      value={<Dash />}
      sub={
        <>
          {hasPowerRides ? "Rides need an FTP to count toward fitness. " : ""}
          <Link href="/settings#profile" className="text-ink underline underline-offset-4">
            Set your FTP
          </Link>
        </>
      }
    />
  );
}

/** The latest ride in one line; the rest are on Progress → Rides. */
export function LastRide({ ride, timeZone, survey = null, className }: { ride: StoredRide | undefined; timeZone: string; survey?: StoredRide | null; className?: string }) {
  if (!ride) {
    return (
      <Stat
        label="Last ride"
        value={<Dash />}
        sub={
          <>
            No rides yet.{" "}
            <Link href="/settings#connections" className="text-ink underline underline-offset-4">
              Bring in your history
            </Link>
          </>
        }
      />
    );
  }
  // Yesterday's "How was it?" lives with the ride it asks about, not in today's workout card.
  return (
    <Stat
      className={className}
      label="Last ride"
      value={ride.trainingStress !== null ? Math.round(ride.trainingStress) : <Dash />}
      unit="TSS"
      sub={
        <>
          {ride.name ?? "Ride"} · {formatDay(ride.startedAt, timeZone)} · {formatHours(ride.durationSeconds / 3600)}.{" "}
          <Link href="/progress?tab=rides" className="text-ink underline underline-offset-4">
            All rides
          </Link>
          {survey && (
            <div className="mt-4 border-t border-rule pt-4 text-ink">
              <RideSurvey key={survey.id} ride={{ id: survey.id }} name={survey.name ?? "your ride"} question={survey.id === ride.id ? "How was it?" : undefined} narrow />
            </div>
          )}
        </>
      }
    />
  );
}

const weekdayName = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" });
