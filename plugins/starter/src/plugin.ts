// Sweet Spot: a ride field showing where power sits against the sweet spot (88 to 94% of FTP), and
// a running count of seconds spent there. Plugin state lives in plain variables between ticks.
import { definePlugin, type HandlerInput, type KitNode } from "@lactic/sdk";

const LOW = 0.88;
const HIGH = 0.94;

let seconds = 0;
let lastTick: number | null = null;

function where(input: HandlerInput): "below" | "sweet-spot" | "above" | null {
  const power = input.metrics["power.3s"];
  const ftp = input.metrics["profile.ftp"];
  if (power == null || !ftp) return null;
  const share = power / ftp;
  return share < LOW ? "below" : share > HIGH ? "above" : "sweet-spot";
}

function clock(s: number): string {
  const m = Math.floor(s / 60);
  return `${m}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
}

definePlugin({
  field(input) {
    const zone = where(input);
    // Count time in the zone from the gap between ticks, capped so a pause doesn't count.
    if (lastTick !== null && zone === "sweet-spot") seconds += Math.min(5, Math.max(0, input.now - lastTick));
    lastTick = input.now;
    const ftp = input.metrics["profile.ftp"];
    const tree: KitNode = {
      type: "field",
      label: "Sweet spot",
      value: clock(seconds),
      sub: zone === null ? "needs power and FTP" : zone === "sweet-spot" ? "in it" : zone === "below" ? `push to ${Math.round((ftp ?? 0) * LOW)} W` : "ease off a little",
      tone: zone === "sweet-spot" ? "good" : zone === "above" ? "warn" : "muted",
    };
    return { tree, metrics: { seconds: Math.round(seconds), ...(zone ? { zone } : {}) } };
  },
  // Ride analysis: runs once on a saved ride. A line of 30-second power with the sweet-spot stretches
  // marked, and a table of how long each interval spent there.
  analyze(input) {
    const ride = input.ride;
    const ftp = input.metrics["profile.ftp"];
    if (!ride?.watts || !ftp) return { tree: { type: "text", text: "Needs a ride with power and your FTP.", tone: "muted" } };
    const step = ride.stepSeconds;
    const per = Math.max(1, Math.round(30 / step));
    const x: number[] = [];
    const y: (number | null)[] = [];
    const marks: { from: number; to: number; tone: "good" }[] = [];
    let inBand = 0;
    for (let i = 0; i < ride.watts.length; i += per) {
      const chunk = ride.watts.slice(i, i + per).filter((w): w is number => w !== null);
      const avg = chunk.length ? chunk.reduce((a, b) => a + b, 0) / chunk.length : null;
      x.push(i * step);
      y.push(avg === null ? null : Math.round(avg));
      const sweet = avg !== null && avg >= ftp * LOW && avg <= ftp * HIGH;
      if (sweet) {
        inBand += per * step;
        const last = marks[marks.length - 1];
        if (last && last.to === i * step) last.to = (i + per) * step;
        else marks.push({ from: i * step, to: (i + per) * step, tone: "good" });
      }
    }
    const tree: KitNode = {
      type: "stack",
      children: [
        { type: "stat", label: "Time in the sweet spot", value: clock(inBand), sub: `${Math.round(ftp * LOW)}–${Math.round(ftp * HIGH)} W` },
        { type: "profile", x, y, xUnit: "s", yUnit: "W", marks: marks.slice(0, 40) },
        ...(ride.intervals.length
          ? [
              {
                type: "table" as const,
                columns: ["Interval", "Target", "Power", "Sweet spot?"],
                align: ["left", "right", "right", "left"] as ("left" | "right")[],
                rows: ride.intervals.slice(0, 200).map((iv) => [
                  String(iv.index + 1),
                  iv.target === null ? "–" : `${Math.round(iv.target)} W`,
                  iv.power === null ? "–" : `${Math.round(iv.power)} W`,
                  iv.power !== null && iv.power >= ftp * LOW && iv.power <= ftp * HIGH ? "yes" : "",
                ]),
              },
            ]
          : []),
      ],
    };
    return { tree, metrics: { ride_minutes: inBand } };
  },
  card(input) {
    const ftp = input.metrics["profile.ftp"];
    if (!ftp) return { tree: { type: "text", text: "Set your FTP to see your sweet spot.", tone: "muted" } };
    return {
      tree: {
        type: "stack",
        children: [
          { type: "stat", label: "Your sweet spot", value: `${Math.round(ftp * LOW)}–${Math.round(ftp * HIGH)} W`, sub: "88 to 94% of FTP" },
          { type: "text", text: "Add the Sweet spot field to a ride page to count your time there.", tone: "muted", size: "sm" },
        ],
      },
    };
  },
});
