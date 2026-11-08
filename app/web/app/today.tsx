import Link from "next/link";
import WorkoutProfile from "@/components/workout-profile";
import { Dash, Panel, PageHeader, Stat } from "@/components/ui";
import type { StoredRide, StoredStream } from "@/lib/activities";
import { weighInOn, type BodyMeasurement } from "@/lib/body-data";
import { localDate } from "@/lib/engine/activity";
import { ageOn } from "@/lib/engine/body";
import type { FtpEstimate } from "@/lib/engine/ftp";
import { ZONE_LABELS } from "@/lib/engine/library";
import { addDays, formBand } from "@/lib/engine/pmc";
import { MINIMUM_BASELINE_DAYS, recoveryWord } from "@/lib/engine/recovery";
import { formatDay, formatDuration, signed } from "@/lib/format";
import type { RecoveryToday } from "@/lib/recovery-data";
import { complianceDays, plannedOn, ridesFor, type TrainingState } from "@/lib/training";
import { markDays } from "@/lib/engine/compliance";
import { dayRides } from "@/lib/engine/ride-detail";
import CompletedRide from "./completed-ride";
import { todayOptions } from "@/lib/today-options";
import UseEstimateButton from "./use-estimate-button";
import FtpBanner from "./ftp-banner";
import ProvenanceTag from "@/components/provenance";
import { fromRides } from "@/lib/engine/provenance";
import { checkFtp } from "@/lib/engine/ftp-check";
import { ChosenSession, SessionLine } from "./checkin";
import RideSurvey from "./ride-survey";
import Morning, { type MorningProps } from "./morning";
import RaceDayPlan from "./race-day";
import { GOAL_KIND_LABELS, goalMinutes, SAFETY_RULE_LABELS, SAFETY_RULE_NOTES } from "@/lib/engine/plan";
import type { StoredMessage } from "@/lib/coach/store";
import RideChoice from "@/components/ride-choice";
import WeekReviewCard from "./week-review";
import type { WeekReview } from "@/lib/engine/review";
import type { RecoverySourceInfo } from "@/lib/recovery-source";

/**
 * Today answers "what do I ride, and am I up for it?": Morning (recovery, weight, the brief), then the session, with
 * form, any FTP nudge and the last ride beside it. The longer view lives on Progress. Every value comes from the engine via `state`.
 */
export default function TodayView({
  state,
  body,
  estimate,
  ftpWindowDays,
  coachEnabled,
  brief,
  review,
  healthLinked = false,
  recoverySource = null,
  todayStream = null,
  intervalsConnected = false,
}: {
  state: TrainingState;
  /** Null when weigh-ins failed to load. */
  body: BodyMeasurement[] | null;
  estimate: FtpEstimate | null;
  ftpWindowDays: number;
  coachEnabled: boolean;
  /** Today's morning brief, and whether it needs writing (again). Null when the coach is off. */
  brief: { message: StoredMessage | null; stale: boolean } | null;
  /** The coach's review of last week, in the first days of a week once it's written. */
  review?: { review: WeekReview; message: string; thisWeek: string | null } | null;
  /** The Apple Health shortcut has sent data before, so recovery is expected from it. */
  healthLinked?: boolean;
  /** Where the rider's sleep and recovery come from, once known, and whether it's set up to send nights. */
  recoverySource?: RecoverySourceInfo | null;
  /** The stored stream of today's ride, once there is one. */
  todayStream?: StoredStream | null;
  /** intervals.icu is connected, so a workout can go to the bike computer. */
  intervalsConnected?: boolean;
}) {
  const { athlete, rides, recovery, today, series } = state;
  const now = series[series.length - 1];
  const todaysWeighIn = body ? weighInOn(body, today, athlete.timezone) : undefined;
  const ridden = ridesOn(state, today);

  return (
    <>
      <PageHeader title="Today" line={finding(today, recovery, now.form)} />

      <Morning
        day={today}
        recovery={{ in: Boolean(recovery?.today), line: recoveryLine(recovery), healthLinked, source: recoverySource }}
        weighIn={todaysWeighIn ? { weightKg: todaysWeighIn.weightKg, bodyFatPercent: todaysWeighIn.bodyFatPercent } : null}
        profile={
          athlete.heightCm !== null && athlete.sex !== null && athlete.birthDate !== null
            ? { male: athlete.sex === "male", heightCm: athlete.heightCm, age: ageOn(athlete.birthDate, today) }
            : null
        }
        brief={brief}
        today={todayChoice(state, coachEnabled)}
      />

      {review && <WeekReviewCard {...review} />}

      {athlete.ftp && <FtpBanner ftp={athlete.ftp} check={checkFtp({ today, ftp: athlete.ftp, history: athlete.ftpHistory, estimate, plan: state.plan })} windowDays={ftpWindowDays} />}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <TodayWorkout state={state} ridden={ridden} stream={todayStream} intervalsConnected={intervalsConnected} />

        {/* Recovery and weight are in Morning; fitness history is on Progress and FTP lives in Settings, so this column only
            carries form, an FTP nudge when the estimate moves, and the last ride. */}
        <section aria-label="Training" className="grid grid-cols-2 gap-px self-start overflow-hidden rounded-lg border border-line bg-line lg:grid-cols-1">
          <Stat
            className={ridden ? "col-span-2 lg:col-span-1" : undefined}
            label="Form"
            value={signed(now.form)}
            sub={
              <>
                {formBand(now.form).meaning}{" "}
                <Link href="/progress" className="text-ink underline underline-offset-4">
                  Fitness trend
                </Link>
              </>
            }
          />
          {/* Once today's ride is in, the card beside this is the last ride. */}
          {!ridden && <LastRide ride={rides[0]} timeZone={athlete.timezone} />}
          <FtpNudge ftp={athlete.ftp} estimate={estimate} windowDays={ftpWindowDays} hasPowerRides={rides.some((r) => r.normalizedPower !== null)} today={today} />
        </section>
      </div>
    </>
  );
}

/** The line under the title: the day, and the one fact that decides how to ride it. */
function finding(today: string, recovery: RecoveryToday | null, form: number) {
  const day = new Date(`${today}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" });
  const score = recovery?.score?.score;
  const ready = score === undefined ? null : score >= 67 ? "Recovered" : score >= 34 ? "Normal recovery" : "Under-recovered";
  return `${day}. ${ready ? `${ready} (${score}). ` : ""}Form ${signed(form)}, ${formBand(form).word}.`;
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
function TodayWorkout({ state, ridden, stream, intervalsConnected }: { state: TrainingState; ridden: ReturnType<typeof ridesOn>; stream: StoredStream | null; intervalsConnected: boolean }) {
  const { todayPlan, todayStored, today, rides, athlete } = state;
  const chosen = todayStored?.chosen ?? null;
  const planned = todayPlan?.session ?? null;
  const outside = state.outdoor.find((o) => o.date === today) ?? null;
  const rodeToday = rides.some((r) => localDate(r.startedAt, athlete.timezone) === today);
  // The latest ride in the last three days with no post-ride answer yet (rides are newest first).
  const answered = new Set(state.feedback.map((f) => f.rideId));
  const feltDays = new Set(state.recentDays.filter((d) => d.feelAfter !== null).map((d) => d.day));
  const unanswered = rides.find((r) => {
    const day = localDate(r.startedAt, athlete.timezone);
    return day >= addDays(today, -3) && r.durationSeconds >= 600 && !answered.has(r.id) && !feltDays.has(day);
  });

  const title = outside?.workout
    ? outside.workout.name
    : chosen
    ? chosen.session
      ? chosen.session.workout.name
      : "Rest day"
    : todayPlan?.role === "event" && todayPlan.goal
      ? todayPlan.goal.name
      : planned
        ? ZONE_LABELS[planned.zone]
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
  } else if (chosen) {
    body = (
      <div className="space-y-4">
        <ChosenSession session={chosen.session} day={today} ftp={athlete.ftp} action={<RideChoice day={today} outside={Boolean(outside)} connected={intervalsConnected} href={`/ride?day=${today}`} />} />
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
        <SessionLine session={planned} />
        {todayPlan?.movedFrom && (
          <p className="text-sm text-muted">
            Moved from {weekdayName(todayPlan.movedFrom.date)}, which you missed{todayPlan.movedFrom.shortened ? ", and shortened to fit today" : ""}.
          </p>
        )}
        {todayPlan?.rule && (
          <p className="text-sm text-muted">
            Eased: {SAFETY_RULE_LABELS[todayPlan.rule].toLowerCase()}. {SAFETY_RULE_NOTES[todayPlan.rule]}
          </p>
        )}
        {todayPlan?.why && <p className="text-sm text-muted">Coach: {todayPlan.why}</p>}
        <WorkoutProfile workout={planned.workout} height={88} details ftp={athlete.ftp} />
        <RideChoice day={today} outside={Boolean(outside)} connected={intervalsConnected} />
      </div>
    ) : (
      <p className="text-[15px] text-muted">Nothing planned. Say how you feel above if you want to ride anyway.</p>
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
      className="lg:col-span-2"
    >
      {body}
      {unanswered && (
        <div className="mt-6 border-t border-rule pt-5">
          <RideSurvey key={unanswered.id} ride={{ id: unanswered.id }} name={unanswered.name ?? "your ride"} />
        </div>
      )}
    </Panel>
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

/** FTP lives in Settings; Today only speaks up when there's none, or a recent estimate differs from it. */
function FtpNudge({ ftp, estimate, windowDays, hasPowerRides, today }: { ftp: number | null; estimate: FtpEstimate | null; windowDays: number; hasPowerRides: boolean; today: string }) {
  if (!ftp) {
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
  // A higher estimate is the banner above (ftp-banner.tsx); a lower one is only a note here.
  if (!estimate || Math.round(estimate.watts) >= ftp) return null;
  return (
    <Stat
      className="col-span-2 lg:col-span-1"
      label="New FTP estimate"
      value={Math.round(estimate.watts)}
      unit="W"
      source={<ProvenanceTag source={fromRides(today)} today={today} />}
      sub={
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span>
            {estimate.method === "twentyMinute" ? "95% of your best 20 min" : "Critical power"}, last {windowDays} days. Now{" "}
            <span className="num whitespace-nowrap text-ink">{ftp} W</span>.
          </span>
          <UseEstimateButton estimate={estimate} />
        </span>
      }
    />
  );
}

/** The latest ride in one line; the rest are on Progress. */
function LastRide({ ride, timeZone }: { ride: StoredRide | undefined; timeZone: string }) {
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
  return (
    <Stat
      label="Last ride"
      value={ride.trainingStress !== null ? Math.round(ride.trainingStress) : <Dash />}
      unit="TSS"
      sub={
        <>
          {ride.name ?? "Ride"} · {formatDay(ride.startedAt, timeZone)} · {formatDuration(ride.durationSeconds)}.{" "}
          <Link href="/progress" className="text-ink underline underline-offset-4">
            All rides
          </Link>
        </>
      }
    />
  );
}

const weekdayName = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" });
