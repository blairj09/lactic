// Wall-clock ride timer. Chrome throttles timers in a hidden tab (down to once a minute after five
// minutes behind Zwift), so elapsed time comes from timestamps and callers catch up on every tick
// instead of counting ticks. Pure: callers pass the time in.

export class RideClock {
  private startedAt: number | null = null;
  private banked = 0;

  get running() {
    return this.startedAt !== null;
  }

  start(nowMs: number) {
    if (this.startedAt === null) this.startedAt = nowMs;
  }

  pause(nowMs: number) {
    if (this.startedAt === null) return;
    this.banked += nowMs - this.startedAt;
    this.startedAt = null;
  }

  reset() {
    this.startedAt = null;
    this.banked = 0;
  }

  /** Whole seconds ridden, not counting pauses. */
  elapsed(nowMs: number): number {
    const ms = this.banked + (this.startedAt === null ? 0 : nowMs - this.startedAt);
    return Math.max(0, Math.floor(ms / 1000));
  }
}
