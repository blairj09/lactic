import { notFound } from "next/navigation";
import Link from "next/link";
import { ExperimentalTag } from "@/components/experimental-tag";
import { PostToStravaButton } from "~/settings/strava-post-button";
import { experiments } from "@/lib/experiments";
import WorkoutProfile from "@/components/workout-profile";
import {
  button,
  Dash,
  PageHeader,
  Panel,
  Pill,
  Stat,
  StatStrip,
} from "@/components/ui";
import { copyIntervalsId, loadRide, loadStream, type StoredRide } from "@/lib/activities";
import { ftpOn, localDate } from "@/lib/engine/activity";
import {
  DAY_MARK_LABELS,
  LINK_WINDOW_DAYS,
  markDays,
  suggestDay,
  type DayMark,
} from "@/lib/engine/compliance";
import { DIFFICULTY_LABELS, RPE_LABELS } from "@/lib/engine/feedback";
import { BLOCK_CHECK_LABELS, EXECUTION_GRADE_LABELS, executionGrade, rideExecution, type BlockCheck, type Execution } from "@/lib/engine/execution";
import { ZONE_LABELS } from "@/lib/engine/library";
import { addDays } from "@/lib/engine/pmc";
import { eventOnDay } from "@/lib/engine/race/followup";
import { mergeCurves } from "@/lib/engine/power";
import {
  completion,
  plannedTargets,
  targetHit,
  type ChartStream,
  type RideInterval,
} from "@/lib/engine/ride-detail";
import type { Workout } from "@/lib/engine/workout";
import { formatDay, formatDuration, intervalsUrl, SOURCE_LABEL } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import {
  complianceDays,
  linkOptions,
  loadTrainingState,
  plannedOn,
  rideDay,
} from "@/lib/training";
import RideSurvey from "../../ride-survey";
import CountFor from "./count-for";
import RideExplorer from "./ride-explorer";
import { formatDistance, readUnits } from "@/lib/units";

const UUID = /^[0-9a-f-]{36}$/i;
const BEST_DAYS = 90;

/** A ride's page: the full page at /rides/<id>, or the same inside the modal opened from a ride link. */
export default async function RideDetail({
  id,
  actions,
}: {
  id: string;
  actions?: React.ReactNode;
}) {
  if (!UUID.test(id)) notFound();
  const supabase = await createClient();
  const [ride, stream, state, copyOnIntervals] = await Promise.all([
    loadRide(supabase, id),
    loadStream(supabase, id),
    loadTrainingState(supabase),
    copyIntervalsId(supabase, id),
  ]);
  if (!ride) notFound();

  const tz = state.athlete.timezone;
  const day = localDate(ride.startedAt, tz);
  const counted = ride.duplicateOf
    ? (state.rides.find((r) => r.id === ride.duplicateOf) ?? null)
    : ride;
  // This ride on intervals.icu: its own id, else the copy's there, else the counted ride's.
  const intervalsId =
    ride.intervalsId ?? copyOnIntervals ?? counted?.intervalsId ?? null;
  const ftp = ftpOn(day, state.athlete.ftpHistory, state.athlete.ftp);
  // The day it counts for: the plan day you linked it to, else the day it was ridden.
  const countsOn = counted ? rideDay(state, counted) : day;
  const around = complianceDays(
    state,
    addDays(day, -LINK_WINDOW_DAYS - 1),
    addDays(day, LINK_WINDOW_DAYS + 1),
  );
  const mark = markDays(around, state.today).get(countsOn) ?? null;
  // A session ridden a day early or late is compared with the day it was planned for.
  const plannedDay = mark?.movedFrom ?? countsOn;
  const planned = plannedOn(state, plannedDay);
  const options = counted ? linkOptions(state, day) : [];
  const suggestion =
    counted && !state.rideLinks.has(counted.id) && mark?.mark === "unplanned"
      ? suggestDay(around, day, state.today)
      : null;
  // A ride on an event's day was the race: its report is the main thing to open.
  const raced = counted && !ride.duplicateOf ? eventOnDay(state.goals, countsOn) : null;
  const answer =
    state.feedback.find((f) => f.rideId === (counted?.id ?? ride.id)) ?? null;

  // Best power over the 90 days before this ride, for its curve to sit against.
  const before = state.rides.filter(
    (r) =>
      r.id !== ride.id &&
      r.id !== ride.duplicateOf &&
      r.startedAt < ride.startedAt &&
      localDate(r.startedAt, tz) >= addDays(day, -BEST_DAYS),
  );
  const bestCurves = before.flatMap((r) =>
    r.powerCurve ? [r.powerCurve] : [],
  );
  const best = bestCurves.length ? mergeCurves(...bestCurves) : null;

  // A ride from elsewhere has no target of its own: show the plan's workout from the start of the ride.
  const ridden = stream?.workout ?? null;
  const plannedTarget =
    stream && !stream.target && planned?.session && ftp
      ? plannedTargets(planned.session.workout, ftp, stream)
      : null;
  const execution = rideExecution(stream ? { workout: stream.workout ?? null, intervals: stream.intervals ?? null } : null, planned, counted ?? ride);
  const chartStream: ChartStream | null = stream
    ? { ...stream, target: stream.target ?? plannedTarget }
    : null;

  return (
    <>
      <PageHeader
        title={ride.name ?? "Ride"}
        line={
          <>
            {formatDay(ride.startedAt, tz)} at {time(ride.startedAt, tz)} ·{" "}
            {SOURCE_LABEL[ride.source] ?? ride.source}
            {intervalsId && (
              <>
                {" · "}
                <a
                  href={intervalsUrl(intervalsId)}
                  target="_blank"
                  rel="noreferrer"
                  className="underline decoration-rule underline-offset-2 hover:text-ink"
                >
                  Open in intervals.icu
                </a>
              </>
            )}
            {ride.duplicateOf && (
              <>
                {" "}
                · a copy of{" "}
                <Link
                  href={`/rides/${ride.duplicateOf}`}
                  replace
                  className="underline decoration-rule underline-offset-2 hover:text-ink"
                >
                  {counted?.name ?? "another ride"}
                </Link>
                , which is the one counted
              </>
            )}
          </>
        }
        actions={
          <>
            {stream?.route && experiments().race_report && (
              <Link href={`/rides/${ride.id}/race`} className={`${raced ? button.primary : button.secondary} gap-2`} title={raced ? `See how ${raced.name} went` : undefined}>
                Race report
                <ExperimentalTag />
              </Link>
            )}
            {ride.source === "app" && <PostToStravaButton rideId={ride.id} />}
            {actions}
          </>
        }
      />

      <StatStrip cols={5}>
        <Stat
          label="Time"
          value={formatDuration(ride.durationSeconds)}
          sub={
            ride.distanceMeters
              ? formatDistance(ride.distanceMeters, readUnits())
              : undefined
          }
        />
        <Stat
          label="Training stress"
          value={
            ride.trainingStress === null
              ? null
              : Math.round(ride.trainingStress)
          }
          sub={
            ride.stressMethod === "heartRate"
              ? "From heart rate"
              : ride.intensityFactor
                ? `IF ${ride.intensityFactor.toFixed(2)}`
                : undefined
          }
        />
        <Stat
          label="Normalized power"
          value={
            ride.normalizedPower === null
              ? null
              : Math.round(ride.normalizedPower)
          }
          unit="W"
          sub={
            ride.averagePower
              ? `${Math.round(ride.averagePower)} W average`
              : undefined
          }
        />
        <Stat
          label="Heart rate"
          value={ride.averageHr === null ? null : Math.round(ride.averageHr)}
          unit="bpm"
          sub="Average"
        />
        <Stat
          label="How it felt"
          value={answer ? DIFFICULTY_LABELS[answer.difficulty] : null}
          sub={
            answer?.rpe
              ? `RPE ${answer.rpe}, ${RPE_LABELS[answer.rpe].toLowerCase()}`
              : undefined
          }
        />
      </StatStrip>

      {(planned || ridden || options.length > 0) && (
        <PlannedPanel
          ride={counted ?? ride}
          planned={planned}
          ridden={ridden}
          mark={mark?.mark ?? null}
          moved={plannedDay !== day ? plannedDay : null}
          execution={execution}
        >
          {counted && options.length > 0 && (
            <CountFor
              rideId={counted.id}
              ridden={day}
              current={plannedDay}
              options={options}
              suggestion={suggestion}
            />
          )}
        </PlannedPanel>
      )}

      <RideExplorer
        stream={chartStream}
        targetLabel={plannedTarget ? "Planned" : "Target"}
        targetNote={
          plannedTarget
            ? "Shaded: the plan's workout, lined up with the start of the ride"
            : stream?.target
              ? "Shaded: the target"
              : undefined
        }
        route={stream?.route ?? null}
        distance={
          ride.distanceMeters
            ? formatDistance(ride.distanceMeters, readUnits())
            : undefined
        }
        curve={ride.powerCurve}
        best={best}
        bestLabel={`your best of the ${BEST_DAYS} days before`}
        between={
          stream?.intervals &&
          stream.intervals.some((i) => i.ridden > 0) && (
            <Panel
              title="Intervals"
              meta={execution?.method === "blocks" ? `Execution ${execution.score} of 100, block by block` : "Target against what you rode in each one"}
              pad={false}
            >
              <IntervalTable intervals={stream.intervals} execution={execution?.method === "blocks" ? execution : null} />
            </Panel>
          )
        }
        aside={
          <Panel title="After the ride">
            {answer ? (
              <dl className="space-y-2 text-sm">
                <div>
                  <dt className="text-muted">Difficulty</dt>
                  <dd>{DIFFICULTY_LABELS[answer.difficulty]}</dd>
                </div>
                {answer.rpe && (
                  <div>
                    <dt className="text-muted">Effort</dt>
                    <dd>
                      RPE {answer.rpe}, {RPE_LABELS[answer.rpe].toLowerCase()}
                    </dd>
                  </div>
                )}
                {answer.note && (
                  <div>
                    <dt className="text-muted">Note</dt>
                    <dd className="whitespace-pre-line">{answer.note}</dd>
                  </div>
                )}
              </dl>
            ) : counted ? (
              <RideSurvey
                ride={{ id: counted.id }}
                name={counted.name ?? "this ride"}
              />
            ) : (
              <p className="text-sm text-muted">No answer yet.</p>
            )}
          </Panel>
        }
      />
    </>
  );
}

const MARK_TONE: Record<
  DayMark,
  "positive" | "warning" | "negative" | "neutral"
> = {
  done: "positive",
  partial: "warning",
  moved: "neutral",
  missed: "negative",
  unplanned: "neutral",
};

function PlannedPanel({
  ride,
  planned,
  ridden,
  mark,
  moved,
  execution,
  children,
}: {
  children?: React.ReactNode;
  execution: Execution | null;
  ride: StoredRide;
  planned: ReturnType<typeof plannedOn>;
  ridden: Workout | null;
  mark: DayMark | null;
  moved: string | null;
}) {
  const session = planned?.session ?? null;
  const share = planned ? completion(planned, ride) : null;
  const sameWorkout = Boolean(
    session && ridden && session.workout.name === ridden.name,
  );
  return (
    <Panel
      title="Planned and done"
      meta={
        mark && (
          <span className="flex items-center gap-2">
            {moved && (
              <span>
                Planned for {formatDay(new Date(`${moved}T12:00:00Z`), "UTC")}
              </span>
            )}
            <Pill tone={MARK_TONE[mark]}>{DAY_MARK_LABELS[mark]}</Pill>
          </span>
        )
      }
    >
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <div className="space-y-2">
          <div className="text-sm text-muted">Planned</div>
          {session ? (
            <>
              <div className="font-medium">
                {session.workout.name}{" "}
                <span className="font-normal text-muted">
                  · {ZONE_LABELS[session.zone]}
                </span>
              </div>
              <div className="num text-sm text-muted">
                {formatDuration(session.duration)} ·{" "}
                {Math.round(session.stress)} TSS
              </div>
              <WorkoutProfile workout={session.workout} height={36} />
            </>
          ) : planned ? (
            <div className="num text-sm">
              {formatDuration(planned.duration)} · {Math.round(planned.stress)}{" "}
              TSS
            </div>
          ) : (
            <div className="text-sm">Rest</div>
          )}
        </div>
        <div className="space-y-2">
          <div className="text-sm text-muted">Ridden</div>
          <div className="font-medium">
            {ridden && !sameWorkout ? ridden.name : (ride.name ?? "Ride")}
            {session && ridden && !sameWorkout && (
              <span className="font-normal text-muted">
                {" "}
                · a different workout
              </span>
            )}
          </div>
          <div className="num text-sm text-muted">
            {formatDuration(ride.durationSeconds)} ·{" "}
            {ride.trainingStress === null ? (
              <Dash />
            ) : (
              Math.round(ride.trainingStress)
            )}{" "}
            TSS
            {share !== null &&
              ` · ${Math.round(share * 100)}% of the plan${planned && planned.stress > 0 && ride.trainingStress !== null ? "'s stress" : "'s time"}`}
          </div>
          {ridden && <WorkoutProfile workout={ridden} height={36} />}
          {execution && <ExecutionLine execution={execution} against={ridden && !sameWorkout ? "the workout you rode" : null} />}
        </div>
      </div>
      {children}
    </Panel>
  );
}

const KIND_LABEL: Record<RideInterval["kind"], string> = {
  steady: "Steady",
  ramp: "Ramp",
  freeRide: "Free ride",
};
const HIT_CLASS = {
  on: "text-positive",
  under: "text-warning",
  over: "text-negative",
} as const;

const GRADE_TONE = { nailed: "positive", solid: "positive", partial: "warning", off: "negative" } as const;

/** The ride's execution score with its grade, and what it was scored on. */
function ExecutionLine({ execution, against }: { execution: Execution; against: string | null }) {
  const grade = executionGrade(execution.score);
  return (
    <div className="flex flex-wrap items-center gap-2 pt-1 text-sm">
      <span className="num">
        Execution <span className="font-semibold">{execution.score}</span>
        <span className="text-muted"> / 100</span>
      </span>
      <Pill tone={GRADE_TONE[grade]}>{EXECUTION_GRADE_LABELS[grade]}</Pill>
      <span className="text-xs text-muted">
        {execution.method === "blocks"
          ? `Each block's time and power${against ? `, against ${against}` : ""}; hard blocks count most.`
          : "From time and stress against the plan. Rides on Lactic are scored block by block."}
      </span>
    </div>
  );
}

const CHECK_CLASS: Record<BlockCheck, string> = {
  on: "text-positive",
  under: "text-warning",
  over: "text-negative",
  short: "text-warning",
  skipped: "text-negative",
  free: "text-muted",
};

function IntervalTable({ intervals, execution }: { intervals: RideInterval[]; execution: Execution | null }) {
  return (
    <div className="overflow-x-auto px-5 pb-4">
      <table className="num w-full text-sm">
        <thead className="text-left whitespace-nowrap text-muted">
          <tr>
            <th className="pb-2 pr-3 font-normal">#</th>
            <th className="pb-2 pr-3 font-normal">Interval</th>
            <th className="pb-2 pr-3 text-right font-normal">Ridden</th>
            <th className="pb-2 pr-3 text-right font-normal">Target</th>
            <th className="pb-2 pr-3 text-right font-normal">Power</th>
            <th className="pb-2 pr-3 text-right font-normal">HR</th>
            <th className="pb-2 pr-3 text-right font-normal">Cadence</th>
            {execution && <th className="pb-2 font-normal">Check</th>}
          </tr>
        </thead>
        <tbody>
          {intervals.map((i) => {
            const hit =
              i.power !== null && i.target
                ? targetHit(i.power, i.target)
                : null;
            return (
              <tr
                key={i.index}
                className={`border-t border-rule ${i.ridden === 0 ? "text-faint" : ""}`}
              >
                <td className="py-2 pr-3">{i.index + 1}</td>
                <td className="py-2 pr-3 whitespace-nowrap">
                  {execution?.blocks.find((b) => b.index === i.index)?.role || KIND_LABEL[i.kind]} {clock(i.planned)}
                </td>
                <td className="py-2 pr-3 text-right whitespace-nowrap">
                  {i.ridden === 0 ? "Skipped" : clock(i.ridden)}
                </td>
                <td className="py-2 pr-3 text-right">
                  {i.target ? `${i.target} W` : <Dash />}
                </td>
                <td
                  className={`py-2 pr-3 text-right font-medium ${hit ? HIT_CLASS[hit] : ""}`}
                >
                  {i.power !== null ? `${i.power} W` : <Dash />}
                </td>
                <td className="py-2 pr-3 text-right">
                  {i.heartRate ?? <Dash />}
                </td>
                <td className="py-2 pr-3 text-right">{i.cadence ?? <Dash />}</td>
                {execution && <CheckCell block={execution.blocks.find((b) => b.index === i.index)} />}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function CheckCell({ block }: { block: Execution["blocks"][number] | undefined }) {
  if (!block) return <td className="py-2" />;
  return (
    <td className={`py-2 whitespace-nowrap ${CHECK_CLASS[block.check]}`}>
      {BLOCK_CHECK_LABELS[block.check]}
      {block.score !== null && block.check !== "on" && <span className="text-muted"> · {block.score}</span>}
    </td>
  );
}

const clock = (seconds: number) =>
  `${Math.floor(seconds / 60)}:${String(Math.round(seconds % 60)).padStart(2, "0")}`;
const time = (date: Date, timeZone: string) =>
  new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
