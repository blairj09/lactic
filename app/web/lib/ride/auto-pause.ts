// Auto-pause: stop pedaling mid-ride and the ride pauses after a few seconds; pedal again and it
// resumes, with ERG easing back up so the first strokes aren't against the full target. Pure.

/** Seconds of not pedaling before the ride pauses. */
export const PAUSE_AFTER = 3;
/** Seconds of pedaling before an auto-paused ride resumes. */
const RESUME_AFTER = 1;
/** Seconds ERG takes to come back to the full target after a resume. */
export const EASE_SECONDS = 10;
/** Where ERG starts from after a resume, as a share of the target. */
export const EASE_FROM = 0.5;

/** Turning the pedals: some cadence, or power when the cadence isn't coming through. */
export const isPedaling = (cadence: number | undefined, watts: number | undefined) => (cadence ?? 0) >= 20 || (watts ?? 0) >= 40;

export type AutoPauseAction = "pause" | "resume" | null;

export class AutoPause {
  /** True while the ride is paused because you stopped, not because you pressed Pause. */
  paused = false;
  private since: number | null = null;

  /**
   * Feed every reading while a ride is under way (started, not finished). `running` is whether the
   * clock is going. Returns what to do now.
   */
  update(running: boolean, cadence: number | undefined, watts: number | undefined, nowMs: number): AutoPauseAction {
    const moving = isPedaling(cadence, watts);
    if (running) {
      this.paused = false;
      if (moving) {
        this.since = null;
        return null;
      }
      this.since ??= nowMs;
      if (nowMs - this.since < PAUSE_AFTER * 1000) return null;
      this.since = null;
      this.paused = true;
      return "pause";
    }
    // Paused by hand: only Resume restarts it.
    if (!this.paused) return null;
    if (!moving) {
      this.since = null;
      return null;
    }
    this.since ??= nowMs;
    if (nowMs - this.since < RESUME_AFTER * 1000) return null;
    this.since = null;
    this.paused = false;
    return "resume";
  }

  reset() {
    this.paused = false;
    this.since = null;
  }
}

/** The ERG target `seconds` after a resume: from half the target back up to all of it. */
export function easeIn(target: number, seconds: number): number {
  if (seconds >= EASE_SECONDS) return target;
  const share = EASE_FROM + ((1 - EASE_FROM) * Math.max(seconds, 0)) / EASE_SECONDS;
  return Math.round(target * share);
}
