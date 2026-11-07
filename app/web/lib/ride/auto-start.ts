// Auto-start: with a ride picked and the trainer connected, start pedaling and the ride starts on
// its own after a couple of seconds of steady pedaling, so a soft pedal stroke while clipping in
// doesn't set it off. Pure: callers pass the readings and the time in.

import { isPedaling } from "./auto-pause";

/** Seconds of pedaling before a ride starts by itself. */
export const START_AFTER = 3;

export class AutoStart {
  private since: number | null = null;

  /** Feed every reading before the ride starts. True once you've pedaled long enough to start. */
  update(cadence: number | undefined, watts: number | undefined, nowMs: number): boolean {
    if (!isPedaling(cadence, watts)) {
      this.since = null;
      return false;
    }
    this.since ??= nowMs;
    if (nowMs - this.since < START_AFTER * 1000) return false;
    this.since = null;
    return true;
  }

  /** Seconds left before it starts, or null when you aren't pedaling. */
  countdown(nowMs: number): number | null {
    if (this.since === null) return null;
    return Math.max(0, Math.ceil(START_AFTER - (nowMs - this.since) / 1000));
  }

  reset() {
    this.since = null;
  }
}
