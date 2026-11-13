// Aerobic Decoupling (Pw:HR): does your heart rate drift up while your power stays the same?
//
// Split the ride, after a warm-up, into two halves and work out watts per heartbeat for each
// (average power ÷ average heart rate, the "efficiency factor"). If the second half takes more
// heartbeats for the same watts, you've "decoupled":
//
//   decoupling % = (first half ratio − second half ratio) ÷ first half ratio × 100
//
// Under about 5% on a long steady ride suggests your aerobic base is solid (Joe Friel's rule of
// thumb). Heat, dehydration and fatigue all push it up. It only means something on steady rides,
// so the result says so when power varied a lot.
import { definePlugin, type KitNode, type Tone } from "@lactic/sdk";

const WARMUP = 600; // seconds left out at the start
const MIN_STEADY = 1200; // seconds needed after the warm-up

const tone = (drift: number): Tone => (drift < 5 ? "good" : drift < 8 ? "warn" : "bad");

/** Decoupling from paired power and heart rate samples (only seconds that have both). */
function decoupling(power: number[], hr: number[]): { first: number; second: number; drift: number } | null {
  const half = Math.floor(power.length / 2);
  if (half < 60) return null;
  const ratio = (from: number, to: number) => {
    let p = 0;
    let h = 0;
    for (let i = from; i < to; i++) {
      p += power[i];
      h += hr[i];
    }
    return h > 0 ? p / h : 0;
  };
  const first = ratio(0, half);
  const second = ratio(half, half * 2);
  if (!first) return null;
  return { first, second, drift: ((first - second) / first) * 100 };
}

// ---- Live field: the samples after the warm-up, one per tick ----
let power: number[] = [];
let hr: number[] = [];
let lastElapsed = 0;

definePlugin({
  field(input) {
    const elapsed = input.metrics["ride.elapsed"] ?? 0;
    if (elapsed < lastElapsed) power = hr = []; // a new ride
    lastElapsed = elapsed;
    const p = input.metrics["power"];
    const h = input.metrics["heart_rate"];
    if (elapsed >= WARMUP && p != null && h) {
      power.push(p);
      hr.push(h);
    }
    if (power.length < MIN_STEADY) {
      // Seconds until there is enough: the rest of the warm-up, then the steady part.
      const wait = elapsed < WARMUP ? WARMUP - elapsed + MIN_STEADY : MIN_STEADY - power.length;
      return { tree: { type: "field", label: "HR drift", value: "–", unit: "%", sub: h ? `in ${Math.ceil(wait / 60)} min` : "needs heart rate", tone: "muted" } };
    }
    const d = decoupling(power, hr)!;
    const tree: KitNode = { type: "field", label: "HR drift", value: d.drift.toFixed(1), unit: "%", sub: d.drift < 5 ? "holding steady" : "heart rate creeping up", tone: tone(d.drift) };
    return { tree, metrics: { drift_live: Math.round(d.drift * 10) / 10 } };
  },

  analyze(input) {
    const ride = input.ride;
    if (!ride?.watts || !ride.heartRate) return { tree: { type: "text", text: "Needs a ride with power and heart rate.", tone: "muted" } };
    const step = ride.stepSeconds;
    const p: number[] = [];
    const h: number[] = [];
    for (let i = Math.ceil(WARMUP / step); i < ride.watts.length; i++) {
      const w = ride.watts[i];
      const b = ride.heartRate[i];
      if (w != null && b) {
        p.push(w);
        h.push(b);
      }
    }
    if (p.length * step < MIN_STEADY) return { tree: { type: "text", text: `Needs at least ${(WARMUP + MIN_STEADY) / 60} minutes with power and heart rate.`, tone: "muted" } };
    const d = decoupling(p, h)!;
    // How steady was it? Variability index: normalized power over average power, from Lactic.
    const avg = p.reduce((a, b) => a + b, 0) / p.length;
    const np = input.metrics["ride.np"];
    const steady = np && avg ? np / avg < 1.1 : true;
    const tree: KitNode = {
      type: "stack",
      children: [
        {
          type: "stack",
          direction: "row",
          children: [
            { type: "stat", label: "Decoupling", value: `${d.drift.toFixed(1)}%`, sub: d.drift < 5 ? "well coupled" : "heart rate drifted", tone: tone(d.drift) },
            { type: "stat", label: "First half", value: d.first.toFixed(2), sub: "watts per beat" },
            { type: "stat", label: "Second half", value: d.second.toFixed(2), sub: "watts per beat" },
          ],
        },
        ...(steady ? [] : [{ type: "text" as const, text: "Power varied a lot, so take this with a pinch of salt.", tone: "muted" as const, size: "sm" as const }]),
      ],
    };
    return { tree, metrics: { drift: Math.round(d.drift * 10) / 10 } };
  },
});
