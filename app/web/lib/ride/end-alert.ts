// The iPhone's ride-end notification for a ride running on the computer: when it should go off
// and what its Extend button says. The phone only hears from the computer while it's unlocked, so
// it schedules the notification for the workout's end ahead of time and moves it on every update;
// a locked phone still gets it on time. Pure, so it tests in Node.

import type { ExtendKind } from "./extend";

export interface EndAlertRide {
  workoutName: string;
  position: number;
  duration: number;
  running: boolean;
  finished: boolean;
  ended: boolean;
  /** Free ERG has no end. */
  erg: unknown | null;
  extend: { kind: ExtendKind; minutes: number; watts: number; block: string };
}

export interface EndAlert {
  /** One per workout end: the same workout extended has a new end and a new key. */
  key: string;
  /** Seconds from now; 0 when the workout has already finished. */
  inSeconds: number;
  title: string;
  body: string;
  /** The Extend button: what the computer's Extend panel has picked. */
  extendLabel: string;
  /** How much Extend adds, so the phone can schedule the next end itself after a press. */
  extendSeconds: number;
}

export const endAlertKey = (workoutName: string, duration: number) => `${workoutName}|${Math.round(duration)}`;

export function extendLabel(extend: EndAlertRide["extend"]): string {
  if (extend.kind === "erg") return `Extend ${extend.minutes} min at ${extend.watts} W`;
  if (extend.kind === "freeRide") return `Free ride ${extend.minutes} min`;
  return `Add ${extend.block} (${extend.minutes} min)`;
}

/** The notification to have waiting, or null when none should be (paused, ended, free ERG). */
export function endAlert(ride: EndAlertRide | null, computer: string): EndAlert | null {
  if (!ride || ride.ended || ride.erg || ride.duration <= 0) return null;
  if (!ride.running && !ride.finished) return null;
  return {
    key: endAlertKey(ride.workoutName, ride.duration),
    inSeconds: ride.finished ? 0 : Math.max(0, Math.round(ride.duration - ride.position)),
    title: "Workout done",
    body: `${ride.workoutName} on ${computer}. Extend it or end the ride.`,
    extendLabel: extendLabel(ride.extend),
    extendSeconds: Math.max(60, Math.round(ride.extend.minutes * 60)),
  };
}
