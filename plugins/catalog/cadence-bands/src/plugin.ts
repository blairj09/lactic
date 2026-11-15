// Cadence Bands: a calmer cadence number, and where your cadence sat over the ride.
//
// Instant cadence jumps around; a 30-second average is easier to pace by. The trend line under it
// keeps one point every 10 seconds, so it shows the last 20 minutes.
//
// After the ride, pedalling time is split into bands. Most riders settle between 80 and 100 rpm;
// low-cadence work (under 70) loads the muscles more, high cadence (over 105) the heart and lungs.
// Seconds at 0 rpm are coasting and counted on their own.
import { definePlugin, type KitNode, type Tone } from "@lactic/sdk";

const SMOOTH = 30; // seconds averaged
const TREND_EVERY = 10; // ticks between trend points
const LOW = 70;
const HIGH = 110;

/** Bands in rpm, from (inclusive) to (exclusive), with a bar label of 4 characters or fewer and a table label. */
const BANDS: [number, number, string, string][] = [
  [1, 70, "<70", "under 70 rpm"],
  [70, 85, "70s", "70–84 rpm"],
  [85, 95, "85+", "85–94 rpm"],
  [95, 105, "95+", "95–104 rpm"],
  [105, 1000, "105+", "105 rpm and up"],
];

const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

// ---- Live field ----
let recent: number[] = [];
let trend: number[] = [];
let ticks = 0;
let lastElapsed = 0;

definePlugin({
  field(input) {
    const elapsed = input.metrics["ride.elapsed"] ?? 0;
    if (elapsed < lastElapsed) recent = trend = []; // a new ride
    lastElapsed = elapsed;
    const rpm = input.metrics["cadence"];
    if (rpm != null) {
      recent.push(rpm);
      if (recent.length > SMOOTH) recent.shift();
    }
    if (!recent.length) return { tree: { type: "field", label: "Cadence 30 s", value: "–", unit: "rpm", sub: "needs cadence", tone: "muted" } };
    const avg = recent.reduce((a, b) => a + b, 0) / recent.length;
    if (++ticks % TREND_EVERY === 0) {
      trend.push(Math.round(avg));
      if (trend.length > 120) trend.shift();
    }
    const tone: Tone = avg < LOW || avg > HIGH ? "warn" : "default";
    const tree: KitNode = {
      type: "stack",
      children: [
        { type: "field", label: "Cadence 30 s", value: String(Math.round(avg)), unit: "rpm", tone },
        { type: "sparkline", values: trend },
      ],
    };
    return { tree, metrics: { smooth: Math.round(avg) } };
  },

  analyze(input) {
    const ride = input.ride;
    if (!ride?.cadence) return { tree: { type: "text", text: "Needs a ride with cadence.", tone: "muted" } };
    const step = ride.stepSeconds;
    const seconds = BANDS.map(() => 0);
    let coasting = 0;
    for (const c of ride.cadence) {
      if (c == null) continue;
      if (c < 1) coasting += step;
      else BANDS.forEach(([from, to], i) => c >= from && c < to && (seconds[i] += step));
    }
    const pedalling = seconds.reduce((a, b) => a + b, 0);
    if (!pedalling) return { tree: { type: "text", text: "No pedalling recorded.", tone: "muted" } };
    const tree: KitNode = {
      type: "stack",
      children: [
        { type: "bars", values: seconds.map((s) => Math.round(s / 60)), labels: BANDS.map((b) => b[2]) },
        {
          type: "table",
          columns: ["Cadence", "Time", "Share"],
          align: ["left", "right", "right"],
          rows: [
            ...BANDS.map((b, i) => [b[3], clock(seconds[i]), `${Math.round((seconds[i] / pedalling) * 100)}%`]),
            ["Coasting", clock(coasting), ""],
          ],
        },
      ],
    };
    return { tree, metrics: { coasting } };
  },
});
