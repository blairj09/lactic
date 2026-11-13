// On Target: how well you're hitting the workout.
//
// In ERG mode the trainer holds the target for you, so this matters most in resistance (SIM) mode
// or outside. It compares the interval's average power so far with its target: within 3% is spot
// on, within 8% is close. After the ride, every interval with a target gets a row, and the summary
// counts the ones within 5%.
import { definePlugin, type KitNode, type Tone } from "@lactic/sdk";

const SPOT_ON = 3; // ± % shown as good live
const CLOSE = 8; // ± % shown as a warning live, beyond is bad
const HIT = 5; // ± % that counts as a hit after the ride
const MIN_INTERVAL = 30; // seconds; shorter intervals (ramps' tiny steps, transitions) are skipped

const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

const tone = (pct: number): Tone => (Math.abs(pct - 100) <= SPOT_ON ? "good" : Math.abs(pct - 100) <= CLOSE ? "warn" : "bad");

definePlugin({
  field(input) {
    const target = input.metrics["power.target"];
    const avg = input.metrics["interval.avg_power"];
    if (!target) return { tree: { type: "field", label: "On target", value: "–", unit: "%", sub: "no target now", tone: "muted" } };
    if (avg == null) return { tree: { type: "field", label: "On target", value: "–", unit: "%", sub: "needs power", tone: "muted" } };
    const pct = (avg / target) * 100;
    const tree: KitNode = { type: "field", label: "On target", value: String(Math.round(pct)), unit: "%", sub: `${Math.round(avg)} of ${Math.round(target)} W`, tone: tone(pct) };
    return { tree, metrics: { interval_pct: Math.round(pct) } };
  },

  analyze(input) {
    const ride = input.ride;
    const withTarget = (ride?.intervals ?? []).filter((iv) => iv.target && iv.power !== null && iv.ridden >= MIN_INTERVAL);
    if (!withTarget.length) return { tree: { type: "text", text: "Shows on workouts with power targets.", tone: "muted" } };
    const pcts = withTarget.map((iv) => (iv.power! / iv.target!) * 100);
    const hits = pcts.filter((p) => Math.abs(p - 100) <= HIT).length;
    const tree: KitNode = {
      type: "stack",
      children: [
        { type: "stat", label: "On target", value: `${hits} of ${withTarget.length}`, sub: `intervals within ${HIT}%`, tone: hits === withTarget.length ? "good" : "default" },
        // Bars around 100: one per interval, so a fade late in the workout stands out.
        { type: "bars", values: pcts.slice(0, 400).map((p) => Math.round(p)) },
        {
          type: "table",
          columns: ["Interval", "Length", "Target", "Power", "%"],
          align: ["left", "right", "right", "right", "right"],
          rows: withTarget.slice(0, 200).map((iv, i) => [String(iv.index + 1), clock(iv.ridden), `${Math.round(iv.target!)} W`, `${Math.round(iv.power!)} W`, `${Math.round(pcts[i])}%`]),
        },
      ],
    };
    return { tree, metrics: { hit_share: Math.round((hits / withTarget.length) * 100) } };
  },
});
