// What a finished ride did against its plan, for the coach's after-ride brief: the ride's totals,
// the share of the planned session ridden, the execution score and, when Lactic recorded the
// workout, each effort's power against its target. Every number is the engine's; the coach quotes them.

import { executionGrade, rideExecution, type BlockCheck, type ExecutionGrade } from "./execution";
import { completion, type RideInterval } from "./ride-detail";
import type { Workout } from "./workout";

export interface DebriefRide {
  id: string;
  name: string | null;
  durationSeconds: number;
  trainingStress: number | null;
  normalizedPower: number | null;
  averagePower: number | null;
  averageHr: number | null;
}

export interface RideDebrief {
  name: string;
  minutes: number;
  stress: number | null;
  normalizedWatts: number | null;
  averageWatts: number | null;
  averageHr: number | null;
  /** The session planned for the day; null when nothing was. */
  planned: { name: string | null; minutes: number; stress: number } | null;
  /** Share of the planned session ridden, by stress when both have it, else by time. */
  percentOfPlan: number | null;
  /** 0 to 100 with its grade; "total" when scored from time and stress alone (no Lactic recording). */
  execution: { score: number; grade: ExecutionGrade; method: "blocks" | "total" } | null;
  /** Each hard block of the workout ridden here: its target, the power held and how it went. */
  efforts: { role: string; minutes: number; targetWatts: number | null; watts: number | null; heartRate: number | null; check: BlockCheck }[];
  /** How the rider said it went, when they've answered. */
  felt: { difficulty: string; rpe: number | null; note: string } | null;
  /** Other rides that day, in short. */
  alsoToday: { name: string; minutes: number; stress: number | null }[];
}

/**
 * The debrief of a day's main ride. `recorded` is the workout and blocks Lactic kept on the ride's
 * stream (null for a ride from Zwift, the Karoo or a file), `planned` the day's session.
 */
export function rideDebrief(
  ride: DebriefRide,
  planned: { name: string | null; duration: number; stress: number } | null,
  recorded: { workout: Workout | null; intervals: RideInterval[] | null } | null,
  felt: RideDebrief["felt"],
  others: DebriefRide[] = [],
): RideDebrief {
  const execution = rideExecution(recorded, planned, ride);
  const intervals = recorded?.intervals ?? [];
  const round = (v: number | null) => (v === null ? null : Math.round(v));
  return {
    name: ride.name ?? "Ride",
    minutes: Math.round(ride.durationSeconds / 60),
    stress: round(ride.trainingStress),
    normalizedWatts: round(ride.normalizedPower),
    averageWatts: round(ride.averagePower),
    averageHr: round(ride.averageHr),
    planned: planned ? { name: planned.name, minutes: Math.round(planned.duration / 60), stress: Math.round(planned.stress) } : null,
    percentOfPlan: planned && (planned.stress > 0 || planned.duration > 0) ? Math.round(completion(planned, ride) * 100) : null,
    execution: execution ? { score: execution.score, grade: executionGrade(execution.score), method: execution.method } : null,
    efforts: (execution?.method === "blocks" ? execution.blocks : [])
      .filter((b) => b.effort)
      .map((b) => {
        const i = intervals.find((x) => x.index === b.index);
        return { role: b.role, minutes: Math.round(((i?.planned ?? 0) / 60) * 10) / 10, targetWatts: i?.target ?? null, watts: i?.power ?? null, heartRate: i?.heartRate ?? null, check: b.check };
      }),
    felt,
    alsoToday: others.map((r) => ({ name: r.name ?? "Ride", minutes: Math.round(r.durationSeconds / 60), stress: round(r.trainingStress) })),
  };
}

/**
 * What an after-ride brief is written from, as one string: the day's rides and the answers about
 * them. A new ride, a removed one or a new answer changes it, so the brief is written again; nothing
 * else does, so opening the app again costs no AI call.
 */
export function afterRideKey(rides: { id: string }[], answers: { rideId: string; difficulty: string; rpe: number | null; note: string }[]): string | null {
  if (!rides.length) return null;
  return rides
    .map((r) => r.id)
    .sort()
    .map((id) => {
      const a = answers.find((x) => x.rideId === id);
      return a ? `${id}:${a.difficulty}:${a.rpe ?? ""}:${hash(a.note)}` : id;
    })
    .join(",");
}

/** A short, stable fingerprint of some text, so an edited note counts as a change without keeping the note in the key. */
function hash(text: string): string {
  let h = 0;
  for (let i = 0; i < text.length; i++) h = (Math.imul(h, 31) + text.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}
