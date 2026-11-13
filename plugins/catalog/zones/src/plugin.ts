// Zones: three live ride fields with small charts. Time in each heart rate and power zone builds
// up as you ride (bars in Lactic's zone colours), and a trend line of the last 5 minutes of power.
// State lives in plain variables between ticks; each tick is about a second apart.
import { definePlugin, type HandlerInput, type KitNode } from "@lactic/sdk";

/** Seconds since the last tick, capped so a pause or a skipped tick doesn't count as riding. */
function stepper() {
  let last: number | null = null;
  return (now: number) => {
    const dt = last === null ? 0 : Math.min(5, Math.max(0, now - last));
    last = now;
    return dt;
  };
}

const minutes = (s: number) => `${Math.floor(s / 60)} min`;

function zoneField(input: HandlerInput, zone: number | null | undefined, time: number[], step: (now: number) => number, needs: string): { tree: KitNode } {
  const dt = step(input.now);
  if (zone == null) return { tree: { type: "stack", children: [{ type: "field", label: "", value: "–", sub: needs, tone: "muted" }, { type: "bars", values: time, labels: time.map((_, i) => `Z${i + 1}`), palette: "zones" }] } };
  const z = Math.min(time.length, Math.max(1, Math.round(zone)));
  time[z - 1] += dt;
  return {
    tree: {
      type: "stack",
      children: [
        { type: "field", label: "", value: `Z${z}`, unit: minutes(time[z - 1]) },
        { type: "bars", values: time.map((s) => Math.round(s)), labels: time.map((_, i) => `Z${i + 1}`), palette: "zones" },
      ],
    },
  };
}

const hrTime = [0, 0, 0, 0, 0];
const powerTime = [0, 0, 0, 0, 0, 0, 0];
const hrStep = stepper();
const powerStep = stepper();
const recent: (number | null)[] = [];

definePlugin({
  hrZones: (input) => zoneField(input, input.metrics["heart_rate.zone"], hrTime, hrStep, "needs HR and threshold HR"),
  powerZones: (input) => zoneField(input, input.metrics["power.zone"], powerTime, powerStep, "needs power and FTP"),
  powerTrend(input) {
    recent.push(input.metrics["power"] ?? null);
    if (recent.length > 300) recent.shift();
    const nums = recent.filter((v): v is number => v !== null);
    const avg = nums.length ? Math.round(nums.reduce((a, b) => a + b, 0) / nums.length) : null;
    // Every 5th second keeps the line smooth and within a ride field's 120 points.
    const line = recent.filter((_, i) => i % 5 === 0);
    return {
      tree: {
        type: "stack",
        children: [
          { type: "field", label: "", value: avg === null ? "–" : String(avg), unit: "W avg" },
          { type: "sparkline", values: line },
        ],
      },
    };
  },
});
