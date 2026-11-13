// Form Zones: a card for the Plugins tab that puts today's form in a training zone.
//
// Form (training stress balance, TSB) is fitness (CTL, about six weeks of training) minus fatigue
// (ATL, about one week). The zones below are a widely used reading of it:
//
//   over +25     Transition: very fresh, fitness is slipping
//   +5 to +25    Fresh: ready to race or test
//   −10 to +5    Grey zone: neither resting nor building much
//   −30 to −10   Optimal: training load that builds fitness
//   under −30    High risk: deep fatigue, rest soon
//
// A widget runs about once a second while its card is on screen, so it's kept tiny.
import { definePlugin, type KitNode, type Tone } from "@lactic/sdk";

type Zone = "transition" | "fresh" | "grey" | "optimal" | "high-risk";

const ZONES: { zone: Zone; above: number; name: string; tone: Tone }[] = [
  { zone: "transition", above: 25, name: "Transition", tone: "warn" },
  { zone: "fresh", above: 5, name: "Fresh", tone: "good" },
  { zone: "grey", above: -10, name: "Grey zone", tone: "muted" },
  { zone: "optimal", above: -30, name: "Optimal", tone: "good" },
  { zone: "high-risk", above: -Infinity, name: "High risk", tone: "bad" },
];

definePlugin({
  card(input) {
    const tsb = input.metrics["fitness.tsb"];
    const ctl = input.metrics["fitness.ctl"];
    const atl = input.metrics["fitness.atl"];
    if (tsb == null) return { tree: { type: "text", text: "Ride a few times to see your form.", tone: "muted" } };
    const z = ZONES.find((x) => tsb > x.above)!;
    // The meter places form on a −40 to +30 scale, left to right.
    const place = Math.min(1, Math.max(0, (tsb + 40) / 70));
    const tree: KitNode = {
      type: "stack",
      children: [
        { type: "stat", label: "Form", value: `${tsb > 0 ? "+" : ""}${Math.round(tsb)}`, sub: z.name, tone: z.tone },
        { type: "meter", value: place, tone: z.tone },
        {
          type: "stack",
          direction: "row",
          children: [
            { type: "stat", label: "Fitness", value: ctl == null ? "–" : String(Math.round(ctl)) },
            { type: "stat", label: "Fatigue", value: atl == null ? "–" : String(Math.round(atl)) },
          ],
        },
      ],
    };
    return { tree, metrics: { zone: z.zone } };
  },
});
