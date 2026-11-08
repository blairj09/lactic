// How well a ride carried out its workout, 0 to 100, with a check on each block. From the intervals
// Lactic recorded on the ride (ride-detail.ts rideIntervals): the time ridden in each block against
// its length, and the power against its target. Hard blocks count more than the riding between them,
// so cutting a warm-up short costs less than fading in the main set.

import { completion, type RideInterval } from "./ride-detail";
import { EFFORT_FROM, segmentRoles } from "./segment-roles";
import type { Workout } from "./workout";

/** Within this share of the target is on target (as targetHit). */
const ON_TARGET = 0.05;
/** This far under an effort's target (or over an easy block's) scores nothing for power. */
const POWER_ZERO = 0.25;
/** Efforts count this many times an easy block of the same length. */
const EFFORT_WEIGHT = 3;

export type BlockCheck = "on" | "under" | "over" | "short" | "skipped" | "free";

export const BLOCK_CHECK_LABELS: Record<BlockCheck, string> = {
  on: "On target",
  under: "Under target",
  over: "Over target",
  short: "Cut short",
  skipped: "Skipped",
  free: "Free ride",
};

export interface BlockResult {
  index: number;
  /** What the block is for: Warm-up, Effort 2 of 5, Recovery... (segment-roles.ts). */
  role: string;
  effort: boolean;
  check: BlockCheck;
  /** 0 to 100; null for free ride, which isn't scored. */
  score: number | null;
}

export interface Execution {
  /** 0 to 100. */
  score: number;
  /** "blocks" when scored block by block; "total" from time and stress alone (a ride without Lactic's recording). */
  method: "blocks" | "total";
  blocks: BlockResult[];
}

export type ExecutionGrade = "nailed" | "solid" | "partial" | "off";

export const EXECUTION_GRADE_LABELS: Record<ExecutionGrade, string> = {
  nailed: "Nailed it",
  solid: "Solid",
  partial: "Patchy",
  off: "Off target",
};

export function executionGrade(score: number): ExecutionGrade {
  return score >= 90 ? "nailed" : score >= 75 ? "solid" : score >= 50 ? "partial" : "off";
}

/**
 * Scores a ride ridden here against the workout it rode. Each block with a target scores the share of
 * it ridden (up to its length) times how close its power came: full marks within 5%, nothing at 25%
 * off. Efforts lose for being under and easy blocks for being over; the other way round is let go
 * (beyond 25% over on an effort counts as over). Null when no block with a target was planned.
 */
export function scoreExecution(workout: Workout, intervals: RideInterval[]): Execution | null {
  const roles = segmentRoles(workout);
  let weighted = 0;
  let weights = 0;
  const blocks: BlockResult[] = workout.segments.map((segment, index) => {
    const interval = intervals.find((i) => i.index === index);
    const level = segment.kind === "steady" ? segment.target : segment.kind === "ramp" ? Math.max(segment.from, segment.to) : 0;
    const effort = level >= EFFORT_FROM;
    const role = roles[index] ?? "";
    if (segment.kind === "freeRide" || !interval?.target) return { index, role, effort, check: "free", score: null };
    const time = Math.min(1, interval.ridden / Math.max(1, segment.duration));
    let power = 1;
    let check: BlockCheck = "on";
    if (interval.ridden === 0) {
      check = "skipped";
      power = 0;
    } else if (interval.power !== null) {
      const off = interval.power / interval.target - 1;
      if (effort ? off < -ON_TARGET : off > ON_TARGET) {
        power = Math.max(0, 1 - (Math.abs(off) - ON_TARGET) / (POWER_ZERO - ON_TARGET));
        check = off < 0 ? "under" : "over";
      } else if (effort && off > POWER_ZERO) {
        // Well over on an effort: the session was a different one. Half marks for power.
        power = 0.5;
        check = "over";
      }
    }
    if (check === "on" && time < 0.9) check = "short";
    const score = Math.round(time * power * 100);
    const weight = segment.duration * (effort ? EFFORT_WEIGHT : 1);
    weighted += weight * time * power;
    weights += weight;
    return { index, role, effort, check, score };
  });
  if (weights === 0) return null;
  return { score: Math.round((weighted / weights) * 100), method: "blocks", blocks };
}

/**
 * A score for a ride without block data (from Zwift, the Karoo, a file): how much of the planned
 * session was ridden, by stress when both have it, else by time. Over 120% costs a point per percent,
 * since that's no longer the session planned.
 */
export function scoreTotal(planned: { duration: number; stress: number }, ride: { durationSeconds: number; trainingStress: number | null }): Execution {
  const share = completion(planned, ride);
  const score = share > 1.2 ? 100 - (share - 1.2) * 100 : Math.min(1, share) * 100;
  return { score: Math.max(0, Math.round(score)), method: "total", blocks: [] };
}

/** A ride's score: block by block when Lactic recorded its workout, else from its totals against the plan. Null with neither. */
export function rideExecution(
  recorded: { workout: Workout | null; intervals: RideInterval[] | null } | null,
  planned: { duration: number; stress: number } | null,
  ride: { durationSeconds: number; trainingStress: number | null },
): Execution | null {
  if (recorded?.workout && recorded.intervals?.some((i) => i.ridden > 0)) {
    const scored = scoreExecution(recorded.workout, recorded.intervals);
    if (scored) return scored;
  }
  return planned && planned.stress > 0 ? scoreTotal(planned, ride) : null;
}
