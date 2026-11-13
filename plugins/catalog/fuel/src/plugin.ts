// Fuel Reminder: a nudge to eat, every 20 minutes.
//
// On rides over about an hour, carbohydrate keeps you going: sports-nutrition guidance is roughly
// 30 to 60 g an hour for moderate rides and up to 90 g an hour for long, hard ones (e.g. the ACSM
// and Jeukendrup's reviews). Eating little and often works better than a lot late, so this counts
// down to each bite and shows "Eat" for a minute when one is due.
//
// The amount follows intensity so far (Lactic's ride intensity, normalized power as % of FTP).
// It also shows a "choice" metric, `due`, which other parts of Lactic can read as "no" or "now".
import { definePlugin, type KitNode } from "@lactic/sdk";

const EVERY = 20 * 60; // seconds between bites
const SHOW_FOR = 60; // seconds "Eat" stays up
const EASY_G_PER_HOUR = 40;
const HARD_G_PER_HOUR = 80;
const HARD_FROM = 75; // ride intensity (% of FTP) counted as hard

function clock(s: number): string {
  return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
}

let carbs = 0;
let lastBite = 0;

definePlugin({
  field(input) {
    const elapsed = input.metrics["ride.elapsed"];
    if (elapsed == null) return { tree: { type: "field", label: "Fuel", value: "–", sub: "starts with the ride", tone: "muted" } };
    // A new ride, or the first tick of this one.
    if (elapsed < lastBite) carbs = lastBite = 0;
    const intensity = input.metrics["ride.intensity"];
    const perHour = intensity != null && intensity >= HARD_FROM ? HARD_G_PER_HOUR : EASY_G_PER_HOUR;
    const grams = Math.round((perHour * EVERY) / 3600 / 5) * 5; // to the nearest 5 g
    // Which bite are we on? Bite k is due at k × EVERY seconds.
    const bite = Math.floor(elapsed / EVERY);
    if (bite * EVERY > lastBite) {
      lastBite = bite * EVERY;
      carbs += grams;
    }
    const due = bite > 0 && elapsed - bite * EVERY < SHOW_FOR;
    const next = (bite + 1) * EVERY - elapsed;
    // On a bike, kilojoules of work ≈ kilocalories burned (you're about 20 to 25% efficient,
    // which cancels the 4.18 kJ per kcal), so the kJ Lactic counts reads straight as kcal.
    const kj = input.metrics["so_far.kj"];
    const tree: KitNode = due
      ? { type: "field", label: "Fuel", value: "Eat", sub: `about ${grams} g of carbs`, tone: "warn" }
      : { type: "field", label: "Fuel", value: clock(next), sub: kj != null ? `${Math.round(kj)} kcal used` : `${grams} g next`, tone: "default" };
    return { tree, metrics: { due: due ? "now" : "no", carbs } };
  },
});
