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
