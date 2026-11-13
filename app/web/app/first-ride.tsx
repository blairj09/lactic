import Link from "next/link";
import WorkoutProfile from "@/components/workout-profile";
import { button } from "@/components/ui";
import { formatDuration } from "@/lib/format";
import { firstRideSession } from "@/lib/first-ride";
import type { TrainingState } from "@/lib/training";

/** The day the plan starts with no ride on it: an easy first ride to try the trainer, and when the plan's rides begin. */
export default function FirstRide({ state }: { state: TrainingState }) {
  const { today, athlete } = state;
  const session = firstRideSession(state);
  const next = state.plan.weeks.flatMap((w) => w.days).find((d) => d.date > today && (d.session || d.goal));
  const day = next && new Date(`${next.date}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" });
  return (
    <div className="flex flex-1 flex-col space-y-3">
      <p className="text-sm text-muted">
        {formatDuration(session.duration)} easy · Endurance · {Math.round(session.stress)} TSS
      </p>
      <p className="text-[15px]">A chance to try your trainer and Lactic before the plan starts. Keep it chatty.</p>
      <WorkoutProfile workout={session.workout} height={88} details ftp={athlete.ftp} fit />
      <div className="mt-auto pt-1">
        <Link href="/ride?first=1" className={button.primary}>
          Start ride
        </Link>
      </div>
      {next && day && (
        <p className="text-sm text-muted">
          Or rest today. Your plan starts {day} with {next.goal ? next.goal.name : next.session!.workout.name}.
        </p>
      )}
    </div>
  );
}
