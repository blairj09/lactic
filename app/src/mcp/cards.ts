// The data for Lactic's cards in an AI app (card-data.ts), read from the engine and the database.

import type { CoachData } from "@/lib/coach/tools";
import { loadRide, loadStream } from "@/lib/activities";
import { ftpOn, localDate } from "@/lib/engine/activity";
import { BLOCK_CHECK_LABELS, EXECUTION_GRADE_LABELS, executionGrade, rideExecution } from "@/lib/engine/execution";
import { addDays } from "@/lib/engine/pmc";
import { plannedTargets } from "@/lib/engine/ride-detail";
import { formatDay, formatDuration, sourceLabel } from "@/lib/format";
import { loadTrainingState, plannedOn, rideDay } from "@/lib/training";
import { createClient } from "~/db/supabase-client";
import { thinStream, type FitnessCard, type RideCard } from "./card-data";

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** One ride: power and heart rate against the target, and how each effort went. Null when there's no such ride. */
export async function rideCard(id: string): Promise<RideCard | null> {
  const supabase = createClient();
  const [ride, stream, state] = await Promise.all([loadRide(supabase, id), loadStream(supabase, id), loadTrainingState(supabase)]);
  if (!ride) return null;
  const tz = state.athlete.timezone;
  const day = localDate(ride.startedAt, tz);
  const ftp = ftpOn(day, state.athlete.ftpHistory, state.athlete.ftp);
  const planned = plannedOn(state, rideDay(state, ride));
  // A ride from elsewhere has no target of its own: show the plan's workout, as the Ride page does.
  const plannedTarget = stream && !stream.target && planned?.session && ftp ? plannedTargets(planned.session.workout, ftp, stream) : null;
  const execution = rideExecution(stream ? { workout: stream.workout ?? null, intervals: stream.intervals ?? null } : null, planned, ride);
  const time = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" }).format(ride.startedAt);
  const intervals = new Map((stream?.intervals ?? []).map((i) => [i.index, i]));

  const stats = [
    { label: "Time", value: formatDuration(ride.durationSeconds) },
    ride.normalizedPower !== null ? { label: "Normalized", value: `${Math.round(ride.normalizedPower)} W` } : null,
    ride.trainingStress !== null ? { label: "TSS", value: String(Math.round(ride.trainingStress)) } : null,
    ride.averageHr !== null ? { label: "Avg HR", value: `${Math.round(ride.averageHr)} bpm` } : null,
    execution ? { label: "Execution", value: `${execution.score}%`, note: EXECUTION_GRADE_LABELS[executionGrade(execution.score)] } : null,
  ].filter((s) => s !== null);

  return {
    view: "ride",
    id: ride.id,
    title: ride.name ?? "Ride",
    line: `${formatDay(ride.startedAt, tz)} at ${time} · ${sourceLabel(ride.source)}`,
    stats: stats.map((s) => ({ label: s.label, value: "note" in s && s.note ? `${s.value} · ${s.note}` : s.value })),
    stream: stream ? thinStream({ ...stream, target: stream.target ?? plannedTarget }) : null,
    targetLabel: plannedTarget ? "Planned" : "Target",
    blocks: execution?.method === "blocks"
      ? execution.blocks
          .filter((b) => b.effort)
          .map((b) => {
            const i = intervals.get(b.index);
            const round = (v: number | null | undefined) => (v === null || v === undefined ? null : Math.round(v));
            return { role: b.role, check: BLOCK_CHECK_LABELS[b.check], ok: b.check === "on", target: round(i?.target), power: round(i?.power), heartRate: round(i?.heartRate) };
          })
      : [],
  };
}

/** Fitness, fatigue and form over the days get_fitness was asked for, with what's ahead dashed and events marked. */
export function fitnessCard(data: CoachData, args: Record<string, unknown>): FitnessCard {
  const { today, series, plan } = data.state;
  const date = (v: unknown) => (typeof v === "string" && DATE.test(v) ? v : null);
  const from = date(args.from) ?? addDays(today, -42);
  const to = date(args.to) ?? today;
  const days = [...series.filter((d) => d.date < today), ...plan.forecast].filter((d) => d.date >= from && d.date <= to);
  const ahead = days.some((d) => d.date >= today);
  return {
    view: "fitness",
    label: ahead ? "and the plan ahead" : "over these days",
    days: days.map((d) => ({ date: d.date, fitness: d.fitness, fatigue: d.fatigue, form: d.form })),
    forecastFrom: ahead ? today : null,
    markers: data.state.goals.filter((g) => g.date >= from && g.date <= to && g.priority !== "C").map((g) => ({ date: g.date, label: g.name })),
  };
}
