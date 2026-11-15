// W′ Balance: how much of your "anaerobic battery" is left.
//
// The science, briefly. Critical power (CP) is the highest power you can hold for a long time. Above
// it you draw on a limited store of work, W′ ("W prime"), typically 10 to 30 kJ. Below CP the store
// refills, faster the further below CP you are. When W′ hits zero you can't stay above CP.
//
// We use the differential model of Skiba and Clarke (2013, "W′ balance" in Med Sci Sports Exerc):
//   above CP:  W′bal falls by (P − CP) joules each second
//   below CP:  W′bal rises by (W′ − W′bal) × (CP − P) / W′ each second
//
// Lactic gives plugins your FTP, not CP, so FTP stands in for CP (they're close for most riders; CP
// is usually a few percent higher, which makes this a little pessimistic). Edit the constants below
// to match your own test results.
import { definePlugin, type HandlerInput, type KitNode, type Tone } from "@lactic/sdk";

/** Your W′ in joules. 20 kJ is a common middle value; a sprinter may have 25+, a diesel 12. */
const W_PRIME = 20000;
/** Set to your critical power in watts to use it instead of FTP. */
const CP_OVERRIDE: number | null = null;

/** One step of the model: the new balance after `dt` seconds at `power` watts. */
function step(balance: number, power: number, cp: number, dt: number): number {
  if (power > cp) return Math.max(0, balance - (power - cp) * dt);
  return Math.min(W_PRIME, balance + ((W_PRIME - balance) * (cp - power) * dt) / W_PRIME);
}

function tone(share: number): Tone {
  return share < 0.25 ? "bad" : share < 0.5 ? "warn" : "good";
}

const criticalPower = (input: HandlerInput) => CP_OVERRIDE ?? input.metrics["profile.ftp"] ?? null;

// Field state lives in plain variables between ticks (about one a second during a ride).
let balance = W_PRIME;
let lastTick: number | null = null;
let lastElapsed = 0;

definePlugin({
  field(input) {
    const cp = criticalPower(input);
    const power = input.metrics["power"];
    const elapsed = input.metrics["ride.elapsed"] ?? 0;
    // A new ride (the clock went back): start full again.
    if (elapsed < lastElapsed) balance = W_PRIME;
    lastElapsed = elapsed;
    // Time since the last tick, capped so a pause or a dropout doesn't count as a long effort.
    const dt = lastTick === null ? 0 : Math.min(5, Math.max(0, input.now - lastTick));
    lastTick = input.now;
    if (!cp) return { tree: { type: "field", label: "W′ balance", value: "–", sub: "needs your FTP", tone: "muted" } };
    if (power != null) balance = step(balance, power, cp, dt);
    const share = balance / W_PRIME;
    const tree: KitNode = {
      type: "stack",
      children: [
        { type: "field", label: "W′ balance", value: (balance / 1000).toFixed(1), unit: "kJ", sub: `${Math.round(share * 100)}% left`, tone: tone(share) },
        // A gauge: Lactic draws the first chart in a ride field under the number.
        { type: "meter", value: share, tone: tone(share) },
      ],
    };
    return { tree, metrics: { balance: Math.round(balance), percent: Math.round(share * 100) } };
  },

  // Runs once on a saved ride: the balance over the whole ride, with the low stretches marked.
  analyze(input) {
    const ride = input.ride;
    const cp = criticalPower(input);
    if (!ride?.watts || !cp) return { tree: { type: "text", text: "Needs a ride with power and your FTP.", tone: "muted" } };
    const dt = ride.stepSeconds;
    let bal = W_PRIME;
    let lowest = W_PRIME;
    const series: number[] = [];
    for (const w of ride.watts) {
      bal = step(bal, w ?? 0, cp, dt); // no reading = coasting, 0 W
      lowest = Math.min(lowest, bal);
      series.push(bal);
    }
    // The profile piece takes up to 2000 points, so thin long rides to fit.
    const every = Math.max(1, Math.ceil(series.length / 2000));
    const x: number[] = [];
    const y: number[] = [];
    for (let i = 0; i < series.length; i += every) {
      x.push(i * dt);
      y.push(Math.round(series[i] / 100) / 10); // kJ, one decimal
    }
    // Mark each stretch below a quarter of W′ (up to 40).
    const marks: { from: number; to: number; tone: Tone }[] = [];
    let start: number | null = null;
    series.forEach((b, i) => {
      if (b < W_PRIME * 0.25 && start === null) start = i;
      if ((b >= W_PRIME * 0.25 || i === series.length - 1) && start !== null) {
        marks.push({ from: start * dt, to: i * dt, tone: "bad" });
        start = null;
      }
    });
    const low = lowest / W_PRIME;
    return {
      tree: {
        type: "stack",
        children: [
          {
            type: "stack",
            direction: "row",
            children: [
              { type: "stat", label: "Lowest", value: `${Math.round(low * 100)}%`, sub: `${(lowest / 1000).toFixed(1)} of ${W_PRIME / 1000} kJ`, tone: tone(low) },
              { type: "stat", label: "Critical power", value: `${Math.round(cp)} W`, sub: CP_OVERRIDE ? "set in the plugin" : "your FTP" },
            ],
          },
          { type: "profile", x, y, xUnit: "s", yUnit: "kJ", marks: marks.slice(0, 40) },
        ],
      },
      metrics: { lowest: Math.round(low * 100) },
    };
  },
});
