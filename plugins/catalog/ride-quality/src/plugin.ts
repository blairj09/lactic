// Ride Quality: three ratios coaches use to read a ride, built from numbers Lactic already works out.
//
// - Variability index (VI) = normalized power ÷ average power. 1.00 to 1.05 is a steady ride
//   (a time trial, a good endurance ride); over 1.1 is surgy (group rides, races, crits).
// - Efficiency factor (EF) = normalized power ÷ average heart rate: watts per heartbeat. Compare it
//   between similar rides; a rising EF at the same effort means you're getting fitter.
// - Intensity factor (IF) = normalized power ÷ FTP. About 0.65 is an easy ride, 0.85 a hard
//   endurance ride, 1.0 an hour all out.
//
// Lactic's engine works out normalized power (`so_far.np` live, `ride.np` after), so this plugin
// only divides. Reading engine numbers instead of re-deriving them keeps plugins short and right.
import { definePlugin, type KitNode, type Tone } from "@lactic/sdk";

const STEADY = 1.05;
const SURGY = 1.1;

const viTone = (vi: number): Tone => (vi <= STEADY ? "good" : vi <= SURGY ? "default" : "warn");
const viWords = (vi: number) => (vi <= STEADY ? "steady" : vi <= SURGY ? "a little surgy" : "surgy");

definePlugin({
  field(input) {
    const np = input.metrics["so_far.np"];
    const avg = input.metrics["so_far.power"];
    // Normalized power needs a few minutes of riding before Lactic has it.
    if (!np || !avg) return { tree: { type: "field", label: "Variability", value: "–", sub: "after a few minutes", tone: "muted" } };
    const vi = np / avg;
    return { tree: { type: "field", label: "Variability", value: vi.toFixed(2), sub: viWords(vi), tone: viTone(vi) }, metrics: { vi_live: Math.round(vi * 100) / 100 } };
  },

  analyze(input) {
    const ride = input.ride;
    const np = input.metrics["ride.np"];
    if (!ride?.watts || !np) return { tree: { type: "text", text: "Needs a ride with power.", tone: "muted" } };
    // Average power over the samples with a reading (0 W coasting included, as NP includes it).
    const readings = ride.watts.filter((w): w is number => w != null);
    const avg = readings.reduce((a, b) => a + b, 0) / Math.max(1, readings.length);
    const hr = input.metrics["ride.avg_hr"];
    const ftp = input.metrics["profile.ftp"];
    const vi = avg ? np / avg : null;
    const ef = hr ? np / hr : null;
    const intensity = ftp ? np / ftp : null;
    const tree: KitNode = {
      type: "stack",
      direction: "row",
      children: [
        vi === null ? { type: "stat", label: "Variability", value: "–" } : { type: "stat", label: "Variability", value: vi.toFixed(2), sub: viWords(vi), tone: viTone(vi) },
        ef === null ? { type: "stat", label: "Efficiency", value: "–", sub: "needs heart rate", tone: "muted" } : { type: "stat", label: "Efficiency", value: ef.toFixed(2), sub: "watts per beat" },
        intensity === null ? { type: "stat", label: "Intensity", value: "–", sub: "needs your FTP", tone: "muted" } : { type: "stat", label: "Intensity", value: intensity.toFixed(2), sub: `${Math.round(np)} W normalized` },
      ],
    };
    const round = (x: number) => Math.round(x * 100) / 100;
    return {
      tree,
      metrics: { ...(vi !== null ? { vi: round(vi) } : {}), ...(ef !== null ? { ef: round(ef) } : {}), ...(intensity !== null ? { if: round(intensity) } : {}) },
    };
  },
});
