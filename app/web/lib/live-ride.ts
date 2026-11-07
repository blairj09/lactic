// The ride screen's sensors, while it's open, so the coach's app check can see live connection
// state and knows when a ride is under way (it only looks, never acts, mid-ride).

import type { SensorHub } from "./ble/sensor-hub";

interface LiveRide {
  hub: SensorHub;
  /** A ride has started and isn't saved yet. */
  riding: boolean;
}

let live: LiveRide | null = null;

/** The ride screen calls this as it opens and whenever riding changes; null as it closes. */
export function setLiveRide(ride: LiveRide | null) {
  live = ride;
}

export function liveRide(): LiveRide | null {
  return live;
}

export const isRiding = () => live?.riding === true;
