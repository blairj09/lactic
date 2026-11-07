import Link from "next/link";
import WorkoutProfile from "@/components/workout-profile";
import { button, Pill, Stat, StatStrip } from "@/components/ui";
import type { StoredRide, StoredStream } from "@/lib/activities";
import { DAY_MARK_LABELS, type DayMark } from "@/lib/engine/compliance";
import { DIFFICULTY_LABELS, RPE_LABELS } from "@/lib/engine/feedback";
import { ZONE_LABELS } from "@/lib/engine/library";
import { completion, plannedTargets, smooth } from "@/lib/engine/ride-detail";
import { formatDuration, SOURCE_LABEL } from "@/lib/format";
import type { plannedOn, StoredFeedback } from "@/lib/training";

const MARK_TONE: Record<DayMark, "positive" | "warning" | "negative" | "neutral"> = {
  done: "positive",
  partial: "warning",
  moved: "neutral",
  missed: "negative",
  unplanned: "neutral",
};

/**
 * Today once it's ridden: the ride's numbers, how it went against the plan, and a link to its page.
 * Every figure is the stored ride's (the engine's); this only lays them out.
 */
export default function CompletedRide({
  ride,
  others,
  stream,
  planned,
  mark,
  answer,
  ftp,
  timeZone,
}: {
  ride: StoredRide;
  /** Other rides today, newest first. */
  others: StoredRide[];
  stream: StoredStream | null;
  planned: ReturnType<typeof plannedOn>;
  mark: DayMark | null;
  answer: StoredFeedback | null;
  ftp: number | null;
  timeZone: string;
}) {
  const session = planned?.session ?? null;
  const share = planned ? completion(planned, ride) : null;
  // A ride from Zwift or the Karoo has no target of its own: line the plan's workout up with its start.
  const target = stream ? (stream.target ?? (session && ftp ? plannedTargets(session.workout, ftp, stream) : null)) : null;
  const targetLabel = stream?.target ? "Target" : "Planned";

  return (
    <div className="space-y-4">
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[15px] text-muted">
        {mark && <Pill tone={MARK_TONE[mark]}>{DAY_MARK_LABELS[mark]}</Pill>}
        <span>
          Ridden at {clockTime(ride.startedAt, timeZone)} · {SOURCE_LABEL[ride.source] ?? ride.source}
          {share !== null && ` · ${Math.round(share * 100)}% of the plan${planned!.stress > 0 && ride.trainingStress !== null ? "'s stress" : "'s time"}`}
        </span>
      </p>

      <StatStrip cols={4} phone={2}>
        <Stat label="Time" value={formatDuration(ride.durationSeconds)} sub={ride.distanceMeters ? `${(ride.distanceMeters / 1000).toFixed(1)} km` : undefined} />
        <Stat
          label="Training stress"
          value={ride.trainingStress === null ? null : Math.round(ride.trainingStress)}
          unit="TSS"
          sub={ride.stressMethod === "heartRate" ? "From heart rate" : ride.intensityFactor ? `IF ${ride.intensityFactor.toFixed(2)}` : undefined}
        />
        <Stat
          label="Normalized power"
          value={ride.normalizedPower === null ? null : Math.round(ride.normalizedPower)}
          unit="W"
          sub={ride.averagePower ? `${Math.round(ride.averagePower)} W average` : undefined}
        />
        <Stat label="Heart rate" value={ride.averageHr === null ? null : Math.round(ride.averageHr)} unit="bpm" sub="Average" />
      </StatStrip>

      {stream?.watts && stream.watts.length > 1 ? (
        <PlannedVsDone watts={stream.watts} target={target} step={stream.step} targetLabel={targetLabel} />
      ) : session ? (
        <div className="space-y-2">
          <div className="text-sm text-muted">Planned</div>
          <WorkoutProfile workout={session.workout} height={56} details ftp={ftp} />
        </div>
      ) : null}

      <div className="space-y-1 text-sm">
        {session && (
          <p className="text-muted">
            Planned: {session.workout.name} · {ZONE_LABELS[session.zone]} · {formatDuration(session.duration)} · {Math.round(session.stress)} TSS
          </p>
        )}
        {answer && (
          <p className="text-muted">
            Felt {DIFFICULTY_LABELS[answer.difficulty].toLowerCase()}
            {answer.rpe ? ` · RPE ${answer.rpe}, ${RPE_LABELS[answer.rpe].toLowerCase()}` : ""}
            {answer.note && <span className="block whitespace-pre-line text-ink">{answer.note}</span>}
          </p>
        )}
        {others.map((o) => (
          <p key={o.id} className="text-muted">
            Also today:{" "}
            <Link href={`/rides/${o.id}`} className="text-ink underline underline-offset-4">
              {o.name ?? "Ride"}
            </Link>{" "}
            · {formatDuration(o.durationSeconds)}
            {o.trainingStress !== null && ` · ${Math.round(o.trainingStress)} TSS`}
          </p>
        ))}
      </div>

      <Link href={`/rides/${ride.id}`} className={button.secondary}>
        See the whole ride
      </Link>
    </div>
  );
}

const W = 1000;
const H = 120;

/** Power over the planned or target watts on one small chart, both as 10 s means: short enough that 30 s efforts keep their shape. */
function PlannedVsDone({ watts, target, step, targetLabel }: { watts: number[]; target: (number | null)[] | null; step: number; targetLabel: string }) {
  const every = Math.max(1, Math.round(10 / step));
  const power = smooth(watts, every);
  const plan = target ? smooth(target, every) : null;
  const n = Math.max(power.length, plan?.length ?? 0);
  const top = Math.max(50, ...power.map((v) => v ?? 0), ...(plan ?? []).map((v) => v ?? 0)) * 1.08;
  const x = (i: number) => (i / Math.max(1, n - 1)) * W;
  const y = (v: number) => H - (v / top) * H;

  let line = "";
  power.forEach((v, i) => {
    if (v === null) return;
    line += `${line && power[i - 1] !== null ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`;
  });
  // The plan as one step shape per stretch of targets, down to the axis; free ride leaves a gap.
  let area = "";
  if (plan) {
    const cell = W / Math.max(1, n - 1);
    let open = false;
    plan.forEach((v, i) => {
      const x0 = Math.max(0, x(i) - cell / 2).toFixed(1);
      if (v === null) {
        if (open) area += `H${x0}V${H}Z`;
        open = false;
        return;
      }
      area += open ? `H${x0}V${y(v).toFixed(1)}` : `M${x0},${H}V${y(v).toFixed(1)}`;
      open = true;
    });
    if (open) area += `H${Math.min(W, x(plan.length - 1) + cell / 2).toFixed(1)}V${H}Z`;
  }

  return (
    <figure className="space-y-2">
      <figcaption className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-0.5 w-4 rounded" style={{ background: "var(--series-1)" }} />
          Power
        </span>
        {plan && (
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-4 rounded-sm" style={{ background: "var(--zone-3)", opacity: 0.6 }} />
            {targetLabel}
          </span>
        )}
      </figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="block h-[120px] w-full" role="img" aria-label={`Power against ${targetLabel.toLowerCase()} watts`}>
        {area && <path d={area} fill="var(--zone-3)" opacity={0.6} />}
        <path d={line} fill="none" stroke="var(--series-1)" strokeWidth={1.25} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
        <line x1={0} x2={W} y1={H - 0.5} y2={H - 0.5} stroke="var(--line)" vectorEffect="non-scaling-stroke" />
      </svg>
    </figure>
  );
}

const clockTime = (date: Date, timeZone: string) => new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", minute: "2-digit" }).format(date);
