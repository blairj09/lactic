// Power match: riding ERG by a power meter's numbers (pedals) instead of the trainer's. The trainer
// still holds the target by its own reading, so we compare the two over the last half minute and
// send it the target scaled by the difference. Pure, so it tests in Node.

/** Seconds of paired readings the ratio is worked out over. */
const WINDOW = 30;
/** Seconds of pairs needed before the ratio moves off 1. */
const MIN_PAIRS = 10;
/** A reading older than this doesn't pair. */
const STALE_MS = 3000;
/** Below this the rider is coasting or stopped, and the two readings don't compare. */
const MIN_WATTS = 50;
/** The ratio only moves when it's off by more than this, so the trainer isn't sent a new target every second. */
const DEADBAND = 0.01;
/** Further apart than this, something is wrong (a bad calibration, the wrong bike) and we don't chase it. */
const LIMITS = [0.8, 1.2] as const;

interface Reading {
  watts: number;
  at: number;
}

export class PowerMatch {
  private trainer?: Reading;
  private meter?: Reading;
  private pairs: [trainer: number, meter: number][] = [];
  private lastPairAt = -Infinity;
  /** Trainer watts per meter watt, as applied to targets. */
  ratio = 1;

  /** Returns true when the ratio changed, so the target should be sent again. */
  addTrainer(watts: number, at: number): boolean {
    this.trainer = { watts, at };
    return this.pair(at);
  }

  addMeter(watts: number, at: number): boolean {
    this.meter = { watts, at };
    return this.pair(at);
  }

  /** What to ask the trainer for so the meter reads `watts`. */
  target(watts: number): number {
    return Math.round(watts * this.ratio);
  }

  reset() {
    this.trainer = this.meter = undefined;
    this.pairs = [];
    this.lastPairAt = -Infinity;
    this.ratio = 1;
  }

  private pair(at: number): boolean {
    const { trainer, meter } = this;
    if (!trainer || !meter || at - this.lastPairAt < 1000) return false;
    if (at - trainer.at > STALE_MS || at - meter.at > STALE_MS) return false;
    if (trainer.watts < MIN_WATTS || meter.watts < MIN_WATTS) return false;
    this.lastPairAt = at;
    this.pairs.push([trainer.watts, meter.watts]);
    if (this.pairs.length > WINDOW) this.pairs.shift();
    if (this.pairs.length < MIN_PAIRS) return false;
    const [t, m] = this.pairs.reduce(([a, b], [x, y]) => [a + x, b + y], [0, 0]);
    const raw = Math.min(LIMITS[1], Math.max(LIMITS[0], t / m));
    if (Math.abs(raw - this.ratio) / this.ratio <= DEADBAND) return false;
    this.ratio = Math.round(raw * 1000) / 1000;
    return true;
  }
}
