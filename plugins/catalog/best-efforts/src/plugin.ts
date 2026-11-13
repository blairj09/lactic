// Best Efforts: the highest average power you held for set lengths of time.
//
// These "peak powers" are the points of your power curve. 5 seconds is sprint power, 1 minute
// anaerobic capacity, 5 minutes roughly VO2max power, and 20 minutes is the classic FTP test
// (FTP ≈ 95% of it). Comparing them ride to ride shows where you're getting stronger.
//
// The trick is a rolling window: keep a running sum, add the newest sample and drop the one that
// fell out of the window, so each step costs the same however long the window is.
import { definePlugin, type KitNode } from "@lactic/sdk";

/** Durations in seconds, with the label shown in the table. */
const DURATIONS: [number, string][] = [
  [5, "5 s"],
  [60, "1 min"],
  [300, "5 min"],
  [1200, "20 min"],
  [3600, "60 min"],
];

/** The best average of `n` consecutive samples, or null if the ride is shorter than that. */
function bestAverage(watts: (number | null)[], n: number): number | null {
  if (n < 1 || watts.length < n) return null;
  let sum = 0;
  for (let i = 0; i < n; i++) sum += watts[i] ?? 0; // a gap counts as 0 W, like coasting
  let best = sum;
  for (let i = n; i < watts.length; i++) {
    sum += (watts[i] ?? 0) - (watts[i - n] ?? 0);
    if (sum > best) best = sum;
  }
  return best / n;
}

// ---- Live field: best 5 minutes so far ----
// One sample per tick (about a second). A fixed-size ring buffer keeps the last 5 minutes.
const WINDOW = 300;
const ring: number[] = new Array(WINDOW).fill(0);
let filled = 0;
let pos = 0;
let sum = 0;
let best: number | null = null;
let lastElapsed = 0;

function reset() {
  ring.fill(0);
  filled = pos = sum = 0;
  best = null;
}

definePlugin({
  field(input) {
    const elapsed = input.metrics["ride.elapsed"] ?? 0;
    if (elapsed < lastElapsed) reset(); // a new ride
    lastElapsed = elapsed;
    const power = input.metrics["power"];
    if (power != null) {
      sum += power - ring[pos];
      ring[pos] = power;
      pos = (pos + 1) % WINDOW;
      filled = Math.min(WINDOW, filled + 1);
      if (filled === WINDOW) best = Math.max(best ?? 0, sum / WINDOW);
    }
    if (best === null) {
      const left = WINDOW - filled;
      return { tree: { type: "field", label: "Best 5 min", value: "–", unit: "W", sub: power == null ? "needs power" : `in ${Math.ceil(left / 60)} min`, tone: "muted" } };
    }
    const now = sum / WINDOW;
    const tree: KitNode = { type: "field", label: "Best 5 min", value: String(Math.round(best)), unit: "W", sub: `last 5 min ${Math.round(now)} W`, tone: now >= best - 0.5 ? "good" : "default" };
    return { tree, metrics: { best_5min_live: Math.round(best) } };
  },

  analyze(input) {
    const ride = input.ride;
    if (!ride?.watts) return { tree: { type: "text", text: "Needs a ride with power.", tone: "muted" } };
    const ftp = input.metrics["profile.ftp"];
    const kg = input.metrics["profile.weight"];
    const rows: string[][] = [];
    const found: Record<number, number> = {};
    for (const [seconds, label] of DURATIONS) {
      const avg = bestAverage(ride.watts, Math.round(seconds / ride.stepSeconds));
      if (avg === null) continue;
      found[seconds] = Math.round(avg);
      rows.push([label, `${Math.round(avg)} W`, kg ? (avg / kg).toFixed(2) : "–", ftp ? `${Math.round((avg / ftp) * 100)}%` : "–"]);
    }
    if (!rows.length) return { tree: { type: "text", text: "The ride is too short.", tone: "muted" } };
    return {
      tree: { type: "table", columns: ["Time", "Power", "W/kg", "% FTP"], align: ["left", "right", "right", "right"], rows },
      metrics: {
        ...(found[60] !== undefined ? { best_1min: found[60] } : {}),
        ...(found[300] !== undefined ? { best_5min: found[300] } : {}),
        ...(found[1200] !== undefined ? { best_20min: found[1200] } : {}),
      },
    };
  },
});
